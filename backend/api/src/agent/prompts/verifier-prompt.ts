export const VERIFIER_AGENT_SYSTEM_PROMPT = `You are a professional QA engineer and verification specialist. You perform holistic project-level reviews using tools to read files directly. You do NOT modify code or plan tasks — only evaluate and report.

## Core Responsibilities
1. Read relevant project files using read_file.
2. Report each issue found using report_issue.
3. Submit your final verdict using submit_verdict.

## Review Process
1. Call read_file on each file in the project to understand the current state.
2. Run lsp_diagnostics on every TypeScript or Dart file to surface compiler errors. Additionally, run the framework-specific compile check listed in the "Compile check" section below (if present) — treat any non-zero exit as a bug and report each reported error with report_issue. If shell_run is unavailable, note that in your summary.
3. Check cross-file integration: HTML link/script tags reference existing files, CSS selectors match HTML elements, JS functions and variables are defined, imports/requires reference existing modules.
4. Check code runnability: valid syntax, no missing references, no broken structure.
5. Check requirement completeness: compare each plan step's acceptance criteria against what was implemented.
6. Check for regressions: identify anything that appears missing or broken.
7. **If "Browser Console Errors" are listed in your context, treat each one as a confirmed runtime bug.** Report every console error with report_issue (type: "bug"), including the exact error message and the most likely affected file.
8. For each issue found, call report_issue with type, description, and affected file.
9. Finally, call submit_verdict with your overall assessment.

## Advanced Tools

Use these to strengthen your review beyond static file reading.

- **lsp_diagnostics(file_path)** — Get TypeScript/Dart compiler errors and warnings with line numbers. Run this on every .ts/.dart file to catch type errors the editor may have introduced.
- **lsp_find_references(file_path, line, col)** — Verify that exported symbols are actually imported and used elsewhere.
- **shell_run(command, timeout_ms?)** — Run the project's test suite or type-check command (e.g., \`tsc --noEmit\`, \`npm test\`) and report failures as bugs. Only available when Docker is running.

## Issue Types
- **bug**: Code that is syntactically or logically broken, including runtime errors captured from the browser console.
- **missing_feature**: A requirement from the plan that was not implemented.
- **regression**: Something that was working before but appears to have been removed or broken.

## Verdict Rules
- "pass" if there are no critical or major bugs, no missing features, and no regressions. Minor style issues alone do not cause a fail.
- "fail" if there are bugs, missing features, or regressions that significantly impact usability. Any browser console error is a critical bug that causes a fail.
- Be specific in issue descriptions — vague feedback is not useful for fixing.

## Environment
- Browser-based IDE supporting HTML, CSS, JavaScript, TypeScript, Python, Java, C, C++, Go, Rust, Ruby, PHP, Swift, Kotlin, Bash, SQL, and more.
- Files live under /project/

## Rules
- Always read files before evaluating them.
- Narrate your review process briefly in plain language (same language as the user's request) before calling tools. NEVER use markdown syntax — no **, no ##, no bullet points. Write in plain sentences only.
- Submit verdict only after reading all relevant files and reporting all issues.
- Do NOT write code — only evaluate and report.`;

export interface HolisticReviewBug {
  id: string;
  severity: "critical" | "major" | "minor";
  file: string;
  description: string;
  expected: string;
  actual: string;
}

export interface HolisticReviewMissing {
  id: string;
  description: string;
  related_step: number;
}

export interface HolisticReviewRegression {
  id: string;
  file: string;
  description: string;
}

export interface HolisticReviewResult {
  overall_status: "pass" | "fail";
  requirement_match_percent: number;
  bugs: HolisticReviewBug[];
  missing_features: HolisticReviewMissing[];
  regressions: HolisticReviewRegression[];
  user_confirmation_needed: string[];
  summary: string;
  suggestion: string;
}

export function buildHolisticVerifierMessage(
  userRequest: string,
  planSteps: Array<{ step: number; title: string; description: string; acceptance_criteria?: string }>,
  filesBefore: { path: string; content: string }[],
  filesAfter: { path: string; content: string }[],
): string {
  const stepsSection = planSteps.map((s) =>
    `### Step ${s.step}: ${s.title}\n- Description: ${s.description}\n- Acceptance Criteria: ${s.acceptance_criteria || "N/A"}`
  ).join("\n\n");

  const beforeSection = filesBefore.length === 0
    ? "The project had no files before the build."
    : filesBefore.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");

  const afterSection = filesAfter.length === 0
    ? "The project has no files after the build."
    : filesAfter.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");

  return `## Holistic Project Review

## Original User Request
${userRequest}

## Build Plan (All Steps)
${stepsSection}

## Project Files BEFORE Build (Snapshot)
${beforeSection}

## Project Files AFTER Build (Current State)
${afterSection}

Review the entire project holistically. Check cross-file integration, code runnability, requirement completeness against ALL acceptance criteria, and regression detection. Return a structured review result as JSON.`;
}

export function buildVerifierContextMessage(
  files: { path: string; content: string }[],
  subTaskId: string,
  taskDescription: string,
  acceptanceCriteria: string,
  editorOutput: string,
  filesBefore?: { path: string; content: string }[],
): string {
  const fileSection =
    files.length === 0
      ? "The project currently has no files."
      : files.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");

  let beforeSection = "";
  if (filesBefore && filesBefore.length > 0) {
    const beforeContent = filesBefore.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");
    beforeSection = `\n## Project Files BEFORE This Step (Snapshot)\nUse this to compare against the current files and detect regressions — content that was removed, overwritten, or lost.\n\n${beforeContent}\n`;
  }

  return `## Subtask to Verify
- **Sub-task ID**: ${subTaskId}
- **Description**: ${taskDescription}
- **Acceptance Criteria**: ${acceptanceCriteria}
${beforeSection}
## Current Project Files (AFTER Editor Changes)
${fileSection}

## Editor Agent Output
${editorOutput}

Verify the editor's work against the acceptance criteria. Compare before and after snapshots to ensure no existing content was lost or overwritten. Return structured verification result as JSON.`;
}
