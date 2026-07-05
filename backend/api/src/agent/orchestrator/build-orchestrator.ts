import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { EDITOR_AGENT_SYSTEM_PROMPT } from "../prompts/editor-prompt";
import { COMMUNICATOR_AGENT_SYSTEM_PROMPT, buildCommunicatorMessage, type CommunicatorEvent } from "../prompts/communicator-prompt";
import { detectSkillsFromText, loadSkills, getSkillForFramework } from "../../skills/loader";
import { detectCapabilitiesDetailed, loadCapabilitiesTiered } from "../../skills/capability-loader";
import { runAgentLoop, type ToolHandler, type ToolSchema } from "../loop/agent-loop";
import { type AIProvider } from "../providers/kimi-client";
import {
  resolveAgentModel,
  resolveAgentModelChain,
  withModelFallback,
  type AgentModelDecision,
} from "../providers/agent-model-router";
import { storage, PROJECT_MEMORY_MAX } from "../../infra/storage";
import { BuildTelemetry, type BuildTelemetryRecord } from "../../infra/telemetry";
import {
  type BuilderToolState,
} from "../tools/agent-tools";
import { getMobilePromptSupplement } from "../prompts/mobile-prompt-supplements";
import { buildEditorCompileCheckPrompt } from "../tools/compile-checks";
import { detectFramework, type Framework } from "../../compiler/framework-detector";
import { type Part, type SessionStatus, type PartEmitContext } from "../../infra/parts";
import { lspManager } from "../tools/lsp-manager";
import { shellManager } from "../tools/shell-manager";
import { groupStepsIntoWaves, hasParallelOpportunity, type Wave } from "./step-dependency-analyzer";
import { loadUserSkills } from "../../skills/user-skill-loader";
import { loadMcpConfig, getBuiltinMcpConfig, type McpConfig } from "../mcp/mcp-config";
import { McpManager } from "../mcp/mcp-client";
import { getMcpToolNames } from "../mcp/mcp-tools";
import { runExploreAgent } from "./explore-agent";
import { buildAgentToolkit } from "../tools/toolkit";
import type { AgentRunSpec, ToolPolicy } from "../runtime/types";
import { buildEditorContextPacket, estimateContextPacketTokens, renderContextPacket } from "../runtime/context-packet";
import { TodoLedger } from "../runtime/todo-ledger";

const BUILDER_MAX_ITERATIONS = 200;

function builderStepIterationBudget(totalSteps: number): number {
  if (totalSteps <= 1) return BUILDER_MAX_ITERATIONS;
  if (totalSteps === 2) return Math.min(120, BUILDER_MAX_ITERATIONS);
  if (totalSteps <= 4) return Math.min(80, BUILDER_MAX_ITERATIONS);
  return Math.min(60, BUILDER_MAX_ITERATIONS);
}

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

export { type BufferedEvent, type SseEmit } from "../../infra/sse";
import type { BufferedEvent, SseEmit } from "../../infra/sse";

export interface BuildSessionState {
  id: string;
  projectId?: string;
  userId?: string;
  aborted: boolean;
  files: Map<string, string>;
  plan: BuildPlan;
  userRequest: string;
  userLang: string;
  taskStatuses?: Record<string, string>;
  userConfirmation?: string;
  skillContent?: string;
  /** Per-project self-evolving memory doc, injected first as authoritative context. */
  projectMemory?: string;
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
  /** Pending user input for needs_input pause/resume */
  pendingUserInput?: string;
  pendingUserInputResolve?: () => void;
  /** Console errors/warnings captured from the preview iframe during this build */
  consoleEvents?: Array<{ level: string; message: string; timestamp: number }>;
  /** "plan": multi-step plan execution. "direct": single-shot. Review is a separate, user-invoked step either way. */
  mode?: "plan" | "direct";
  /** Backend-authoritative plan/build state ledger. Frontend may render snapshots, but should not infer completion itself. */
  todoLedger?: TodoLedger;
  /** Immediate per-build summary injected into the next round even if long-term memory distillation is still pending. */
  completedRoundSummary?: string;
  /** Fast scanner output for this request, used to reduce repeated discovery by the editor. */
  explorerSummary?: string;
  /** Server-side action log accumulator used for robust hard-refresh recovery. */
  actionLog?: Array<Record<string, unknown>>;
  finalArtifact?: Record<string, unknown>;
}

function normalizeSteps(plan: BuildPlan): BuildStep[] {
  const raw = plan.steps ?? plan.sub_tasks ?? [];
  return raw.map((s, i) => ({ ...s, step: s.step ?? i + 1 }));
}

