import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { runAgentLoop } from "../loop/agent-loop";
import { buildFallbackChain, withFallback, type AIProvider } from "../providers/kimi-client";
import { BuildTelemetry } from "../../infra/telemetry";
import {
  buildReviewTools,
  buildFixerTools,
  type ReviewSessionState as ReviewToolState,
  type ReviewIssue,
  type ReviewSeverity,
} from "../tools/agent-tools";
import { buildReviewSystemPrompt, type ReviewStrictness } from "../prompts/verifier-prompt";
import {
  buildBuilderSystemPrompt,
  buildBuilderInitialMessage,
  getAffectedSteps,
  buildTargetedFixPlan,
  filesMapToArray,
  type BuildSessionState,
  type BuildStep,
  type BufferedEvent,
  type SseEmit,
} from "./build-orchestrator";
import { getMobilePromptSupplement } from "../prompts/mobile-prompt-supplements";
import { buildVerifierCompileCheckPrompt } from "../tools/compile-checks";
import { detectFramework, type Framework } from "../../compiler/framework-detector";
import { type Part, type SessionStatus, type PartEmitContext } from "../../infra/parts";
import { lspManager } from "../tools/lsp-manager";
import { shellManager } from "../tools/shell-manager";

/** Bounded patience: how many quiet verify→fix rounds the review runs before
 * it reports back, regardless of whether all blocking issues were resolved. */
export const REVIEW_MAX_ROUNDS = 3;

export interface ReviewSessionState {
  id: string;
  projectId?: string;
  userId?: string;
  aborted: boolean;
  files: Map<string, string>;
  /** The original user ask — used for requirement/scope context. */
  userRequest: string;
  /** Optional plan steps (with acceptance_criteria) from the last build, if any.
   * When absent, a single synthetic step is derived from userRequest so the
   * targeted-fix machinery still works. */
  planSteps?: BuildStep[];
  userLang: string;
  provider?: AIProvider;
  framework?: Framework;
  strictness: ReviewStrictness;
  // SSE / lifecycle (mirrors the subset of BuildSessionState the emit plumbing uses)
  events: BufferedEvent[];
  nextEventId: number;
  done: boolean;
  doneAt?: number;
  sseWriters: Set<(data: string) => void>;
  parts: Part[];
  status: SessionStatus;
  sessionDir?: string;
  consoleEvents?: Array<{ level: string; message: string; timestamp: number }>;
  _startedAt?: number;
}

const SEVERITY_RANK: Record<ReviewSeverity, number> = {
  critical: 3,
  major: 2,
  minor: 1,
  nit: 0,
};

/** Minimum severity that triggers an automatic fix round, per strictness.
 * `nit` is never blocking under any strictness. */
const BLOCKING_FLOOR: Record<ReviewStrictness, number> = {
  lenient: SEVERITY_RANK.critical, // critical only
  balanced: SEVERITY_RANK.major,   // critical + major
  strict: SEVERITY_RANK.minor,     // critical + major + minor
};

export function isBlocking(severity: ReviewSeverity, strictness: ReviewStrictness): boolean {
  if (severity === "nit") return false;
  return SEVERITY_RANK[severity] >= BLOCKING_FLOOR[strictness];
}

function buildReviewerInitialMessage(session: ReviewSessionState, planSteps: BuildStep[]): string {
  const stepsList = planSteps.length > 0
    ? planSteps.map(s =>
        `Step ${s.step}: ${s.title}\n  Description: ${s.description}${s.acceptance_criteria ? `\n  Acceptance: ${s.acceptance_criteria}` : ""}`,
      ).join("\n\n")
    : "(no formal plan — review against the original request and basic correctness)";

  const allFiles = filesMapToArray(session.files);
  const filesList = allFiles.length > 0
    ? allFiles.map(f => `- ${f.path}`).join("\n")
    : "(none)";

  const consoleSection = session.consoleEvents && session.consoleEvents.length > 0
    ? `\n\n## Browser Console Messages (captured from preview)\nThese were captured from the preview iframe. Treat console ERRORS as critical bugs; treat warnings as nit/minor unless they indicate a real runtime failure.\n\n${session.consoleEvents.map(e => `[${e.level.toUpperCase()}] ${e.message}`).join("\n")}`
    : "";

  return `Please review this project. Focus on what the user asked for plus basic correctness and runnability — do not expand scope or report unrelated pre-existing issues.

## Original User Request
${session.userRequest}

## Plan / Acceptance Criteria
${stepsList}

## Available Files to Review
${filesList}

Use read_file to examine the relevant files, report any in-scope issues with report_issue (assigning an honest severity), and finally call submit_review.${consoleSection}`;
}

