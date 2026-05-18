import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/agent/tools/shell-manager", () => ({
  shellManager: {
    runCommand: vi.fn(),
  },
}));

import {
  detectTestRunner,
  buildTestCommand,
  parseTestOutput,
  buildTestTools,
} from "../src/agent/tools/test-tools";
import { shellManager } from "../src/agent/tools/shell-manager";
import type { BuildSessionState } from "../src/agent/orchestrator/build-orchestrator";

function makeFiles(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe("AG-15 detectTestRunner", () => {
  it("detects npm when package.json has a test script", () => {
    const files = makeFiles({
      "/package.json": JSON.stringify({ scripts: { test: "jest" } }),
    });
    expect(detectTestRunner(files)).toBe("npm");
  });

  it("returns null when package.json has no test script", () => {
    const files = makeFiles({
      "/package.json": JSON.stringify({ scripts: { build: "tsc" } }),
    });
    expect(detectTestRunner(files)).toBeNull();
  });

  it("detects flutter from pubspec.yaml", () => {
    const files = makeFiles({ "/pubspec.yaml": "name: app\n" });
    expect(detectTestRunner(files)).toBe("flutter");
  });

  it("detects pytest from pyproject.toml", () => {
    const files = makeFiles({ "/pyproject.toml": "[tool.pytest]\n" });
    expect(detectTestRunner(files)).toBe("pytest");
  });

  it("detects pytest from requirements.txt", () => {
    const files = makeFiles({ "/requirements.txt": "pytest==7.0\n" });
    expect(detectTestRunner(files)).toBe("pytest");
  });

  it("detects gradle from build.gradle.kts", () => {
    const files = makeFiles({ "/app/build.gradle.kts": "plugins {}\n" });
    expect(detectTestRunner(files)).toBe("gradle");
  });

  it("returns null when no manifest matches", () => {
    const files = makeFiles({ "/index.html": "<html></html>" });
    expect(detectTestRunner(files)).toBeNull();
  });

  it("handles malformed package.json gracefully", () => {
    const files = makeFiles({ "/package.json": "{ not json" });
    expect(detectTestRunner(files)).toBeNull();
  });
});

describe("AG-15 buildTestCommand", () => {
  it("returns bare npm test with no filter", () => {
    expect(buildTestCommand("npm")).toBe("npm test");
  });

  it("passes jest filter via -- -t", () => {
    expect(buildTestCommand("npm", "adds two numbers")).toBe('npm test -- -t "adds two numbers"');
  });

  it("uses -k for pytest filter", () => {
    expect(buildTestCommand("pytest", "user_auth")).toBe('pytest -k "user_auth"');
  });

  it("uses --name for flutter filter", () => {
    expect(buildTestCommand("flutter", "LoginPage")).toBe('flutter test --name "LoginPage"');
  });

  it("uses --tests for gradle filter", () => {
    expect(buildTestCommand("gradle", "AuthTest")).toBe('./gradlew test --tests "AuthTest"');
  });

  it("returns null for null runner", () => {
    expect(buildTestCommand(null)).toBeNull();
  });
});

describe("AG-15 parseTestOutput", () => {
  it("parses jest/vitest pass/fail counts", () => {
    const out = "Tests:       3 failed, 5 passed, 8 total";
    expect(parseTestOutput("npm", out, "")).toEqual({ passed: 5, failed: 3 });
  });

  it("parses pytest summary", () => {
    const out = "==== 3 failed, 5 passed in 1.23s ====";
    expect(parseTestOutput("pytest", out, "")).toEqual({ passed: 5, failed: 3 });
  });

  it("parses flutter +/- counts", () => {
    const out = "+12 -1: Some tests failed.";
    expect(parseTestOutput("flutter", out, "")).toEqual({ passed: 12, failed: 1 });
  });

  it("parses gradle completed/failed counts", () => {
    const out = "10 tests completed, 2 failed";
    expect(parseTestOutput("gradle", out, "")).toEqual({ passed: 8, failed: 2 });
  });

  it("returns empty object when output doesn't match", () => {
    expect(parseTestOutput("npm", "weird output", "")).toEqual({ passed: undefined, failed: undefined });
  });
});

describe("AG-15 buildTestTools handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeSession(files: Record<string, string>): BuildSessionState {
    return {
      id: "sess-1",
      files: makeFiles(files),
      parts: [] as unknown[],
    } as unknown as BuildSessionState;
  }

  it("returns 'no runner detected' message when no manifest present", async () => {
    const session = makeSession({ "/index.html": "<html></html>" });
    const { handlers } = buildTestTools(session);
    const result = await handlers.run_tests({}, () => {});
    expect(result).toContain("No test runner detected");
    expect(shellManager.runCommand).not.toHaveBeenCalled();
  });

  it("runs npm test and formats result with pass/fail counts", async () => {
    (shellManager.runCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: "Tests:       1 failed, 2 passed, 3 total\nSome details",
      stderr: "",
      exitCode: 1,
    });
    const session = makeSession({
      "/package.json": JSON.stringify({ scripts: { test: "jest" } }),
    });
    const { handlers } = buildTestTools(session);
    const result = await handlers.run_tests({}, () => {});
    expect(shellManager.runCommand).toHaveBeenCalledWith("sess-1", "npm test", 120_000);
    expect(result).toContain("Test results (npm): 2 passed, 1 failed (exit 1)");
    expect(result).toContain("stdout (tail)");
  });

  it("propagates filter into command", async () => {
    (shellManager.runCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const session = makeSession({
      "/package.json": JSON.stringify({ scripts: { test: "jest" } }),
    });
    const { handlers } = buildTestTools(session);
    await handlers.run_tests({ filter: "login flow" }, () => {});
    expect(shellManager.runCommand).toHaveBeenCalledWith(
      "sess-1",
      'npm test -- -t "login flow"',
      120_000,
    );
  });
});