function extractExplorerSuggestedFiles(summary: string | undefined): string[] {
  if (!summary) return [];
  const files = new Set<string>();
  const pathPattern = /\/project\/[^\s,'"`)]+/g;
  for (const match of summary.matchAll(pathPattern)) {
    files.add(match[0].replace(/[.,;:]+$/, ""));
  }
  return Array.from(files).slice(0, 8);
}

function fillMissingRequiredFiles(steps: BuildStep[], suggestedFiles: string[], existingFiles: BuildFile[]): BuildStep[] {
  if (suggestedFiles.length === 0 && existingFiles.length === 0) return steps;
  const fallback = suggestedFiles.length > 0
    ? suggestedFiles
    : existingFiles
        .filter((f) => /\.(tsx?|jsx?|html|css|json|vue|svelte|dart|kt|swift)$/.test(f.path))
        .map((f) => f.path)
        .slice(0, 5);
  if (fallback.length === 0) return steps;
  return steps.map((step) => {
    if (Array.isArray(step.required_files) && step.required_files.length > 0) return step;
    return { ...step, required_files: fallback };
  });
}

function buildEditorToolset(
  session: BuildSessionState,
  steps: BuildStep[],
  emit: SseEmit,
  userSkillsLoaded: Awaited<ReturnType<typeof loadUserSkills>>,
  options?: {
    telemetry?: BuildTelemetry;
    exitSignal?: { exit: boolean; reason?: string };
    mcpManager?: McpManager | null;
    allowedStepIds?: Array<number | string>;
    completeOnlyCurrentStep?: boolean;
    currentStepId?: number | string;
  },
): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
  policies: Record<string, ToolPolicy>;
  sources: string[];
  toolManifest: string;
  state: BuilderToolState;
} {
  const toolkit = buildAgentToolkit("editor", {
    session,
    planSteps: steps,
    telemetry: options?.telemetry,
    exitSignal: options?.exitSignal,
    builderOptions: {
      allowedStepIds: options?.allowedStepIds,
      completeOnlyCurrentStep: options?.completeOnlyCurrentStep,
      currentStepId: options?.currentStepId,
    },
    mcpManager: options?.mcpManager,
    emit,
    provider: session.provider,
    userSkillTools: userSkillsLoaded.toolSchemas.length > 0 || Object.keys(userSkillsLoaded.toolHandlers).length > 0
      ? {
          schemas: userSkillsLoaded.toolSchemas,
          handlers: userSkillsLoaded.toolHandlers,
        }
      : undefined,
  });
  return {
    schemas: toolkit.schemas,
    handlers: toolkit.handlers,
    policies: toolkit.policies,
    sources: toolkit.sources,
    toolManifest: toolkit.toolManifest,
    state: toolkit.state ?? {
      getCompletedStepCount: () => 0,
      getCompletedSteps: () => [],
    },
  };
}

function withStepScope(emit: SseEmit, stepNumber: number): SseEmit {
  return (data) => {
    const type = typeof data.type === "string" ? data.type : "";
    if (
      type === "action_log" ||
      type === "tool_batch_started" ||
      type === "tool_batch_completed" ||
      type === "code_applied" ||
      type === "file_deleted"
    ) {
      emit({ ...data, stepNumber });
      return;
    }
    emit(data);
  };
}

type LoadedUserSkills = Awaited<ReturnType<typeof loadUserSkills>>;

export interface PreparedBuildContext {
  skillContent?: string;
  projectMemory?: string;
  userSkillsLoaded: LoadedUserSkills;
  activeCapabilities: Array<{ name: string; score: number; tier: string }>;
}

function appendSkillContent(current: string | undefined, addition: string | null | undefined): string | undefined {
  const trimmed = addition?.trim();
  if (!trimmed) return current;
  return current ? `${current}\n\n---\n\n${trimmed}` : trimmed;
}

export async function prepareBuildContext(
  session: BuildSessionState,
  normalizedSteps: BuildStep[],
  providerChainEditor: AIProvider[],
): Promise<PreparedBuildContext> {
  const planText = [
    session.userRequest,
    session.plan.summary || "",
    normalizedSteps.map((s) => `${s.title} ${s.description}`).join(" "),
  ].join(" ");

  const shouldDetectSystemSkills = !session.skillContent;
  const frameworkSkill = session.framework ? getSkillForFramework(session.framework) : null;

  const techSkillPromise = !shouldDetectSystemSkills
    ? Promise.resolve<string | null>(session.skillContent ?? null)
    : (async () => {
        const detected = await detectSkillsFromText(planText, providerChainEditor);
        const merged: string[] = [];
        if (frameworkSkill) merged.push(frameworkSkill);
        for (const name of detected) {
          if (!merged.includes(name)) merged.push(name);
        }
        const finalSkills = merged.slice(0, 2);
        return finalSkills.length > 0 ? loadSkills(finalSkills) : null;
      })();

  const capabilityPromise = (async (): Promise<{
    content: string | null;
    active: Array<{ name: string; score: number; tier: string }>;
  }> => {
    if (!shouldDetectSystemSkills) {
      return { content: null, active: [] };
    }
    const detectedCapMatches = await detectCapabilitiesDetailed(planText);
    if (detectedCapMatches.length === 0) {
      return { content: null, active: [] };
    }
    console.log(
      `[build-session] capability skills active: ${detectedCapMatches
        .map((m) => `${m.name}[${m.tier}](score=${m.score} via ${m.matched.slice(0, 3).join(",")})`)
        .join("; ")}`,
    );
    const content = await loadCapabilitiesTiered(detectedCapMatches);
    return {
      content,
      active: detectedCapMatches.map((m) => ({ name: m.name, score: m.score, tier: m.tier })),
    };
  })();

  const memoryPromise = (async (): Promise<string | undefined> => {
    if (!session.projectId || session.projectMemory) return session.projectMemory;
    try {
      return await storage.getProjectMemory(session.projectId);
    } catch (err) {
      console.warn(`[BuildSession ${session.id}] getProjectMemory failed:`, err instanceof Error ? err.message : err);
      return undefined;
    }
  })();

  const userSkillsPromise = loadUserSkills(
    session,
    session.projectId ?? "",
    session.userId ?? "",
  );

  const [techSkillContent, capability, projectMemory, userSkillsLoaded] = await Promise.all([
    techSkillPromise,
    capabilityPromise,
    memoryPromise,
    userSkillsPromise,
  ]);

  let skillContent = appendSkillContent(undefined, techSkillContent);
  skillContent = appendSkillContent(skillContent, capability.content);
  if (userSkillsLoaded.knowledgePacks.length > 0) {
    skillContent = appendSkillContent(skillContent, userSkillsLoaded.knowledgePacks.join("\n\n---\n\n"));
  }

  return {
    skillContent,
    projectMemory,
    userSkillsLoaded,
    activeCapabilities: capability.active,
  };
}

