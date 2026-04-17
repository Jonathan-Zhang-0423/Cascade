import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { EDITOR_AGENT_SYSTEM_PROMPT } from "./editor-prompt";
import { VERIFIER_AGENT_SYSTEM_PROMPT } from "./verifier-prompt";
import { COMMUNICATOR_AGENT_SYSTEM_PROMPT, buildCommunicatorMessage, type CommunicatorEvent } from "./communicator-prompt";
import { detectSkillsFromText, loadSkills, getSkillForFramework } from "./skill-loader";
import { runAgentLoop } from "./agent-loop";
import { buildFallbackChain, withFallback, type AIProvider } from "./kimi-client";
import { storage } from "./storage";
import { BuildTelemetry } from "./telemetry";
import {
  buildBuilderTools,
  buildVerifierTools,
  buildFixerTools,
  type VerifierSessionState,
} from "./agent-tools";
import { getMobilePromptSupplement } from "./mobile-prompt-supplements";
import { buildEditorCompileCheckPrompt, buildVerifierCompileCheckPrompt } from "./compile-checks";
import { detectFramework, type Framework } from "./framework-detector";
import { type Part, type SessionStatus, type PartEmitContext } from "./parts";
import { lspManager } from "./lsp-manager";
import { shellManager } from "./shell-manager";
import { groupStepsIntoWaves, hasParallelOpportunity, type Wave } from "./step-dependency-analyzer";

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

export interface BufferedEvent {
  eventId: number;
  data: Record<string, unknown>;
}

export interface BuildSessionState {
  id: string;
  projectId?: string;
  aborted: boolean;
  files: Map<string, string>;
  plan: BuildPlan;
  userRequest: string;
  userLang: string;
  taskStatuses?: Record<string, string>;
  userConfirmation?: string;
  skillContent?: string;
  provider?: AIProvider;
  framework?: Framework;
  events: BufferedEvent[];
  nextEventId: number;
  done: boolean;
  doneAt?: number;
  sseWriters: Set<(data: string) => void>;
  /** Structured Part history — mirrors OpenCode's part-based message model */
  parts: Part[];
  /** Session status — mirrors OpenCode's idle | busy pattern */
  status: SessionStatus;
  /** Absolute path to the session's temp directory on disk — set at build start */
  sessionDir?: string;
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
  const sessionFiles = Array.from(session.files.entries()).map(([path, content]) => ({ path, content }));
  const resolvedFramework = session.framework || detectFramework(sessionFiles);
  const mobileSupplement = resolvedFramework !== "web"
    ? getMobilePromptSupplement("editor", resolvedFramework)
    : null;
  const mobileSection = mobileSupplement ? `\n${mobileSupplement}` : "";
  const compileCheckSection = buildEditorCompileCheckPrompt(resolvedFramework);
  return `${langPrefix}${EDITOR_AGENT_SYSTEM_PROMPT}${skillSection}${mobileSection}${compileCheckSection}`;
}