function buildReviewerSystemPrompt(session: ReviewSessionState): string {
  const base = buildReviewSystemPrompt(session.strictness);
  const reviewFiles = filesMapToArray(session.files);
  const resolvedFramework = session.framework || detectFramework(reviewFiles);
  const mobileSupplement = resolvedFramework !== "web"
    ? getMobilePromptSupplement("verifier", resolvedFramework)
    : null;
  const mobileSection = mobileSupplement ? `\n${mobileSupplement}` : "";
  const compileCheckSection = buildVerifierCompileCheckPrompt(resolvedFramework);
  return `${base}${mobileSection}${compileCheckSection}`;
}

/** Build a transient BuildSessionState view over the review session so the
 * fixer (which expects a BuildSessionState) can run against the SAME files map
 * — edits made by the fixer propagate straight back to the review session. */
function reviewToBuildSession(session: ReviewSessionState, plan: { steps: BuildStep[] }): BuildSessionState {
  return {
    id: session.id,
    projectId: session.projectId,
    userId: session.userId,
    aborted: session.aborted,
    files: session.files, // shared reference — fixer writes land here
    plan,
    userRequest: session.userRequest,
    userLang: session.userLang,
    provider: session.provider,
    framework: session.framework,
    events: session.events,
    nextEventId: session.nextEventId,
    done: false,
    sseWriters: session.sseWriters,
    parts: session.parts,
    status: session.status,
    sessionDir: session.sessionDir,
    consoleEvents: session.consoleEvents,
    mode: "plan",
  };
}

function summarizeIssues(issues: ReviewIssue[]): string {
  return issues
    .map(i => `- [${i.severity} ${i.type}]${i.affected_file ? ` ${i.affected_file}` : ""}: ${i.description}`)
    .join("\n");
}

function issueKey(i: ReviewIssue): string {
  return `${i.type}|${i.affected_file ?? ""}|${i.description.trim().toLowerCase()}`;
}

/**
 * Standalone review step. Runs up to REVIEW_MAX_ROUNDS QUIET rounds of
 * verify → triage → fix, then emits ONE consolidated report. Unlike the
 * in-build verifier loop, it never emits `needs_input` — the user is only
 * involved after the loop settles.
 */