export async function prepareSessionWorkspace(session: BuildSessionState): Promise<void> {
  const sessionDir = `/tmp/cascade-sessions/${session.id}`;
  try {
    await mkdir(sessionDir, { recursive: true });
    session.sessionDir = sessionDir;
    await Promise.all(Array.from(session.files).map(async ([filePath, content]) => {
      const abs = path.join(sessionDir, filePath.replace(/^\/+/, ""));
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf-8");
    }));
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
}

export interface PreparedMcp {
  manager: McpManager | null;
  guidance?: string;
}

export async function prepareMcpManager(session: BuildSessionState): Promise<PreparedMcp> {
  try {
    const builtinConfig = getBuiltinMcpConfig();
    const userConfig = loadMcpConfig(session);
    const mergedConfig: McpConfig = {
      servers: {
        ...builtinConfig.servers,
        ...(userConfig?.servers ?? {}),
      },
    };

    const manager = new McpManager();
    await manager.connect(mergedConfig);
    if (manager.getAvailableTools().length === 0) {
      return { manager };
    }

    const mcpToolNames = getMcpToolNames(manager);
    const guidance = `\n\n## External Tools (MCP)

You have access to external tools that connect to real-time services. These tools are prefixed with \`mcp_\` and provide capabilities beyond the project files (e.g. web search, API calls, database queries).

Available MCP tools: ${mcpToolNames.join(", ")}

### research(query) — IMPORTANT: Use Proactively

Call \`research(query)\` whenever ANY of these conditions apply:
- You are about to use a library, framework, or API and are not 100% certain of the **current** (${new Date().getFullYear()}) syntax or configuration format
- The task mentions a specific version (e.g. "Tailwind v4", "Next.js 15", "React 19") — your training data may be outdated
- You need to check if a package/API still exists or has been renamed/deprecated
- You are writing configuration files (tsconfig, vite.config, tailwind.config, etc.) for a version you haven't seen in your training data
- The user asks for "latest" or "newest" anything

**DO NOT rely on your training data for version-specific details.** Your knowledge has a cutoff date. When in doubt, research first — it takes seconds and prevents hours of debugging wrong APIs.

### CRITICAL: Research results are INTERNAL context only

The output from research() is raw reference material for YOUR use only. NEVER paste, quote, or forward research results directly to the user. Instead:
- Read and digest the research findings silently
- Use the information to write correct code and make informed decisions
- If the user needs to know something you learned, express it in your own words as part of your narration — brief, relevant, and integrated naturally

Examples of when to call research:
- "What is the Tailwind CSS v4 configuration format?" (before writing tailwind.config)
- "React 19 useActionState API" (before using new React APIs)
- "Vite 6 config changes" (before writing vite.config.ts)
- "shadcn/ui latest install command" (before running install steps)`;
    return { manager, guidance };
  } catch (err) {
    console.warn(`[BuildSession ${session.id}] MCP setup failed:`, err instanceof Error ? err.message : err);
    return { manager: null };
  }
}

export function filesMapToArray(files: Map<string, string>): BuildFile[] {
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

/**
 * Auto-distill the per-project memory after a build with signal. Reads the
 * current memory, hands it + this build's outcome to the fast model, and asks
 * for a compact rewrite. Best-effort; persisted via storage (which caps size).
 */
async function distillProjectMemory(
  session: BuildSessionState,
  changedFiles: string[],
  summaryText: string,
  tele: BuildTelemetryRecord,
  emit?: SseEmit,
): Promise<void> {
  if (!session.projectId) return;
  const existing = await storage.getProjectMemory(session.projectId);
  const { client, model } = resolveAgentModel("memory", session.provider ?? "glm");
  const prompt = [
    "You maintain a concise, durable MEMORY doc for a software project. Rewrite it to incorporate what this build round revealed.",
    "Keep ONLY durable, project-specific learnings: implemented user-facing behavior that future work must preserve, changed files/modules and their ownership, architecture/tools/conventions in use, bugs hit and their fixes, recurring gotchas, regression risks, and ideas to revisit. Drop one-off trivia and anything already obvious. Merge duplicates. Use short markdown bullet sections.",
    "Treat completed behavior and changed files as current project truth: future agents should extend them, not delete/rewrite/regress them unless the user explicitly asks.",
    `Hard limit: ${PROJECT_MEMORY_MAX} characters. If over, compress — keep the most useful.`,
    "",
    "=== CURRENT MEMORY ===",
    existing || "(empty)",
    "",
    "=== THIS BUILD ROUND ===",
    `Plan: ${session.plan?.summary ?? ""}`,
    `Changed files: ${changedFiles.join(", ") || "(none)"}`,
    `Fix cycles: ${tele.fixCycles ?? 0}; LSP errors seen: ${tele.lspDiagnosticErrorCount ?? 0}`,
    `Summary: ${summaryText || "(none)"}`,
    "",
    "Output ONLY the new memory document (no preamble).",
  ].join("\n");
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    max_tokens: 1500,
  });
  const updated = completion.choices[0]?.message?.content?.trim();
  if (updated) {
    await storage.setProjectMemory(session.projectId, session.userId ?? "", updated);
    session.projectMemory = updated;
    emit?.({ type: "memory_updated", chars: updated.length, source: "distill" });
  }
}

