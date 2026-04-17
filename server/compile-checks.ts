import type { Framework } from "./framework-detector";

/**
 * AG-11: Framework-specific compile / static-analysis check commands.
 *
 * Each framework has its own way to surface static errors quickly. The
 * editor agent runs this command before calling request_review; the
 * verifier agent runs it during review. Treating non-zero exit as a bug
 * catches compile/type errors the per-file LSP check misses (cross-file
 * type errors, missing imports, etc.).
 *
 * Only returned when the framework has a meaningful check. `null` means
 * "no static check required — rely on LSP and the verifier's code review".
 */

export interface CompileCheck {
  /** Shell command that returns non-zero on failure. */
  command: string;
  /** Short description for the prompt (e.g., "tsc --noEmit"). */
  label: string;
  /** What the agent should look for in the output. */
  guidance: string;
}

export function getCompileCheck(framework: Framework): CompileCheck | null {
  switch (framework) {
    case "web":
    case "rn-expo":
      return {
        command: "tsc --noEmit",
        label: "tsc --noEmit",
        guidance:
          "Reports type errors across all TypeScript files. Fix any reported errors before proceeding.",
      };
    case "flutter":
      return {
        command: "flutter analyze",
        label: "flutter analyze",
        guidance:
          "Runs the Dart analyzer. Fix any errors or warnings about types, missing imports, or unused code.",
      };
    case "kotlin":
      return {
        command: "./gradlew compileKotlin",
        label: "./gradlew compileKotlin",
        guidance:
          "Compiles all Kotlin sources. Fix any compilation errors (missing imports, type mismatches, unresolved references).",
      };
    case "swiftui":
      // No standard CLI compile check available in our sandbox.
      // Rely on LSP diagnostics and verifier review.
      return null;
    default:
      return null;
  }
}

/**
 * Build a prompt fragment telling the editor agent to run the compile check
 * before request_review, with framework-appropriate guidance.
 */
export function buildEditorCompileCheckPrompt(framework: Framework): string {
  const check = getCompileCheck(framework);
  if (!check) {
    return "";
  }
  return `\n## Pre-review compile check (${check.label})
Before calling request_review, run \`shell_run('${check.command}')\`. ${check.guidance} If the command exits non-zero, fix the reported errors with write_file or patch_file and re-run the check. Only call request_review when the command exits cleanly. If shell_run is unavailable, note that in your completion and proceed.`;
}

/**
 * Build a prompt fragment telling the verifier agent to run the compile check
 * as part of review and report non-zero exits as bugs.
 */
export function buildVerifierCompileCheckPrompt(framework: Framework): string {
  const check = getCompileCheck(framework);
  if (!check) {
    return "";
  }
  return `\n## Compile check (${check.label})
As part of every review, run \`shell_run('${check.command}')\`. ${check.guidance} Treat any non-zero exit as a bug and report each reported error with report_issue. If shell_run is unavailable, note that in your summary.`;
}
