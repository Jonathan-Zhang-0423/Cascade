import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { EDITOR_AGENT_SYSTEM_PROMPT } from "../prompts/editor-prompt";
import { COMMUNICATOR_AGENT_SYSTEM_PROMPT, buildCommunicatorMessage, type CommunicatorEvent } from "../prompts/communicator-prompt";
import { detectSkillsFromText, loadSkills, getSkillForFramework } from "../../skills/loader";
import { detectCapabilitiesDetailed, loadCapabilitiesTiered } from "../../skills/capability-loader";
import { runAgentLoop } from "../loop/agent-loop";
import { buildFallbackChain, withFallback, getFastClient, type AIProvider } from "../providers/kimi-client";
import { storage, PROJECT_MEMORY_MAX } from "../../infra/storage";
import { BuildTelemetry, type BuildTelemetryRecord } from "../../infra/telemetry";
import {
  buildBuilderTools,
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
import { buildMcpTools, getMcpToolNames } from "../mcp/mcp-tools";
import { runResearchAgent } from "../mcp/research-agent";

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
}

export type SseEmit = (data: Record<string, unknown>) => void;

function normalizeSteps(plan: BuildPlan): BuildStep[] {
  const raw = plan.steps ?? plan.sub_tasks ?? [];
  return raw.map((s, i) => ({ ...s, step: s.step ?? i + 1 }));
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
): Promise<void> {
  if (!session.projectId) return;
  const existing = await storage.getProjectMemory(session.projectId);
  const { client, model } = getFastClient();
  const prompt = [
    "You maintain a concise, durable MEMORY doc for a software project. Rewrite it to incorporate what this build round revealed.",
    "Keep ONLY durable, project-specific learnings: architecture/tools/conventions in use, bugs hit and their fixes, recurring gotchas, and ideas to revisit. Drop one-off trivia and anything already obvious. Merge duplicates. Use short markdown bullet sections.",
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
  }
}