export async function runReviewSession(session: ReviewSessionState, emit: SseEmit): Promise<void> {
  const userProvider = session.provider ?? "glm";
  const providerChainReviewer = buildFallbackChain("verifier", userProvider);
  const providerChainFixer = buildFallbackChain("fixer", userProvider);

  const telemetry = new BuildTelemetry({
    id: session.id,
    projectId: session.projectId,
    framework: session.framework,
    provider: session.provider,
    userLang: session.userLang,
  });

  // Seed files on disk + start LSP/shell so lsp_diagnostics and compile checks
  // work during review (same setup the build session performs).
  const sessionDir = `/tmp/cascade-sessions/${session.id}`;
  try {
    await mkdir(sessionDir, { recursive: true });
    session.sessionDir = sessionDir;
    for (const [filePath, content] of Array.from(session.files)) {
      const abs = path.join(sessionDir, filePath.replace(/^\/+/, ""));
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf-8");
    }
    lspManager.start(session.id, sessionDir, "typescript").catch(() => {});
    if (session.framework === "flutter") {
      lspManager.start(session.id, sessionDir, "dart").catch(() => {});
    }
    shellManager.createShell(session.id, sessionDir, session.framework).catch(() => {});
  } catch (err) {
    console.warn("[ReviewSession] Failed to create session directory:", err instanceof Error ? err.message : err);
  }

  const partCtx: PartEmitContext = { parts: session.parts, files: session.files };

  // Synthesize a single plan step from the request when no plan is available,
  // so getAffectedSteps has something to map fixer scope onto.
  const planSteps: BuildStep[] = session.planSteps && session.planSteps.length > 0
    ? session.planSteps
    : [{
        step: 1,
        title: session.userRequest.length > 80 ? session.userRequest.slice(0, 80) + "…" : session.userRequest,
        description: session.userRequest,
      }];

  emit({ type: "review_started", strictness: session.strictness });

  const fixedKeys = new Set<string>();
  let round = 0;
  let passed = false;
  let stalled = false;
  let lastBlockingCount = Number.POSITIVE_INFINITY;
  let lastSummary = "";
  let lastMatchPercent = 90;
  let lastBlocking: ReviewIssue[] = [];
  let lastAdvisories: ReviewIssue[] = [];

  while (round < REVIEW_MAX_ROUNDS && !session.aborted) {
    round++;
    emit({ type: "review_round", round, maxRounds: REVIEW_MAX_ROUNDS });

    // ── Verify ──────────────────────────────────────────────────────────
    const reviewState: ReviewToolState = { issues: [] };
    session.status = { type: "busy", agent: "verifier" };
    const reviewerSystemPrompt = buildReviewerSystemPrompt(session);
    const reviewerInitialMessage = buildReviewerInitialMessage(session, planSteps);
    const reviewTools = buildReviewTools(reviewToBuildSession(session, { steps: planSteps }), reviewState);

    try {
      await telemetry.time("verifier", async () => {
        await withFallback(providerChainReviewer, async (client, model) => {
          await runAgentLoop(
            reviewerSystemPrompt,
            [{ role: "user", content: reviewerInitialMessage }],
            reviewTools.schemas,
            reviewTools.handlers,
            emit,
            { exitTools: ["submit_review"], maxIterations: 15, client, model, partCtx, sessionId: session.id },
          );
        });
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ReviewAgent] Error:", message);
      emit({ type: "review_error", message });
      break;
    }

    if (session.aborted) break;

    lastSummary = reviewState.verdict?.summary ?? lastSummary;
    lastMatchPercent = reviewState.verdict?.requirementMatchPercent ?? lastMatchPercent;

    // ── Triage ──────────────────────────────────────────────────────────
    const blocking = reviewState.issues.filter(i => isBlocking(i.severity, session.strictness));
    const advisories = reviewState.issues.filter(i => !isBlocking(i.severity, session.strictness));
    lastBlocking = blocking;
    lastAdvisories = advisories;

    if (blocking.length === 0) {
      passed = true;
      break; // converged — no blocking issues remain
    }

    // No progress since last round (count not strictly decreasing) → stop quietly.
    if (blocking.length >= lastBlockingCount) {
      stalled = true;
      break;
    }
    lastBlockingCount = blocking.length;

    if (round >= REVIEW_MAX_ROUNDS) break; // out of patience — report what remains

    // ── Quiet fix (NO needs_input) ──────────────────────────────────────
    emit({ type: "review_fixing", round });
    session.status = { type: "busy", agent: "fixer" };

    blocking.forEach(i => fixedKeys.add(issueKey(i)));

    const issuesSummary = summarizeIssues(blocking);
    const affectedSteps = getAffectedSteps(blocking, planSteps);
    const targetedPlanSteps = buildTargetedFixPlan(affectedSteps, issuesSummary);

    const fixerScopeFiles = Array.from(
      new Set(blocking.map(i => i.affected_file).filter((f): f is string => !!f)),
    );
    if (fixerScopeFiles.length > 0) telemetry.addFixerScope(fixerScopeFiles);

    const fixerSession = reviewToBuildSession(session, { steps: targetedPlanSteps });
    const fixerSystemPrompt = buildBuilderSystemPrompt(fixerSession);
    const fixerInitialMessage = buildBuilderInitialMessage(fixerSession, targetedPlanSteps, "fix", issuesSummary);
    const fixerTools = buildFixerTools(fixerSession, targetedPlanSteps, telemetry);

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
      console.error("[ReviewFixer] Error:", message);
      emit({ type: "review_error", message });
      break;
    }
  }

  // ── Single consolidated report ────────────────────────────────────────
  const status: "passed" | "stalled" | "exhausted" = passed ? "passed" : stalled ? "stalled" : "exhausted";
  const toReport = (i: ReviewIssue) => ({
    type: i.type,
    severity: i.severity,
    description: i.description,
    file: i.affected_file ?? "",
  });

  emit({
    type: "review_report",
    status,
    rounds: round,
    strictness: session.strictness,
    summary: lastSummary,
    requirementMatchPercent: lastMatchPercent,
    fixedCount: fixedKeys.size,
    remaining: {
      blocking: lastBlocking.map(toReport),
      advisories: lastAdvisories.map(toReport),
    },
  });

  // Mirror the review result into the holistic-review shape the existing UI
  // already knows how to render (bugs keyed by severity + advisories list).
  emit({
    type: "review_passed",
    summary: lastSummary,
    requirementMatchPercent: lastMatchPercent,
    review: {
      overall_status: passed ? "pass" : "fail",
      requirement_match_percent: lastMatchPercent,
      bugs: lastBlocking.map((i, idx) => ({
        id: `BUG-${idx + 1}`,
        severity: i.severity,
        file: i.affected_file ?? "unknown",
        description: i.description,
        expected: "",
        actual: "",
      })),
      advisories: lastAdvisories.map((i, idx) => ({
        id: `ADV-${idx + 1}`,
        severity: i.severity,
        file: i.affected_file ?? "unknown",
        description: i.description,
      })),
      missing_features: [],
      regressions: [],
      summary: lastSummary,
      suggestion: "",
      user_confirmation_needed: [],
    },
  });

  session.status = { type: "idle" };
  telemetry.setFinalStatus(passed ? "pass" : session.aborted ? "aborted" : "fail", lastSummary);
  telemetry.setFixCycle(Math.max(0, round - (passed ? 1 : 0)));
  await telemetry.flush();
  emit({ type: "review_done", status });
  emit({ type: "done" });
}
