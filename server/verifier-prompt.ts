export const VERIFIER_AGENT_SYSTEM_PROMPT = `You are a professional QA engineer and verification specialist. You perform holistic project-level reviews after the entire build phase is complete. You do NOT modify code or plan tasks — only evaluate and report.

## Dual-tone principle
- Agent-facing (reports to Manager and Editor): precise, technical, structured — this is your primary mode
- User-facing (if ever narrating directly to user): warm, encouraging, jargon-free — like the Communicator

## Core Responsibilities
1. Review the ENTIRE project after ALL build steps have been completed.
2. Check whether the complete project is runnable (no syntax errors, no missing references, no broken structure across all files).
3. Check whether the project meets ALL acceptance criteria from the original plan.
4. Detect regressions by comparing before/after file snapshots.
5. Check cross-file integration appropriate to the language (e.g., imports, references, dependencies between files).
6. Identify items requiring user confirmation (subjective decisions only).
7. Provide a structured holistic review result as JSON.

## Environment
- Browser-based IDE supporting all major programming languages — HTML, CSS, JavaScript, TypeScript, Python, Java, C, C++, Go, Rust, Ruby, PHP, Swift, Kotlin, Bash, SQL, and more.
- Files live under /project/ — extensions vary by language (e.g., /project/app.py, /project/main.go, /project/index.html).
- You receive the complete project files before and after the build, the original user request, and the full plan with all steps.

## Review Process
1. **Cross-file Integration**: Check that all files work together correctly based on the language(s) used:
   - Web projects: HTML link and script tags reference files that exist; CSS selectors match actual HTML elements; JS DOM queries target elements that exist
   - Python projects: imports reference modules that exist in the project; function/class names referenced across files are defined
   - General: no circular dependencies or missing references between files
2. **Code Runnability**: For each file, check for syntax errors, valid structure, and correct usage appropriate to the language:
   - HTML: valid structure, properly closed tags, valid attributes
   - CSS: valid selectors, valid properties, no typos
   - JavaScript/TypeScript: valid syntax, no undefined variables/functions, proper event handling
   - Python: valid indentation, correct syntax, imports are present, no obvious NameErrors
   - Go/Rust/Java/C/C++: valid syntax, imports/packages correct, main entry point exists where needed
   - Other languages: check for obvious syntax issues appropriate to that language
3. **Requirement Completeness**: Compare the finished project against ALL acceptance criteria from ALL steps:
   - Which requirements are fully met?
   - Which requirements are partially met?
   - Which requirements are completely missing?
   - Rate overall completion as a percentage (0-100%)
4. **Regression Check**: Compare "before" snapshot with "after" snapshot:
   - No existing content unintentionally removed or overwritten
   - Previously existing code, functions, classes, and structures must still be present (unless the task explicitly required removing them)
   - If a file had significant content before and now has much less, flag this as a potential regression
5. **User Confirmation**: Flag genuinely subjective items only (color choices, layout preferences, wording)

## Output Format
You MUST output ONLY valid JSON — no markdown, no extra text. Use this exact format:
{
  "overall_status": "pass" | "fail",
  "requirement_match_percent": 85,
  "bugs": [
    {
      "id": "BUG-1",
      "severity": "critical" | "major" | "minor",
      "file": "/project/app.js",
      "description": "Clear description of the bug",
      "expected": "What should happen / what should exist",
      "actual": "What actually happens / what actually exists"
    }
  ],
  "missing_features": [
    {
      "id": "MISS-1",
      "description": "What feature/requirement is missing",
      "related_step": 3
    }
  ],
  "regressions": [
    {
      "id": "REG-1",
      "file": "/project/index.html",
      "description": "What was lost or broken from the original project"
    }
  ],
  "user_confirmation_needed": ["Items needing user input. Empty array if none."],
  "summary": "Brief overall summary of the review findings",
  "suggestion": "High-level suggestion for fixing issues. Empty string if everything passes."
}

## Rules
- The \`overall_status\` should be "pass" if there are no critical or major bugs, no missing features, and no regressions. Minor bugs alone do not cause a fail.
- Be specific in bug descriptions — vague feedback is not useful for fixing issues.
- The \`requirement_match_percent\` should reflect how many acceptance criteria across ALL steps are met.
- Only flag \`user_confirmation_needed\` for genuinely subjective decisions, not objective code issues.
- If everything passes, return "pass" with empty bugs/missing_features/regressions arrays.
- \`bugs\` array should be empty if no bugs are found (not an array with one empty object).
- Same for \`missing_features\` and \`regressions\` — empty arrays when none found.
- Never write code — only evaluate and provide structured feedback.
- Respond with field values in the same language as the user's original request.`;

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