export function buildBuilderSystemPrompt(session: BuildSessionState): string {
  const label = langNativeLabel(session.userLang || "English");
  const isEnglish = label === (session.userLang || "English") && label === "English";
  const langPrefix = isEnglish
    ? ""
    : `IMPORTANT: Write ALL narration and explanatory text in ${label}. Code identifiers, file paths, and code comments must remain in their original language.\n\n`;
  const memorySection = session.projectMemory && session.projectMemory.trim()
    ? `\n\n## Project Memory (learned from past sessions)\n\nThis is accumulated, project-specific knowledge from previous builds — implemented behavior to preserve, files/modules already changed, bugs hit and their fixes, architecture/tools in use, and gotchas. Treat it as authoritative context for THIS project: extend existing behavior and avoid deleting, rewriting, or regressing prior work unless the user explicitly asks. If you learn something durable this session, call update_project_memory to record it:\n\n${session.projectMemory.trim()}`
    : "";
  const skillSection = session.skillContent
    ? `\n\n## Technology & Capability Skill Guidance\n\nThese conventions and capability patterns are MANDATORY for this project — apply them as hard requirements, not suggestions. Where a capability includes a checklist, every applicable item must be satisfied before you consider a step complete:\n\n${session.skillContent}`
    : "";
  const sessionFiles = Array.from(session.files.entries()).map(([path, content]) => ({ path, content }));
  const resolvedFramework = session.framework || detectFramework(sessionFiles);
  const mobileSupplement = resolvedFramework !== "web"
    ? getMobilePromptSupplement("editor", resolvedFramework)
    : null;
  const mobileSection = mobileSupplement ? `\n${mobileSupplement}` : "";
  const compileCheckSection = buildEditorCompileCheckPrompt(resolvedFramework);
  const now = new Date();
  const dateSection = `\n\n## Current Date\n\nToday is ${now.toISOString().split("T")[0]} (${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}). Use this when making decisions about library versions, API compatibility, or anything time-sensitive.`;
  return `${langPrefix}${EDITOR_AGENT_SYSTEM_PROMPT}${dateSection}${memorySection}${skillSection}${mobileSection}${compileCheckSection}`;
}

