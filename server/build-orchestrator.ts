import { EDITOR_AGENT_SYSTEM_PROMPT } from "./editor-prompt";
import { VERIFIER_AGENT_SYSTEM_PROMPT } from "./verifier-prompt";
import { detectSkillFromText, loadSkill } from "./skill-loader";
import { runAgentLoop } from "./agent-loop";
import type { AIProvider } from "./kimi-client";
import {
  buildBuilderTools,
  buildVerifierTools,
  buildFixerTools,
  type VerifierSessionState,
} from "./agent-tools";

export interface BuildFile {
  path: string;
  content: string;
}

export interface BuildStep {
  step: number;
  sub_task_id?: string;
  title: string;
  description: string;
  acceptance_criteria?: string;
  required_files?: string[];
}

export interface BuildPlan {
  summary?: string;
  steps?: BuildStep[];
  sub_tasks?: BuildStep[];
}

export interface BuildSessionState {
  id: string;
  aborted: boolean;
  files: Map<string, string>;
  plan: BuildPlan;
  userRequest: string;
  userLang: string;
  taskStatuses?: Record<string, string>;
  userConfirmation?: string;
  skillContent?: string;
  provider?: AIProvider;
}

export type SseEmit = (data: Record<string, unknown>) => void;

function normalizeSteps(plan: BuildPlan): BuildStep[] {
  const raw = plan.steps ?? plan.sub_tasks ?? [];
  return raw.map((s, i) => ({ ...s, step: s.step ?? i + 1 }));
}

function filesMapToArray(files: Map<string, string>): BuildFile[] {
  return Array.from(files.entries()).map(([path, content]) => ({ path, content }));
}

function langNativeLabel(userLang: string): string {
  const l = userLang.toLowerCase();
  if (l.includes("chinese") || l === "zh") return "Chinese (中文)";
  if (l.includes("japanese") || l === "ja") return "Japanese (日本語)";
  if (l.includes("korean") || l === "ko") return "Korean (한국어)";
  if (l.includes("spanish") || l === "es") return "Spanish (Español)";
  if (l.includes("french") || l === "fr") return "French (Français)";
  if (l.includes("german") || l === "de") return "German (Deutsch)";
  if (l.includes("portuguese") || l === "pt") return "Portuguese (Português)";
  if (l.includes("russian") || l === "ru") return "Russian (Русский)";
  return userLang;
}

function buildBuilderSystemPrompt(session: BuildSessionState): string {
  const label = langNativeLabel(session.userLang || "English");
  const isEnglish = label === (session.userLang || "English") && label === "English";
  const langPrefix = isEnglish
    ? ""
    : `IMPORTANT: Write ALL narration and explanatory text in ${label}. Code identifiers, file paths, and code comments must remain in their original language.\n\n`;
  const skillSection = session.skillContent
    ? `\n\n## Technology Skill Guidance\n\nFollow these conventions for the project type in use:\n\n${session.skillContent}`
    : "";
  return `${langPrefix}${EDITOR_AGENT_SYSTEM_PROMPT}${skillSection}`;
}

function buildVerifierSystemPrompt(session: BuildSessionState): string {
  const label = langNativeLabel(session.userLang || "English");
  const isEnglish = label === (session.userLang || "English") && label === "English";
  const langPrefix = isEnglish
    ? ""
    : `IMPORTANT: Write ALL narration and explanatory text in ${label}. Code identifiers and file paths remain in their original language.\n\n`;
  return `${langPrefix}${VERIFIER_AGENT_SYSTEM_PROMPT}`;
}

function buildBuilderInitialMessage(
  session: BuildSessionState,
  steps: BuildStep[],
  mode: "build" | "fix",
  previousIssues?: string,
): string {
  const stepsList = steps.map(s =>
    `Step ${s.step}${s.sub_task_id ? ` (${s.sub_task_id})` : ""}: ${s.title}\n  Description: ${s.description}${s.acceptance_criteria ? `\n  Acceptance: ${s.acceptance_criteria}` : ""}${s.required_files ? `\n  Files: ${s.required_files.join(", ")}` : ""}`
  ).join("\n\n");

  const allFiles = filesMapToArray(session.files);
  const filesList = allFiles.length > 0
    ? `\n\nExisting project files:\n${allFiles.map(f => `- ${f.path}`).join("\n")}`
    : "\n\nThe project currently has no files.";

  const existingFilesWarning = allFiles.length > 0
    ? `\n\n⚠️ WARNING — EXISTING PROJECT FILES DETECTED ⚠️\nThe following files already contain working code that must be preserved:\n${allFiles.map(f => `  - ${f.path}`).join("\n")}\nDO NOT delete, clear, or replace the content of these files unless a plan step explicitly says to. Always call read_file on each existing file BEFORE writing to it, so you preserve all current content.\n`
    : "";

  const modePrefix = mode === "fix"
    ? `You are in FIX MODE. The quality reviewer found issues that need to be addressed.\n\n${previousIssues ? `Issues to fix:\n${previousIssues}\n\n` : ""}`
    : "";

  return `${modePrefix}${existingFilesWarning}Here is the build plan you need to implement:

## Original Request
${session.userRequest}

## Plan Steps
${stepsList}
${filesList}

IMPORTANT: You are implementing a complete coding project. For each step:
1. Read existing files using read_file before modifying them.
2. Write the complete file content using write_file.
3. Mark each step complete with mark_step_complete.
4. After ALL steps are done, call request_review.

Preserve ALL existing content that is not part of the current step. Never truncate or omit existing code.`;
}