function buildVerifierSystemPrompt(session: BuildSessionState): string {
  const label = langNativeLabel(session.userLang || "English");
  const isEnglish = label === (session.userLang || "English") && label === "English";
  const langPrefix = isEnglish
    ? ""
    : `IMPORTANT: Write ALL narration and explanatory text in ${label}. Code identifiers and file paths remain in their original language.\n\n`;
  const verifierFiles = Array.from(session.files.entries()).map(([path, content]) => ({ path, content }));
  const resolvedFramework = session.framework || detectFramework(verifierFiles);
  const mobileSupplement = resolvedFramework !== "web"
    ? getMobilePromptSupplement("verifier", resolvedFramework)
    : null;
  const mobileSection = mobileSupplement ? `\n${mobileSupplement}` : "";
  const compileCheckSection = buildVerifierCompileCheckPrompt(resolvedFramework);
  return `${langPrefix}${VERIFIER_AGENT_SYSTEM_PROMPT}${mobileSection}${compileCheckSection}`;
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

/**
 * Extract the file path from a verifier issue (best-effort parsing).
 * Looks for patterns like "in /project/src/App.tsx" or just "/project/src/App.tsx"
 */
function extractFileFromIssue(issue: { affected_file?: string; description: string }): string | null {
  if (issue.affected_file) {
    return issue.affected_file;
  }
  // Try to find a /project/... file path in the description
  const match = issue.description.match(/(\/?project\/[^\s:]+)/);
  if (match) return match[1];
  return null;
}

/**
 * Given a bug report (list of issues) and the original plan, identify which
 * plan steps need to be re-run. Returns all steps that touch the buggy files,
 * plus all subsequent steps (since they may depend on the fix).
 */
function getAffectedSteps(issues: Array<{ affected_file?: string; description: string }>, plan: BuildStep[]): BuildStep[] {
  const affectedFiles = new Set<string>();
  for (const issue of issues) {
    const file = extractFileFromIssue(issue);
    if (file) {
      affectedFiles.add(file);
    }
  }

  if (affectedFiles.size === 0) {
    // No specific files identified — re-run all steps (conservative fallback)
    return plan;
  }

  // Find all steps that touch any affected file
  const touchingSteps = plan.filter(step => {
    if (!step.required_files) return false;
    return step.required_files.some(f => affectedFiles.has(f));
  });

  if (touchingSteps.length === 0) {
    // No matching steps found — re-run all (conservative fallback)
    return plan;
  }

  // Include all steps from the first affected step onward
  // (subsequent steps may depend on the fix)
  const minAffectedStepNum = Math.min(...touchingSteps.map(s => s.step));
  return plan.filter(s => s.step >= minAffectedStepNum);
}

/**
 * Build a targeted fix plan: re-number steps and inject bug context into descriptions.
 */
function buildTargetedFixPlan(
  affectedSteps: BuildStep[],
  issuesSummary: string,
): BuildStep[] {
  return affectedSteps.map((step, idx) => ({
    ...step,
    step: idx + 1, // Renumber for the fixer session (1, 2, 3, ...)
    description: `${step.description}\n\n**Fix context from verifier:** ${issuesSummary}`,
  }));
}

/**
 * AG-10 Phase 2: Execute plan waves with intra-wave parallelism.
 *
 * Each wave runs sequentially (wave N+1 waits for wave N to finish). Within
 * a wave, each step runs in its own agent loop via Promise.all(). Every
 * sub-loop shares the same session state (session.files, partCtx), but since
 * steps in a wave touch disjoint required_files, file-level writes do not
 * collide. Event emission and Part mutation go through the existing emit()
 * and partCtx infrastructure — any interleaving is cosmetic, not correctness.
 *
 * Gated behind AG10_PARALLEL=1. Off by default.
 */
async function runBuilderParallelWaves(
  session: BuildSessionState,
  waves: Wave[],
  builderSystemPrompt: string,
  providerChainEditor: AIProvider[],
  partCtx: PartEmitContext,
  emit: SseEmit,
): Promise<void> {
  for (const wave of waves) {
    if (session.aborted) return;

    const concurrent = wave.steps.length > 1;
    console.log(
      `[BuildSession ${session.id}] AG-10 running wave ${wave.index} ` +
        `with ${wave.steps.length} step(s) ${concurrent ? "in parallel" : "sequentially"}`,
    );

    await Promise.all(
      wave.steps.map(async (step) => {
        const subInitialMessage = buildBuilderInitialMessage(session, [step], "build");
        // Each sub-loop gets tools scoped to just this step, so mark_step_complete
        // does not try to auto-advance to a different wave's step.
        const subTools = buildBuilderTools(session, [step]);
        await withFallback(providerChainEditor, async (client, model) => {
          await runAgentLoop(
            builderSystemPrompt,
            [{ role: "user", content: subInitialMessage }],
            subTools.schemas,
            subTools.handlers,
            emit,
            {
              exitTools: ["request_review", "mark_step_complete"],
              maxIterations: 30,
              client,
              model,
              partCtx,
              sessionId: session.id,
            },
          );
        });
      }),
    );
  }
}

export async function runBuildSession(session: BuildSessionState, emit: SseEmit): Promise<void> {
  const { plan, userRequest } = session;
  const normalizedSteps = normalizeSteps(plan);
  const totalSteps = normalizedSteps.length;
  const initialFiles = filesMapToArray(session.files);

  const userProvider = session.provider ?? "doubao";

  // AG-17: Telemetry accumulator. Writes one JSONL record on exit via
  // finally-block flush. Counter wiring happens inside tool handlers.
  const telemetry = new BuildTelemetry({
    id: session.id,
    projectId: session.projectId,
    framework: session.framework,
    provider: session.provider,
    userLang: session.userLang,
  });

  // Create session directory and seed existing files onto disk
  const sessionDir = `/tmp/cascade-sessions/${session.id}`;
  try {
    await mkdir(sessionDir, { recursive: true });
    session.sessionDir = sessionDir;
    for (const [filePath, content] of Array.from(session.files)) {
      const abs = path.join(sessionDir, filePath.replace(/^\/+/, ""));
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf-8");
    }
    // Start LSP servers in the background (non-blocking — won't crash build if unavailable)
    lspManager.start(session.id, sessionDir, "typescript").catch(() => {});
    if (session.framework === "flutter") {
      lspManager.start(session.id, sessionDir, "dart").catch(() => {});
    }
    // Register shell session (actual containers are created per-command)
    shellManager.createShell(session.id, sessionDir, session.framework).catch(() => {});
  } catch (err) {
    console.warn("[BuildSession] Failed to create session directory:", err instanceof Error ? err.message : err);
  }

  // Per-phase optimal provider selection — respects user preference, optimizes by phase
  // Each chain: [user's provider first if available, then system defaults for that phase]
  const providerChainEditor = buildFallbackChain("editor", userProvider);
  const providerChainVerifier = buildFallbackChain("verifier", userProvider);
  const providerChainFixer = buildFallbackChain("fixer", userProvider);

  // Part-based emission context — all agent loops feed into this
  const partCtx: PartEmitContext = { parts: session.parts, files: session.files };
  session.status = { type: "busy", agent: "editor" };

  if (!session.skillContent) {
    // AG-13: Multi-skill injection. Framework skill is always primary when
    // known; we still ask the LLM for a complementary secondary so full-stack
    // projects (e.g., rn-expo frontend + node-express backend) get both
    // skill docs.
    const frameworkSkill = session.framework ? getSkillForFramework(session.framework) : null;
    const planText = [
      userRequest,
      plan.summary || "",
      normalizedSteps.map((s) => `${s.title} ${s.description}`).join(" "),
    ].join(" ");
    const detected = await detectSkillsFromText(planText, providerChainEditor);
    const merged: string[] = [];
    if (frameworkSkill) merged.push(frameworkSkill);
    for (const name of detected) {
      if (!merged.includes(name)) merged.push(name);
    }
    const finalSkills = merged.slice(0, 2);
    if (finalSkills.length > 0) {
      const skillContent = await loadSkills(finalSkills);
      if (skillContent) {
        session.skillContent = skillContent;
      }
    }
  }

  emit({ type: "step_starting", stepNumber: 1, stepTitle: normalizedSteps[0]?.title ?? "Building", totalSteps });

  // AG-10: Analyze step dependencies. By default execution stays sequential
  // (one agent loop over the full plan). When AG10_PARALLEL=1 is set, each
  // wave is executed as an independent agent loop, with steps inside a wave
  // concurrent via Promise.all().
  const waves = groupStepsIntoWaves(normalizedSteps);
  const parallelEnabled = process.env.AG10_PARALLEL === "1";
  const shouldRunParallel = parallelEnabled && hasParallelOpportunity(waves) && waves.length > 1;
  telemetry.setStepCount(totalSteps, hasParallelOpportunity(waves));
  if (hasParallelOpportunity(waves)) {
    const waveSummary = waves
      .map((w) => `wave ${w.index}: [${w.steps.map((s) => s.step).join(", ")}]`)
      .join(" | ");
    console.log(
      `[BuildSession ${session.id}] AG-10 wave analysis: ${waveSummary} ` +
        `(parallel=${shouldRunParallel ? "on" : "off"})`,
    );
  }

  const builderSystemPrompt = buildBuilderSystemPrompt(session);

  try {
    await telemetry.time("builder", async () => {
      if (shouldRunParallel) {
        await runBuilderParallelWaves(session, waves, builderSystemPrompt, providerChainEditor, partCtx, emit);
      } else {
        const builderInitialMessage = buildBuilderInitialMessage(session, normalizedSteps, "build");
        const builderTools = buildBuilderTools(session, normalizedSteps, telemetry);
        await withFallback(providerChainEditor, async (client, model) => {
          await runAgentLoop(
            builderSystemPrompt,
            [{ role: "user", content: builderInitialMessage }],
            builderTools.schemas,
            builderTools.handlers,
            emit,
            { exitTools: ["request_review"], maxIterations: 50, client, model, partCtx, sessionId: session.id },
          );
        });
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "build_error", message });
    emit({ type: "done" });
    telemetry.setFinalStatus("error", message);
    await telemetry.flush();
    return;
  }

  if (session.aborted) {
    emit({ type: "done" });
    telemetry.setFinalStatus("aborted");
    await telemetry.flush();
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

    session.status = { type: "busy", agent: "verifier" };

    const verifierInitialMessage = buildVerifierInitialMessage(
      session,
      currentPlanSteps,
      feedback,
    );

    const verifierTools = buildVerifierTools(session, verifierState);

    try {
      await telemetry.time("verifier", async () => {
        await withFallback(providerChainVerifier, async (client, model) => {
          await runAgentLoop(
            verifierSystemPrompt,
            [{ role: "user", content: verifierInitialMessage }],
            verifierTools.schemas,
            verifierTools.handlers,
            emit,
            { exitTools: ["submit_verdict"], maxIterations: 15, client, model, partCtx, sessionId: session.id },
          );
        });
      });
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
      telemetry.setFinalStatus("pass", verdict.summary);
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

      session.status = { type: "busy", agent: "fixer" };

      const issuesSummary = verifierState.issues.map(i => `- [${i.type}]${i.affected_file ? ` ${i.affected_file}` : ""}: ${i.description}`).join("\n");

      // AG-8: Build a targeted fix plan instead of re-running the full plan
      const affectedSteps = getAffectedSteps(verifierState.issues, currentPlanSteps);
      const targetedPlanSteps = buildTargetedFixPlan(affectedSteps, issuesSummary);

      // AG-17: Capture fixer scope for telemetry
      const fixerScopeFiles = Array.from(
        new Set(
          verifierState.issues
            .map((i) => i.affected_file)
            .filter((f): f is string => !!f),
        ),
      );
      if (fixerScopeFiles.length > 0) telemetry.addFixerScope(fixerScopeFiles);

      const fixerSystemPrompt = buildBuilderSystemPrompt(session);
      const fixerInitialMessage = buildBuilderInitialMessage(session, targetedPlanSteps, "fix", issuesSummary);
      const fixerTools = buildFixerTools(session, targetedPlanSteps, telemetry);

      try {
        await telemetry.time("fixer", async () => {
          await withFallback(providerChainFixer, async (client, model) => {
            await runAgentLoop(
              fixerSystemPrompt,
              [{ role: "user", content: fixerInitialMessage }],
              fixerTools.schemas,
              fixerTools.handlers,
              emit,
              { exitTools: ["request_review"], maxIterations: 50, client, model, partCtx, sessionId: session.id },
            );
          });
        });
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

    // Generate completion summary server-side so the client doesn't need a second fetch
    let summaryText = "";
    try {
      const commPrompt = buildCommunicatorMessage({
        event: "all_complete",
        userLanguage: session.userLang || "English",
        changedFiles,
        planSummary: plan.summary ?? "",
      } as CommunicatorEvent);
      const summaryCompletion = await withFallback(providerChainEditor, async (client, model) =>
        client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: COMMUNICATOR_AGENT_SYSTEM_PROMPT },
            { role: "user", content: commPrompt },
          ],
          stream: false,
          max_tokens: 1024,
        })
      );
      summaryText = summaryCompletion.choices[0]?.message?.content || "";
    } catch {}

    emit({ type: "all_complete", changedFiles, summary: plan.summary ?? "", summaryText });

    if (session.projectId) {
      storage.updateProjectBuildResult(session.projectId, {
        changedFiles,
        summary: plan.summary ?? "",
        completedAt: Date.now(),
      }).catch(() => {});
    }
  }

  session.status = { type: "idle" };
  if (!passed) telemetry.setFinalStatus(session.aborted ? "aborted" : "fail");
  telemetry.setFixCycle(currentCycle);
  await telemetry.flush();
  emit({ type: "done" });
}