export function buildBuilderInitialMessage(
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

  // Pre-load content of the FIRST step's required_files so the agent can
  // write immediately without a separate read_file round-trip. Capped at
  // 32KB total to avoid bloating the initial message.
  let preloadedContent = "";
  const firstStep = steps[0];
  if (firstStep?.required_files && allFiles.length > 0) {
    const PRE_LOAD_CAP = 32000;
    let preloadSize = 0;
    const preloaded: string[] = [];
    for (const rf of firstStep.required_files) {
      const file = allFiles.find(f => f.path === rf || f.path.endsWith(rf.replace(/^\/project\//, "")));
      if (file && file.content) {
        const entry = `--- ${file.path} ---\n${file.content}`;
        if (preloadSize + entry.length > PRE_LOAD_CAP) break;
        preloaded.push(entry);
        preloadSize += entry.length;
      }
    }
    if (preloaded.length > 0) {
      preloadedContent = `\n\n## Pre-loaded file content (step 1 — no need to read_file these)\n\n${preloaded.join("\n\n")}`;
    }
  }

  const contextPacket = buildEditorContextPacket({
    projectId: session.projectId,
    files: allFiles,
    userIntent: session.userRequest,
    plan: session.plan,
    steps,
    completedRoundSummary: session.completedRoundSummary,
    projectMemory: session.projectMemory,
    skillContent: session.skillContent,
    externalGuidance: session.explorerSummary,
  });
  const runtimeContextSection = `\n\n## Runtime Context Packet\n\n${renderContextPacket(contextPacket, {
    includeProjectMemory: false,
    includeSkillContent: false,
    includeExternalGuidance: true,
  })}`;

  const existingFilesWarning = allFiles.length > 0
    ? `\n\nExisting project files contain working code. Preserve them unless a plan step explicitly says otherwise. Prefer the explorer summary and required_files to choose targeted reads; do not repeat broad grep/list_files discovery unless a specific missing fact blocks the edit. Read an existing file before editing it unless it was pre-loaded or you just wrote it.\n`
    : "\n\nThis is an empty project. Start by creating the required files with write_file; do not spend tool rounds searching for files that do not exist.\n";

  const modePrefix = mode === "fix"
    ? `You are in FIX MODE. The quality reviewer found issues that need to be addressed.\n\n${previousIssues ? `Issues to fix:\n${previousIssues}\n\n` : ""}`
    : "";

  const followUpGuard = allFiles.length > 0
    ? "\n\nFollow-up modification rule: make the smallest safe delta on top of the current app. Do not reset, simplify, recreate, or remove existing screens, state, handlers, styles, or assets unless the current plan explicitly requests that change."
    : "";

  return `${modePrefix}${existingFilesWarning}${followUpGuard}

Here is the build plan you need to implement:

## Original Request
${session.userRequest}

## Plan Steps
${stepsList}
${filesList}${runtimeContextSection}${preloadedContent}

IMPORTANT: Implement the plan step by step. In the first 20 loop iterations, gather the context needed for correct edits; after that, converge toward write_file/edit_file/patch_file/hash_patch_file, mark_step_complete, or finish_build instead of continuing broad discovery unless a specific blocker remains. Preserve unrelated existing code and prior user-facing behavior, mark each completed step with mark_step_complete, then finish_build only after final checks, update_project_memory when files changed or durable facts were learned, and demo script submission.`;
}

export function buildBuilderStepMessage(
  session: BuildSessionState,
  allSteps: BuildStep[],
  currentStep: BuildStep,
  completedSteps: BuildStep[],
): string {
  const allFiles = filesMapToArray(session.files);
  const completedSection = completedSteps.length > 0
    ? completedSteps.map((s) => `- Step ${s.step}: ${s.title}`).join("\n")
    : "(none yet)";
  const futureSection = allSteps
    .filter((s) => s.step > currentStep.step)
    .map((s) => `- Step ${s.step}: ${s.title}`)
    .join("\n") || "(none)";
  const requiredFiles = Array.isArray(currentStep.required_files) && currentStep.required_files.length > 0
    ? currentStep.required_files.join(", ")
    : "(not specified; choose the minimum necessary files)";
  const filesList = allFiles.length > 0
    ? `\n\nExisting project files:\n${allFiles.map(f => `- ${f.path}`).join("\n")}`
    : "\n\nThe project currently has no files.";

  const preloaded: string[] = [];
  const PRE_LOAD_CAP = 32000;
  let preloadSize = 0;
  for (const rf of currentStep.required_files ?? []) {
    const file = allFiles.find(f => f.path === rf || f.path.endsWith(rf.replace(/^\/project\//, "")));
    if (file && file.content) {
      const entry = `--- ${file.path} ---\n${file.content}`;
      if (preloadSize + entry.length > PRE_LOAD_CAP) break;
      preloaded.push(entry);
      preloadSize += entry.length;
    }
  }
  const preloadedContent = preloaded.length > 0
    ? `\n\n## Pre-loaded file content for this step\n\n${preloaded.join("\n\n")}`
    : "";

  const contextPacket = buildEditorContextPacket({
    projectId: session.projectId,
    files: allFiles,
    userIntent: session.userRequest,
    plan: session.plan,
    steps: [currentStep],
    completedRoundSummary: session.completedRoundSummary,
    projectMemory: session.projectMemory,
    skillContent: session.skillContent,
    externalGuidance: session.explorerSummary,
  });
  const runtimeContextSection = `\n\n## Runtime Context Packet\n\n${renderContextPacket(contextPacket, {
    includeProjectMemory: false,
    includeSkillContent: false,
    includeExternalGuidance: true,
  })}`;

  return `You are executing ONE plan step in a sequential build.

## Hard Step Boundary
- Current executable step: Step ${currentStep.step} — ${currentStep.title}
- Implement ONLY this step's described behavior now.
- Do NOT pre-implement future steps. Leave later-step features for their own step loops unless they are unavoidable scaffolding for this step.
- When this step is done, call mark_step_complete with step_id "${currentStep.step}" and a concise summary.
- Do not call mark_step_complete for any other step.
- Do not call finish_build from this step loop.

## Original Request
${session.userRequest}

## Completed Steps
${completedSection}

## Current Step
Title: ${currentStep.title}
Description: ${currentStep.description}
Acceptance Criteria: ${currentStep.acceptance_criteria || "N/A"}
Required Files: ${requiredFiles}

## Future Steps (context only — do not implement yet)
${futureSection}
${filesList}${runtimeContextSection}${preloadedContent}

Focus this tool work and action log on Step ${currentStep.step}.`;
}


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
export function getAffectedSteps(issues: Array<{ affected_file?: string; description: string }>, plan: BuildStep[]): BuildStep[] {
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
export function buildTargetedFixPlan(
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
  editorDecisions: AgentModelDecision[],
  partCtx: PartEmitContext,
  emit: SseEmit,
  userSkillsLoaded: Awaited<ReturnType<typeof loadUserSkills>>,
): Promise<void> {
  const allSteps = waves.flatMap((w) => w.steps).sort((a, b) => a.step - b.step);
  for (const wave of waves) {
    if (session.aborted) return;

    const concurrent = wave.steps.length > 1;
    console.log(
      `[BuildSession ${session.id}] AG-10 running wave ${wave.index} ` +
        `with ${wave.steps.length} step(s) ${concurrent ? "in parallel" : "sequentially"}`,
    );

    await Promise.all(
      wave.steps.map(async (step) => {
        session.todoLedger?.start(step.step);
        if (session.todoLedger) emit({ type: "ledger_snapshot", ledger: session.todoLedger.snapshot() });
        emit({ type: "step_starting", stepNumber: step.step, stepTitle: step.title, totalSteps: allSteps.length });

        const stepEmit = withStepScope(emit, step.step);
        const completedSteps = allSteps.filter((s) => {
          if (s.step >= step.step) return false;
          return session.todoLedger?.resolve(s.step)?.status === "done";
        });
        const subInitialMessage = buildBuilderStepMessage(session, allSteps, step, completedSteps);
        const subExitSignal = { exit: false, reason: undefined as string | undefined };
        // Each sub-loop gets tools scoped to just this step, so mark_step_complete
        // does not try to auto-advance to a different wave's step.
        const subTools = buildEditorToolset(session, [step], stepEmit, userSkillsLoaded, {
          exitSignal: subExitSignal,
          allowedStepIds: [step.step, ...(step.sub_task_id ? [step.sub_task_id] : [])],
          completeOnlyCurrentStep: true,
          currentStepId: step.step,
        });
        await withModelFallback(editorDecisions, async (client, model, decision) => {
          await runAgentLoop(
            `${builderSystemPrompt}\n\n${subTools.toolManifest}`,
            [{ role: "user", content: subInitialMessage }],
            subTools.schemas,
            subTools.handlers,
            stepEmit,
            {
              exitTools: ["mark_step_complete"],
              maxIterations: 30,
              client,
              model,
              phase: "editor",
              runtimePolicy: {
                role: "editor",
                provider: decision.provider,
                model,
                maxIterations: 30,
                thinkingMode: "auto",
                routingMode: decision.routingMode,
                thinkingProfile: "adaptive",
                stallPolicy: {
                  discoveryNudgeMinIteration: 20,
                  discoveryNudgeThreshold: 4,
                },
                toolPolicies: subTools.policies,
              },
              partCtx,
              sessionId: session.id,
              exitSignal: subExitSignal,
              toolPolicies: subTools.policies,
            },
          );
        });
        const completed = session.todoLedger?.resolve(step.step)?.status === "done";
        if (!completed) {
          throw new Error(`Parallel step ${step.step} ended before mark_step_complete`);
        }
      }),
    );
  }
}

async function runBuilderSequentialSteps(
  session: BuildSessionState,
  steps: BuildStep[],
  builderSystemPrompt: string,
  editorDecisions: AgentModelDecision[],
  partCtx: PartEmitContext,
  emit: SseEmit,
  userSkillsLoaded: Awaited<ReturnType<typeof loadUserSkills>>,
  options: {
    telemetry: BuildTelemetry;
    mcpManager?: McpManager | null;
  },
): Promise<{
  exhausted: boolean;
  completedCount: number;
  telemetry?: { discoveryOnlyRounds: number; thinkingModeCounts: Record<string, number> };
}> {
  const aggregateTelemetry = {
    discoveryOnlyRounds: 0,
    thinkingModeCounts: {} as Record<string, number>,
  };
  const completedSteps: BuildStep[] = [];
  const stepMaxIterations = builderStepIterationBudget(steps.length);

  for (const step of steps) {
    if (session.aborted) break;
    const alreadyDone = session.todoLedger?.resolve(step.step)?.status === "done";
    if (alreadyDone) {
      completedSteps.push(step);
      continue;
    }

    session.todoLedger?.start(step.step);
    if (session.todoLedger) emit({ type: "ledger_snapshot", ledger: session.todoLedger.snapshot() });
    emit({ type: "step_starting", stepNumber: step.step, stepTitle: step.title, totalSteps: steps.length });

    const stepEmit = withStepScope(emit, step.step);
    const stepExitSignal = { exit: false, reason: undefined as string | undefined };
    const stepTools = buildEditorToolset(session, [step], stepEmit, userSkillsLoaded, {
      telemetry: options.telemetry,
      exitSignal: stepExitSignal,
      mcpManager: options.mcpManager,
      allowedStepIds: [step.step, ...(step.sub_task_id ? [step.sub_task_id] : [])],
      completeOnlyCurrentStep: true,
      currentStepId: step.step,
    });
    const stepInitialMessage = buildBuilderStepMessage(session, steps, step, completedSteps);

    const loopResult = await withModelFallback(editorDecisions, async (client, model, decision) => {
      const stepRuntime: AgentRunSpec["runtime"] = {
        role: "editor",
        provider: decision.provider,
        model,
        maxIterations: stepMaxIterations,
        thinkingMode: "auto",
        routingMode: decision.routingMode,
        thinkingProfile: "adaptive",
        maxOutputTokens: 12288,
        contextCompactionProfile: "preserve-memory",
        contextBudgetTokens: 80_000,
        stallPolicy: {
          discoveryNudgeMinIteration: 20,
          discoveryNudgeThreshold: 4,
        },
        toolPolicies: stepTools.policies,
      };
      return await runAgentLoop(
        `${builderSystemPrompt}\n\n${stepTools.toolManifest}`,
        [{ role: "user", content: stepInitialMessage }],
        stepTools.schemas,
        stepTools.handlers,
        stepEmit,
        {
          exitTools: ["mark_step_complete"],
          maxIterations: stepRuntime.maxIterations,
          client,
          model: stepRuntime.model,
          phase: "editor",
          partCtx,
          sessionId: session.id,
          exitSignal: stepExitSignal,
          toolPolicies: stepRuntime.toolPolicies,
          runtimePolicy: stepRuntime,
        },
      );
    });

    aggregateTelemetry.discoveryOnlyRounds += loopResult.telemetry?.discoveryOnlyRounds ?? 0;
    for (const [mode, count] of Object.entries(loopResult.telemetry?.thinkingModeCounts ?? {})) {
      aggregateTelemetry.thinkingModeCounts[mode] = (aggregateTelemetry.thinkingModeCounts[mode] ?? 0) + count;
    }

    const completed = session.todoLedger?.resolve(step.step)?.status === "done";
    if (!completed) {
      console.warn(
        `[build-session] step loop ended before completion sessionId=${session.id} ` +
          `step=${step.step} exhausted=${loopResult.exhausted} exitTool=${loopResult.exitTool || "(none)"}`,
      );
      return { exhausted: true, completedCount: completedSteps.length, telemetry: aggregateTelemetry };
    }
    completedSteps.push(step);
  }

  return { exhausted: false, completedCount: completedSteps.length, telemetry: aggregateTelemetry };
}

export async function runBuildSession(session: BuildSessionState, rawEmit: SseEmit): Promise<void> {
  const emit: SseEmit = rawEmit;
  const { plan, userRequest } = session;
  const initialFiles = filesMapToArray(session.files);
  let normalizedSteps = normalizeSteps(plan);
  let explorerTimedOut = false;
  if (initialFiles.length > 0) {
    try {
      const explorePromise = runExploreAgent(initialFiles, userRequest, { provider: session.provider });
      const timeoutPromise = new Promise<string>((resolve) => setTimeout(() => {
        explorerTimedOut = true;
        resolve("");
      }, 8000));
      session.explorerSummary = await Promise.race([explorePromise, timeoutPromise]);
      const suggestedFiles = extractExplorerSuggestedFiles(session.explorerSummary);
      normalizedSteps = fillMissingRequiredFiles(normalizedSteps, suggestedFiles, initialFiles);
      if (session.explorerSummary) {
        emit({
          type: "context_summary",
          role: "explorer",
          estimatedTokens: Math.ceil(session.explorerSummary.length / 4),
          fileCount: suggestedFiles.length,
          stepCount: normalizedSteps.length,
          hasProjectMemory: false,
          hasRoundSummary: false,
        });
      }
    } catch (err) {
      console.warn(`[BuildSession ${session.id}] explorer failed:`, err instanceof Error ? err.message : err);
    }
  }
  const totalSteps = normalizedSteps.length;
  session.todoLedger = new TodoLedger(normalizedSteps);

  const userProvider = session.provider ?? "glm";

  // AG-17: Telemetry accumulator. Writes one JSONL record on exit via
  // finally-block flush. Counter wiring happens inside tool handlers.
  const telemetry = new BuildTelemetry({
    id: session.id,
    projectId: session.projectId,
    framework: session.framework,
    provider: session.provider,
    userLang: session.userLang,
  });

  const editorDecisions = resolveAgentModelChain("editor", userProvider);
  for (const decision of editorDecisions) {
    telemetry.addModelRouteDecision(decision);
  }
  const providerChainEditor = editorDecisions.map((decision) => decision.provider);

  // Part-based emission context — all agent loops feed into this
  const partCtx: PartEmitContext = { parts: session.parts, files: session.files };
  session.status = { type: "busy", agent: "editor" };

  const [preparedContext, preparedMcp] = await Promise.all([
    prepareBuildContext(session, normalizedSteps, providerChainEditor),
    prepareMcpManager(session),
    prepareSessionWorkspace(session),
  ]);

  session.projectMemory = preparedContext.projectMemory;
  session.skillContent = appendSkillContent(preparedContext.skillContent, preparedMcp.guidance);
  const userSkillsLoaded = preparedContext.userSkillsLoaded;
  const mcpManager = preparedMcp.manager;
  if (preparedContext.activeCapabilities.length > 0) {
    emit({ type: "capabilities_active", capabilities: preparedContext.activeCapabilities });
  }

  const editorContextPacket = buildEditorContextPacket({
    projectId: session.projectId,
    files: initialFiles,
    userIntent: userRequest,
    plan,
    steps: normalizedSteps,
    completedRoundSummary: session.completedRoundSummary,
    projectMemory: session.projectMemory,
    skillContent: session.skillContent,
  });
  telemetry.setExplorerUsed(Boolean(session.explorerSummary), explorerTimedOut);
  const estimatedContextTokens = estimateContextPacketTokens(editorContextPacket);
  telemetry.setContextTokenSize(estimatedContextTokens);
  emit({
    type: "context_summary",
    role: "editor",
    estimatedTokens: estimatedContextTokens,
    fileCount: initialFiles.length,
    stepCount: totalSteps,
    hasProjectMemory: !!session.projectMemory?.trim(),
    hasRoundSummary: !!session.completedRoundSummary?.trim(),
  });

  emit({ type: "ledger_snapshot", ledger: session.todoLedger.snapshot() });

  // AG-10: Analyze step dependencies. By default execution stays sequential,
  // but each plan step still gets its own scoped agent loop so work/logs stay
  // attached to the correct step. When AG10_PARALLEL=1 is set, each wave is
  // executed with one scoped loop per step and steps inside a wave may run
  // concurrently via Promise.all().
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

  let builderStoppedEarly = false;
  try {
    await telemetry.time("builder", async () => {
      if (shouldRunParallel) {
        await runBuilderParallelWaves(session, waves, builderSystemPrompt, editorDecisions, partCtx, emit, userSkillsLoaded);
      } else {
        const stepRunResult = await runBuilderSequentialSteps(
          session,
          normalizedSteps,
          builderSystemPrompt,
          editorDecisions,
          partCtx,
          emit,
          userSkillsLoaded,
          { telemetry, mcpManager },
        );
        telemetry.addDiscoveryOnlyRounds(stepRunResult.telemetry?.discoveryOnlyRounds ?? 0);
        for (const [mode, count] of Object.entries(stepRunResult.telemetry?.thinkingModeCounts ?? {})) {
          telemetry.addThinkingMode(mode, count);
        }
        if (stepRunResult.exhausted) {
          const completed = stepRunResult.completedCount;
          const message =
            completed > 0
              ? `Agent paused after reaching the iteration budget (${completed}/${normalizedSteps.length} steps completed). Continue the build to finish the remaining steps.`
              : "Agent reached the iteration budget before completing a build step. Try breaking the task into smaller steps or continuing with a narrower request.";
          console.warn(
            `[build-session] builder iteration budget exhausted sessionId=${session.id} ` +
              `completed=${completed}/${normalizedSteps.length}`,
          );
          emit({ type: "build_error", message });
          emit({ type: "done" });
          telemetry.setFinalStatus("error", message);
          await telemetry.flush();
          if (mcpManager) mcpManager.disconnect().catch(() => {});
          builderStoppedEarly = true;
          return;
        }
      }
    });
    if (builderStoppedEarly) return;
    if (!session.aborted && session.todoLedger?.snapshot().allDone) {
      emit({ type: "build_complete" });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[build-session] BUILDER THREW sessionId=${session.id}: ${message}`);
    emit({ type: "build_error", message });
    emit({ type: "done" });
    telemetry.setFinalStatus("error", message);
    await telemetry.flush();
    // Clean up MCP on error path
    if (mcpManager) mcpManager.disconnect().catch(() => {});
    return;
  }

  console.log(`[build-session] POST-LOOP sessionId=${session.id} aborted=${session.aborted}`);

  if (session.aborted) {
    emit({ type: "done" });
    telemetry.setFinalStatus("aborted");
    await telemetry.flush();
    // Clean up MCP on abort path
    if (mcpManager) mcpManager.disconnect().catch(() => {});
    return;
  }

  // Build mode ends here, deterministically. Review is a SEPARATE, user-invoked
  // step (see review-orchestrator.ts / POST /api/review-session) and is no longer
  // part of the build loop. The build always proceeds to its completion summary.
  const passed = true;

  if (passed) {
    const beforeMap = new Map(initialFiles.map(f => [f.path, f.content]));
    const finalFiles = filesMapToArray(session.files);
    const changedFiles = finalFiles
      .filter(f => !beforeMap.has(f.path) || beforeMap.get(f.path) !== f.content)
      .map(f => f.path);

    // Generate a concise end-of-round summary server-side so the client doesn't
    // need a second fetch. Uses the fastest available model (MiniMax → Doubao-lite)
    // for low latency, and runs for BOTH plan and direct mode so every build
    // round gives the user clear feedback on what was done.
    let summaryText = "";
    try {
      const commPrompt = buildCommunicatorMessage({
        event: "all_complete",
        userLanguage: session.userLang || "English",
        changedFiles,
        planSummary: plan.summary ?? session.userRequest ?? "",
        totalSteps: normalizedSteps.length,
        stepTitles: normalizedSteps.map(s => s.title),
      } as CommunicatorEvent);
      const communicatorDecision = resolveAgentModel("communicator", session.provider ?? "glm");
      const { client, model } = communicatorDecision;
      telemetry.addModelRouteDecision(communicatorDecision);
      const summaryCompletion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: COMMUNICATOR_AGENT_SYSTEM_PROMPT },
          { role: "user", content: commPrompt },
        ],
        stream: false,
        max_tokens: 512,
      });
      summaryText = summaryCompletion.choices[0]?.message?.content || "";
      // Strip <think>...</think> blocks that some models emit
      summaryText = summaryText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    } catch {}

    let nextStepSuggestion = "";
    const nextStepMatch = summaryText.match(/^NEXT_STEP:\s*(.+)$/m);
    if (nextStepMatch) {
      nextStepSuggestion = nextStepMatch[1].trim();
      summaryText = summaryText.replace(/\nNEXT_STEP:.*$/m, "").trim();
    }

    // Persist the final file SET before all_complete. This converges DB state to
    // the in-memory build result, including deletes (single-file upsert cannot).
    if (session.projectId) {
      try {
        await storage.upsertProjectFiles(session.projectId, finalFiles);
      } catch (err) {
        console.warn(
          "[BuildSession] Failed to persist final files:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (session.projectId) {
      try {
        await storage.updateProjectBuildResult(session.projectId, {
          changedFiles,
          summary: plan.summary ?? "",
          completedAt: Date.now(),
        });
      } catch (err) {
        console.warn("[BuildSession] Failed to persist build result:", err instanceof Error ? err.message : err);
      }
    }

    const roundSummary = [
      `Implemented: ${summaryText || plan.summary || session.userRequest || "(summary unavailable)"}`,
      `Changed files: ${changedFiles.join(", ") || "(none)"}`,
      "Preservation: keep prior user-facing behavior and unrelated existing code unless the user explicitly asks to change it.",
    ].join("\n");
    session.completedRoundSummary = roundSummary;

    try {
      session.todoLedger?.assertAllDone();
      telemetry.setLedgerCompletionConsistent(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[build-session] ledger completion mismatch sessionId=${session.id}: ${message}`);
      emit({ type: "build_error", message });
      telemetry.setLedgerCompletionConsistent(false);
      telemetry.setFinalStatus("error", message);
      await telemetry.flush();
      if (mcpManager) mcpManager.disconnect().catch(() => {});
      return;
    }

    emit({ type: "ledger_snapshot", ledger: session.todoLedger?.snapshot() });
    emit({ type: "all_complete", changedFiles, summary: plan.summary ?? "", summaryText, nextStepSuggestion, roundSummary });
    console.log(`[build-session] EMITTING all_complete sessionId=${session.id} changedFiles=${changedFiles.length}`);

    // Auto-distill project memory (safety net for when the agent didn't call
    // update_project_memory itself). Only runs when there's signal — files
    // changed or the build needed fix cycles — so trivial builds don't spend an
    // LLM call. Fire-and-forget: never blocks all_complete.
    if (session.projectId) {
      const tele = telemetry.snapshot();
      const hasSignal = changedFiles.length > 0 || (tele.fixCycles ?? 0) > 0 || (tele.lspDiagnosticErrorCount ?? 0) > 0;
      if (hasSignal) {
        void distillProjectMemory(session, changedFiles, summaryText, tele, emit).catch((err) =>
          console.warn(`[BuildSession ${session.id}] memory distill failed:`, err instanceof Error ? err.message : err),
        );
      }
    }
  }

  session.status = { type: "idle" };
  if (!passed) telemetry.setFinalStatus(session.aborted ? "aborted" : "fail");
  telemetry.setFixCycle(0);
  await telemetry.flush();

  // Disconnect MCP servers (best-effort, non-blocking)
  if (mcpManager) {
    mcpManager.disconnect().catch((err) =>
      console.warn(`[BuildSession ${session.id}] MCP disconnect failed:`, err instanceof Error ? err.message : err),
    );
  }

  emit({ type: "done" });
}