export function buildBuilderSystemPrompt(session: BuildSessionState): string {
  const label = langNativeLabel(session.userLang || "English");
  const isEnglish = label === (session.userLang || "English") && label === "English";
  const langPrefix = isEnglish
    ? ""
    : `IMPORTANT: Write ALL narration and explanatory text in ${label}. Code identifiers, file paths, and code comments must remain in their original language.\n\n`;
  const memorySection = session.projectMemory && session.projectMemory.trim()
    ? `\n\n## Project Memory (learned from past sessions)\n\nThis is accumulated, project-specific knowledge from previous builds — bugs hit and their fixes, the architecture/tools in use, and gotchas. Treat it as authoritative context for THIS project and avoid repeating past mistakes. If you learn something durable this session, call update_project_memory to record it:\n\n${session.projectMemory.trim()}`
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
4. After ALL steps are done, call finish_build.

Preserve ALL existing content that is not part of the current step. Never truncate or omit existing code.`;
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
  providerChainEditor: AIProvider[],
  partCtx: PartEmitContext,
  emit: SseEmit,
  userSkillsLoaded: Awaited<ReturnType<typeof loadUserSkills>>,
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
        subTools.schemas.push(...userSkillsLoaded.toolSchemas);
        Object.assign(subTools.handlers, userSkillsLoaded.toolHandlers);
        await withFallback(providerChainEditor, async (client, model) => {
          await runAgentLoop(
            builderSystemPrompt,
            [{ role: "user", content: subInitialMessage }],
            subTools.schemas,
            subTools.handlers,
            emit,
            {
              exitTools: ["finish_build", "mark_step_complete"],
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

export async function runBuildSession(session: BuildSessionState, rawEmit: SseEmit): Promise<void> {
  const emit: SseEmit = rawEmit;
  const { plan, userRequest } = session;
  const normalizedSteps = normalizeSteps(plan);
  const totalSteps = normalizedSteps.length;
  const initialFiles = filesMapToArray(session.files);

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

    // Capability skills (game design, frontend design, completeness checks, ...)
    // are an additive track — keyword-detected (no LLM) and appended after the
    // tech-stack skill so they never compete for the 2 tech-stack slots above.
    const detectedCapMatches = await detectCapabilitiesDetailed(planText);
    if (detectedCapMatches.length > 0) {
      console.log(
        `[build-session] capability skills active: ${detectedCapMatches
          .map((m) => `${m.name}[${m.tier}](score=${m.score} via ${m.matched.slice(0, 3).join(",")})`)
          .join("; ")}`,
      );
      const capContent = await loadCapabilitiesTiered(detectedCapMatches);
      if (capContent) {
        session.skillContent = session.skillContent
          ? `${session.skillContent}\n\n---\n\n${capContent}`
          : capContent;
        emit({ type: "capabilities_active", capabilities: detectedCapMatches.map((m) => ({ name: m.name, score: m.score, tier: m.tier })) });
      }
    }
  }

  // Load the per-project self-evolving memory doc (injected first as authoritative
  // context by buildBuilderSystemPrompt). Best-effort — never block the build.
  if (session.projectId && !session.projectMemory) {
    try {
      session.projectMemory = await storage.getProjectMemory(session.projectId);
    } catch (err) {
      console.warn(`[BuildSession ${session.id}] getProjectMemory failed:`, err instanceof Error ? err.message : err);
    }
  }

  // Load user-defined skills (knowledge packs + tool plugins) from project files and DB
  const userSkillsLoaded = await loadUserSkills(
    session,
    session.projectId ?? "",
    session.userId ?? "",
  );
  if (userSkillsLoaded.knowledgePacks.length > 0) {
    const userKnowledge = userSkillsLoaded.knowledgePacks.join("\n\n---\n\n");
    session.skillContent = session.skillContent
      ? `${session.skillContent}\n\n---\n\n${userKnowledge}`
      : userKnowledge;
  }

  // MCP: Always start built-in search server; merge user config on top.
  // Failures are non-blocking — a broken server won't stop the build.
  let mcpManager: McpManager | null = null;
  try {
    const builtinConfig = getBuiltinMcpConfig();
    const userConfig = loadMcpConfig(session);
    const mergedConfig: McpConfig = {
      servers: {
        ...builtinConfig.servers,
        ...(userConfig?.servers ?? {}),
      },
    };

    mcpManager = new McpManager();
    await mcpManager.connect(mergedConfig);
    if (mcpManager.getAvailableTools().length > 0) {
      const mcpToolNames = getMcpToolNames(mcpManager);
      // Inject MCP tool guidance into the skill content so the editor knows how to use them
      const mcpGuidance = `\n\n## External Tools (MCP)

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

Examples of when to call research:
- "What is the Tailwind CSS v4 configuration format?" (before writing tailwind.config)
- "React 19 useActionState API" (before using new React APIs)
- "Vite 6 config changes" (before writing vite.config.ts)
- "shadcn/ui latest install command" (before running install steps)`;
      session.skillContent = session.skillContent
        ? `${session.skillContent}${mcpGuidance}`
        : mcpGuidance;
    }
  } catch (err) {
    console.warn(`[BuildSession ${session.id}] MCP setup failed:`, err instanceof Error ? err.message : err);
    mcpManager = null;
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
        await runBuilderParallelWaves(session, waves, builderSystemPrompt, providerChainEditor, partCtx, emit, userSkillsLoaded);
      } else {
        const builderInitialMessage = buildBuilderInitialMessage(session, normalizedSteps, "build");
        // Shared exit signal: completing the final plan step trips this so the
        // builder loop ends deterministically (instead of waiting on the model
        // to emit finish_build, which it sometimes only narrates).
        const builderExitSignal = { exit: false, reason: undefined as string | undefined };
        const builderTools = buildBuilderTools(session, normalizedSteps, telemetry, builderExitSignal);
        // Merge user-defined tool plugins into builder tools
        builderTools.schemas.push(...userSkillsLoaded.toolSchemas);
        Object.assign(builderTools.handlers, userSkillsLoaded.toolHandlers);
        // Merge MCP tools into builder tools
        if (mcpManager && mcpManager.getAvailableTools().length > 0) {
          const mcpTools = buildMcpTools(mcpManager, emit);
          builderTools.schemas.push(...mcpTools.schemas);
          Object.assign(builderTools.handlers, mcpTools.handlers);

          // Register the research sub-agent tool — lets the builder spawn a
          // focused research agent that uses MCP tools to gather external info.
          builderTools.schemas.push({
            type: "function",
            function: {
              name: "research",
              description: "Run a focused research sub-agent to find external information from the web. Use this when you need current docs, API references, best practices, version numbers, or any information not available in the project files. The sub-agent will search the web and return a synthesized answer.",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The research question — be specific. E.g. 'What is the latest TailwindCSS v4 configuration format?' or 'How to configure ESLint flat config for TypeScript?'",
                  },
                },
                required: ["query"],
              },
            },
          });
          const capturedMcpManager = mcpManager;
          builderTools.handlers["research"] = async (args, emitFn) => {
            const query = args.query as string;
            if (!query) return "Error: query is required";
            emitFn({ type: "action_log", actionType: "research", label: "Research", detail: query.slice(0, 100) });
            const result = await runResearchAgent(query, capturedMcpManager, emitFn);
            // Emit research result summary so the UI shows completion
            const wordCount = result ? result.split(/\s+/).length : 0;
            const sourceCount = (result?.match(/https?:\/\//g) || []).length;
            const summaryLine = sourceCount > 0
              ? `Found ${sourceCount} source(s), ${wordCount} words`
              : `${wordCount} words`;
            emitFn({ type: "action_log", actionType: "research", label: "Research complete", detail: summaryLine });
            return result || "(No findings)";
          };
        }
        await withFallback(providerChainEditor, async (client, model) => {
          await runAgentLoop(
            builderSystemPrompt,
            [{ role: "user", content: builderInitialMessage }],
            builderTools.schemas,
            builderTools.handlers,
            emit,
            { exitTools: ["finish_build"], maxIterations: 100, emitOnIterationExhausted: true, client, model, partCtx, sessionId: session.id, exitSignal: builderExitSignal },
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
    // Clean up MCP on error path
    if (mcpManager) mcpManager.disconnect().catch(() => {});
    return;
  }

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
        planSummary: plan.summary ?? "",
      } as CommunicatorEvent);
      const { client, model } = getFastClient();
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

    emit({ type: "all_complete", changedFiles, summary: plan.summary ?? "", summaryText, nextStepSuggestion });

    // Persist changed files to the DB BEFORE the client triggers its post-build
    // file refetch. The frontend's syncFilesToServer is debounced (1s), so on a
    // refresh shortly after all_complete the server might still hold the previous
    // iteration. Awaiting the upsert here makes the DB authoritative the moment
    // the client receives all_complete.
    if (session.projectId && changedFiles.length > 0) {
      const finalMap = new Map(finalFiles.map(f => [f.path, f.content]));
      try {
        await Promise.all(
          changedFiles.map((p) =>
            storage.upsertProjectFile(session.projectId!, p, finalMap.get(p) ?? ""),
          ),
        );
      } catch (err) {
        console.warn(
          "[BuildSession] Failed to persist changed files:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (session.projectId) {
      storage.updateProjectBuildResult(session.projectId, {
        changedFiles,
        summary: plan.summary ?? "",
        completedAt: Date.now(),
      }).catch(() => {});
    }

    // Auto-distill project memory (safety net for when the agent didn't call
    // update_project_memory itself). Only runs when there's signal — files
    // changed or the build needed fix cycles — so trivial builds don't spend an
    // LLM call. Fire-and-forget: never blocks all_complete.
    if (session.projectId) {
      const tele = telemetry.snapshot();
      const hasSignal = changedFiles.length > 0 || (tele.fixCycles ?? 0) > 0 || (tele.lspDiagnosticErrorCount ?? 0) > 0;
      if (hasSignal) {
        void distillProjectMemory(session, changedFiles, summaryText, tele).catch((err) =>
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
