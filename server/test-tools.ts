import type { ToolSchema, ToolHandler } from "./agent-loop";
import type { BuildSessionState } from "./build-orchestrator";
import { shellManager } from "./shell-manager";

export type TestRunner = "npm" | "pytest" | "flutter" | "gradle" | null;

/**
 * AG-15: Auto-detect the project's test runner from manifest files.
 * Returns null if no runner can be detected.
 */
export function detectTestRunner(files: Map<string, string>): TestRunner {
  const packageJson = files.get("/package.json") ?? files.get("package.json");
  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson) as { scripts?: Record<string, string> };
      if (parsed.scripts?.test) return "npm";
    } catch {
      // fall through
    }
  }

  if (files.has("/pubspec.yaml") || files.has("pubspec.yaml")) return "flutter";

  for (const key of files.keys()) {
    if (key.endsWith("/pyproject.toml") || key === "pyproject.toml") return "pytest";
    if (key.endsWith("/requirements.txt") || key === "requirements.txt") return "pytest";
    if (key.endsWith("requirements-dev.txt")) return "pytest";
  }

  for (const key of files.keys()) {
    if (key.endsWith("/build.gradle") || key.endsWith("/build.gradle.kts") ||
        key === "build.gradle" || key === "build.gradle.kts") {
      return "gradle";
    }
  }

  return null;
}

/**
 * Build the concrete shell command for a runner, with optional filter applied
 * in the runner's native syntax.
 */
export function buildTestCommand(runner: TestRunner, filter?: string): string | null {
  const f = filter?.trim();
  switch (runner) {
    case "npm":
      return f ? `npm test -- -t ${JSON.stringify(f)}` : "npm test";
    case "pytest":
      return f ? `pytest -k ${JSON.stringify(f)}` : "pytest";
    case "flutter":
      return f ? `flutter test --name ${JSON.stringify(f)}` : "flutter test";
    case "gradle":
      return f ? `./gradlew test --tests ${JSON.stringify(f)}` : "./gradlew test";
    default:
      return null;
  }
}

/**
 * Best-effort parse of pass/fail counts from common test runner output.
 * Returns undefined counts when the format doesn't match.
 */
export function parseTestOutput(
  runner: TestRunner,
  stdout: string,
  stderr: string,
): { passed?: number; failed?: number } {
  const combined = `${stdout}\n${stderr}`;

  if (runner === "npm") {
    const passed = /(\d+)\s+passed/i.exec(combined)?.[1];
    const failed = /(\d+)\s+failed/i.exec(combined)?.[1];
    return {
      passed: passed !== undefined ? Number(passed) : undefined,
      failed: failed !== undefined ? Number(failed) : undefined,
    };
  }
  if (runner === "pytest") {
    const passed = /(\d+)\s+passed/.exec(combined)?.[1];
    const failed = /(\d+)\s+failed/.exec(combined)?.[1];
    return {
      passed: passed !== undefined ? Number(passed) : undefined,
      failed: failed !== undefined ? Number(failed) : undefined,
    };
  }
  if (runner === "flutter") {
    const plus = /\+(\d+)/.exec(combined)?.[1];
    const minus = /-(\d+)/.exec(combined)?.[1];
    return {
      passed: plus !== undefined ? Number(plus) : undefined,
      failed: minus !== undefined ? Number(minus) : undefined,
    };
  }
  if (runner === "gradle") {
    const total = /(\d+)\s+tests?\s+completed/.exec(combined)?.[1];
    const failed = /(\d+)\s+failed/.exec(combined)?.[1];
    if (total !== undefined) {
      const t = Number(total);
      const fail = failed !== undefined ? Number(failed) : 0;
      return { passed: t - fail, failed: fail };
    }
    return {};
  }
  return {};
}

function tailLines(text: string, n: number): string {
  const lines = text.split("\n");
  if (lines.length <= n) return text;
  return lines.slice(-n).join("\n");
}

const TEST_TIMEOUT_MS = 120_000;

export function buildTestTools(session: BuildSessionState): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "run_tests",
        description:
          "Run the project's test suite in the sandbox. Auto-detects the test " +
          "command from package.json, pubspec.yaml, pyproject.toml/requirements.txt, " +
          "or build.gradle. Returns pass/fail counts and the failure tail. " +
          "Prefer this over shell_run for tests — it parses failures more reliably. " +
          "Requires ENABLE_SHELL=true.",
        parameters: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              description: "Optional test name/pattern filter",
            },
          },
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    run_tests: async (args, emit) => {
      const filter = typeof args.filter === "string" ? args.filter : undefined;
      const runner = detectTestRunner(session.files);
      if (runner === null) {
        return "No test runner detected (no package.json#scripts.test, pubspec.yaml, pyproject.toml/requirements.txt, or build.gradle). Use shell_run directly if you need to run a custom test command.";
      }
      const command = buildTestCommand(runner, filter);
      if (!command) {
        return `Unable to build test command for runner '${runner}'.`;
      }

      emit({ type: "action_log", actionType: "file_write", label: "Tests", detail: command });

      const result = await shellManager.runCommand(session.id, command, TEST_TIMEOUT_MS);
      const { passed, failed } = parseTestOutput(runner, result.stdout, result.stderr);

      const header =
        passed !== undefined || failed !== undefined
          ? `Test results (${runner}): ${passed ?? "?"} passed, ${failed ?? "?"} failed (exit ${result.exitCode})`
          : `Test run (${runner}): exit ${result.exitCode}`;

      const parts: string[] = [header];
      const stdoutTail = tailLines(result.stdout.trim(), 40);
      const stderrTail = tailLines(result.stderr.trim(), 40);
      if (stdoutTail) parts.push(`stdout (tail):\n${stdoutTail}`);
      if (stderrTail) parts.push(`stderr (tail):\n${stderrTail}`);
      return parts.join("\n\n");
    },
  };

  return { schemas, handlers };
}