function buildVerifierInitialMessage(
  session: BuildSessionState,
  planSteps: BuildStep[],
  userFeedback?: string,
): string {
  const stepsList = planSteps.map(s =>
    `Step ${s.step}: ${s.title}\n  Description: ${s.description}\n  Acceptance: ${s.acceptance_criteria ?? "N/A"}`
  ).join("\n\n");

  const allFiles = filesMapToArray(session.files);
  const filesList = allFiles.length > 0
    ? allFiles.map(f => `- ${f.path}`).join("\n")
    : "(none)";

  const feedbackSection = userFeedback
    ? `\n\n## User Feedback\n${userFeedback}\nPlease take this into account.`
    : "";

  return `Please review this project against its requirements.

## Original User Request
${session.userRequest}

## Build Plan (All Steps)
${stepsList}

## Available Files to Review
${filesList}

Use read_file to examine each file, then report any issues with report_issue, and finally call submit_verdict with your assessment.${feedbackSection}`;
}

const MAX_FIX_CYCLES = 3;

export async function runBuildSession(session: BuildSessionState, emit: SseEmit): Promise<void> {
  const { plan, userRequest } = session;
  const normalizedSteps = normalizeSteps(plan);
  const totalSteps = normalizedSteps.length;
  const initialFiles = filesMapToArray(session.files);

  if (!session.skillContent) {
    const planText = [
      userRequest,
      plan.summary || "",
      normalizedSteps.map((s) => `${s.title} ${s.description}`).join(" "),
    ].join(" ");
    const detectedSkill = await detectSkillFromText(planText);
    if (detectedSkill) {
      const skillContent = await loadSkill(detectedSkill);
      if (skillContent) {
        session.skillContent = skillContent;
      }
    }
  }

  emit({ type: "step_starting", stepNumber: 1, stepTitle: normalizedSteps[0]?.title ?? "Building", totalSteps });

  const builderSystemPrompt = buildBuilderSystemPrompt(session);
  const builderInitialMessage = buildBuilderInitialMessage(session, normalizedSteps, "build");
  const builderTools = buildBuilderTools(session, normalizedSteps);

  try {
    await runAgentLoop(
      builderSystemPrompt,
      [{ role: "user", content: builderInitialMessage }],
      builderTools.schemas,
      builderTools.handlers,
      emit,
      { exitTools: ["request_review"], maxIterations: 50, provider: session.provider },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "build_error", message });
    emit({ type: "done" });
    return;
  }

  if (session.aborted) {
    emit({ type: "done" });
    return;
  }

  let currentCycle = 0;
  let passed = false;
  let currentPlanSteps = normalizedSteps;

  while (currentCycle < MAX_FIX_CYCLES && !passed && !session.aborted) {
    currentCycle++;

    const verifierState: VerifierSessionState = { issues: [] };
    const verifierSystemPrompt = buildVerifierSystemPrompt(session);
    const feedback = session.userConfirmation;
    if (session.userConfirmation) session.userConfirmation = undefined;

    const verifierInitialMessage = buildVerifierInitialMessage(
      session,
      currentPlanSteps,
      feedback,
    );

    const verifierTools = buildVerifierTools(session, verifierState);

    try {
      await runAgentLoop(
        verifierSystemPrompt,
        [{ role: "user", content: verifierInitialMessage }],
        verifierTools.schemas,
        verifierTools.handlers,
        emit,
        { exitTools: ["submit_verdict"], maxIterations: 30, provider: session.provider },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[VerifierAgent] Error:", message);
      emit({
        type: "bugs_found",
        bugCount: 0,
        reviewSummary: "Review failed due to an error.",
        fixCycle: currentCycle,
        maxFixCycles: MAX_FIX_CYCLES,
      });
      break;
    }

    if (session.aborted) break;

    const verdict = verifierState.verdict;
    if (!verdict) {
      emit({
        type: "bugs_found",
        bugCount: 0,
        reviewSummary: "Review completed without a verdict.",
        fixCycle: currentCycle,
        maxFixCycles: MAX_FIX_CYCLES,
      });
      break;
    }

    if (verdict.status === "pass") {
      passed = true;
      emit({
        type: "review_passed",
        summary: verdict.summary,
        requirementMatchPercent: verdict.requirementMatchPercent,
      });
    } else {
      const issueCount = verifierState.issues.length;
      emit({
        type: "bugs_found",
        bugCount: issueCount,
        reviewSummary: verdict.summary,
        fixCycle: currentCycle,
        maxFixCycles: MAX_FIX_CYCLES,
        review: verifierState.review ?? {},
      });

      if (currentCycle >= MAX_FIX_CYCLES) break;

      emit({ type: "fixing", fixCycle: currentCycle });

      const issuesSummary = verifierState.issues.map(i => `- [${i.type}]${i.affected_file ? ` ${i.affected_file}` : ""}: ${i.description}`).join("\n");

      const fixerSystemPrompt = buildBuilderSystemPrompt(session);
      const fixerInitialMessage = buildBuilderInitialMessage(session, currentPlanSteps, "fix", issuesSummary);
      const fixerTools = buildFixerTools(session, currentPlanSteps);

      try {
        await runAgentLoop(
          fixerSystemPrompt,
          [{ role: "user", content: fixerInitialMessage }],
          fixerTools.schemas,
          fixerTools.handlers,
          emit,
          { exitTools: ["request_review"], maxIterations: 50, provider: session.provider },
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[FixerAgent] Error:", message);
        emit({ type: "build_error", message });
        break;
      }
    }
  }

  if (passed) {
    const beforeMap = new Map(initialFiles.map(f => [f.path, f.content]));
    const finalFiles = filesMapToArray(session.files);
    const changedFiles = finalFiles
      .filter(f => !beforeMap.has(f.path) || beforeMap.get(f.path) !== f.content)
      .map(f => f.path);

    emit({ type: "all_complete", changedFiles, summary: plan.summary ?? "" });
  }

  emit({ type: "done" });
}
