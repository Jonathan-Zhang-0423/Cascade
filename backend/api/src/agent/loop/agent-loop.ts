import { doubaoClient, DOUBAO_MODEL } from "../providers/doubao-client";
import { withRetry } from "../providers/retry";
import { aiSemaphore, CONCURRENCY_QUEUE_TIMEOUT } from "../../infra/concurrency";
import type { SseEmit } from "../../infra/sse";
import type OpenAI from "openai";
import { createModelAdapter, type AgentLoopPhase, type ModelAdapter } from "../providers/model-adapter";
import {
  createPart,
  emitPart,
  updateToolState,
  generatePartId,
  type Part,
  type ToolPart,
  type PartEmitContext,
} from "../../infra/parts";

export type ToolHandler = (args: Record<string, unknown>, emit: SseEmit) => Promise<string>;
export type ToolHandlers = Record<string, ToolHandler>;

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface AgentLoopResult {
  finalText: string;
  exitTool?: string;
  exitArgs?: Record<string, unknown>;
  tokenUsage?: { input: number; output: number; total: number };
}

interface PendingToolCall {
  id: string;
  name: string;
  argsRaw: string;
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface AgentLoopOpts {
  maxIterations?: number;
  exitTools?: string[];
  client?: OpenAI;
  model?: string;
  disableThinking?: boolean;
  phase?: AgentLoopPhase;
  /** Part-based emission context. When provided, the loop emits structured
   *  Parts instead of raw SSE events directly. */
  partCtx?: PartEmitContext;
  /** Session ID for part creation. Required when partCtx is provided. */
  sessionId?: string;
  /**
   * When true, emit build_error to the client if maxIterations is reached
   * without a proper exit. Only enable for the main builder loop — sub-agents
   * (manager, explore) should not surface this as a user-visible error.
   */
  emitOnIterationExhausted?: boolean;
  /**
   * Shared exit signal. A tool handler can set `.exit = true` to force the loop
   * to stop after the current tool round, even if no exitTool was called. Used
   * by the builder so completing the last plan step ends the loop deterministically
   * instead of waiting on the model to emit a separate finish_build tool call
   * (which it sometimes only narrates, leaving the loop spinning to maxIterations).
   */
  exitSignal?: { exit: boolean; reason?: string };
  /**
   * Model adapter — encapsulates per-model thinking params, timeout, and
   * reasoning extraction. When provided, replaces the hardcoded model detection.
   * If omitted, auto-created from client+model via createModelAdapter().
   */
  adapter?: ModelAdapter;
}

export async function runAgentLoop(
  systemPrompt: string,
  initialMessages: Array<{ role: "user" | "assistant"; content: string }>,
  tools: ToolSchema[],
  handlers: ToolHandlers,
  emit: SseEmit,
  opts: AgentLoopOpts = {},
): Promise<AgentLoopResult> {
  const maxIterations = opts.maxIterations ?? 30;
  const exitTools = new Set(opts.exitTools ?? []);

  const activeClient = opts.client ?? doubaoClient;
  const activeModel = opts.model ?? DOUBAO_MODEL;

  const partCtx = opts.partCtx;
  const sessionId = opts.sessionId ?? "default";

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...initialMessages,
  ];

  let finalText = "";
  let exitTool: string | undefined;
  let exitArgs: Record<string, unknown> | undefined;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let emptyNudgeCount = 0; // bounded nudge counter for empty responses
  let previousToolCallCount = 0;
  let previousToolErrorCount = 0;

  // Model adapter: encapsulates per-model thinking params, timeout, and
  // reasoning extraction. Auto-created from client+model if not provided.
  const adapter = opts.adapter ?? createModelAdapter(activeClient, activeModel);

  const timeoutMs = adapter.timeoutMs;

  // Sliding-window compaction: keep the system prompt + initial user message +
  // the most recent tool results full; shrink OLDER tool results (mostly big
  // read_file dumps) to a stub. Prevents context from growing unbounded over
  // 20+ iterations, which was causing GLM-5 to time out mid-stream ('terminated').
  const KEEP_RECENT_TOOL_RESULTS = 6; // last ~3 iterations' worth stay full
  const OLD_TOOL_RESULT_STUB = "(earlier tool output elided to save context — call read_file again if you need it)";
  // After N iterations, compact the system prompt by stripping the bulky
  // skill/capability guidance (it's been absorbed by then). Saves 10-50KB.
  const COMPACT_SYSTEM_PROMPT_AFTER = 5;
  let systemPromptCompacted = false;

  function compactOldToolResults(): void {
    // Find indices of tool-role messages (results)
    const toolIdxs: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      if ((messages[i] as any).role === "tool") toolIdxs.push(i);
    }
    // Stub all but the most recent KEEP_RECENT_TOOL_RESULTS — but only
    // if the result is long (>500 chars). Short results like "File written
    // successfully" or "Step marked complete" stay (tiny, useful context).
    const MIN_STUB_LENGTH = 500;
    const cutoff = toolIdxs.length - KEEP_RECENT_TOOL_RESULTS;
    for (let k = 0; k < cutoff; k++) {
      const idx = toolIdxs[k];
      const m = messages[idx] as any;
      if (typeof m.content === "string" && m.content.length > MIN_STUB_LENGTH && m.content !== OLD_TOOL_RESULT_STUB) {
        m.content = OLD_TOOL_RESULT_STUB;
      }
    }
  }

  function compactSystemPrompt(): void {
    if (systemPromptCompacted) return;
    systemPromptCompacted = true;
    const sys = messages[0] as any;
    if (!sys || sys.role !== "system") return;
    const content = sys.content as string;
    // Strip the bulky sections (skills, capabilities, memory) — they were
    // only needed for initial context. The agent has internalized them.
    const stripped = content
      .replace(/\n\n## Technology & Capability Skill Guidance[\s\S]*?(?=\n\n## |$)/, "\n\n(skill guidance compacted — conventions already applied)")
      .replace(/\n\n## Project Memory[\s\S]*?(?=\n\n## |$)/, "");
    if (stripped.length < content.length * 0.8) {
      sys.content = stripped;
    }
  }

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Each iteration is a "message" from the AI perspective
    const messageId = generatePartId();

    // Compact old tool results before sending (bounds context growth)
    compactOldToolResults();
    // After N iterations, strip bulky skill/memory sections from system prompt
    if (iteration >= COMPACT_SYSTEM_PROMPT_AFTER) compactSystemPrompt();

    // Safety valve: if iterations are excessive relative to what a build should
    // need, inject a strong finish reminder. A 5-step plan shouldn't need > 50
    // iterations. This catches "infinite loop" scenarios where the agent keeps
    // writing/reading without marking steps complete or calling finish_build.
    if (iteration > 0 && iteration % 25 === 0 && tools.length > 0) {
      console.warn(`[agent-loop] iteration ${iteration + 1}: injecting finish reminder (session=${sessionId})`);
      messages.push({ role: "user", content: "IMPORTANT: You have been running for many iterations. If all steps are complete, call finish_build NOW. If steps remain, call mark_step_complete for each completed step, then finish_build. Do not continue indefinitely." } as any);
    }

    // ── Step Start ──────────────────────────────────────────────────
    if (partCtx) {
      const stepStart = createPart("step-start", sessionId, messageId, { step: iteration + 1 });
      emitPart(partCtx, emit, stepStart);
    }

    let response: any;
    try {
      response = await aiSemaphore.run(
        () => withRetry(
          `runAgentLoop iteration ${iteration + 1}`,
          () => {
            const { thinkingParam, extraBody } = adapter.getThinkingConfig({
              disabled: opts.disableThinking,
              outputTokensSoFar: totalOutputTokens,
              iteration,
              maxIterations,
              consecutiveNoToolCalls: emptyNudgeCount,
              previousToolCallCount,
              previousToolErrorCount,
              phase: opts.phase,
            });
            const thinkingType = (thinkingParam as any).thinking?.type ?? (extraBody as any)?.thinking?.type ?? "none";
            const reasoningEffort = (thinkingParam as any).reasoning_effort ?? (extraBody as any)?.reasoning_effort ?? "none";
            console.log(
              `[agent-loop] thinking config model=${activeModel} adapter=${adapter.name} iteration=${iteration + 1} ` +
                `phase=${opts.phase ?? "unknown"} thinking=${thinkingType} reasoning_effort=${reasoningEffort} ` +
                `emptyNudges=${emptyNudgeCount} prevToolCalls=${previousToolCallCount} prevToolErrors=${previousToolErrorCount}`,
            );
            return activeClient.chat.completions.create(
              {
                model: activeModel,
                messages,
                ...thinkingParam,
                ...(extraBody ? { extra_body: extraBody } : {}),
                tools: tools.length > 0 ? (tools as OpenAI.Chat.Completions.ChatCompletionTool[]) : undefined,
                tool_choice: tools.length > 0 ? "auto" : undefined,
                stream: true,
                stream_options: { include_usage: true },
                max_tokens: 16384,
              } as any,
              { timeout: timeoutMs },
            );
          },
        ),
        CONCURRENCY_QUEUE_TIMEOUT,
      );
    } catch (err: unknown) {
      // If create itself fails with a transient error, retry this iteration
      const msg = err instanceof Error ? err.message : String(err);
      if (/terminated|ECONNRESET|ETIMEDOUT|socket hang up|UND_ERR/i.test(msg) && iteration < maxIterations - 1) {
        console.warn(`[agent-loop] transient error on create (iteration ${iteration + 1}): ${msg}. Retrying iteration...`);
        iteration--; // will be incremented by the for-loop, effectively retrying
        continue;
      }
      throw err;
    }

    let assistantText = "";
    let reasoningContent = "";
    const toolCallsMap: Record<string, PendingToolCall> = {};

    // Track Parts for this iteration (for in-place updates)
    let textPart: Part | undefined;
    let reasoningPart: Part | undefined;
    let inThinkTag = false; // Filter <think> blocks from narration stream

    // Wrap streaming in try/catch to handle mid-stream disconnects (terminated)
    let streamTerminated = false;
    try {
    for await (const chunk of response as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta as typeof choice.delta & {
        reasoning_content?: string;
        reasoning_details?: Array<{ type?: string; text?: string }>;
      };

      // ── Reasoning tokens (model-agnostic via adapter) ─────────────
      const reasoningToken = adapter.extractReasoning(delta);
      if (reasoningToken) {
        if (!reasoningContent) {
          console.log(`[agent-loop] first thinking_token from ${activeModel}, iteration=${iteration + 1}`);
        }
        reasoningContent += reasoningToken;

        if (partCtx) {
          if (!reasoningPart) {
            reasoningPart = createPart("reasoning", sessionId, messageId, { text: reasoningContent });
            emitPart(partCtx, emit, reasoningPart, reasoningToken);
          } else {
            (reasoningPart as any).text = reasoningContent;
            emit({ type: "thinking_token", token: reasoningToken });
          }
        } else {
          emit({ type: "thinking_token", token: reasoningToken });
        }
      }

      // ── Text tokens ─────────────────────────────────────────────
      if (delta.content) {
        if (!assistantText) {
          console.log(`[agent-loop] first narration_token from ${activeModel}, iteration=${iteration + 1}`);
        }
        assistantText += delta.content;

        // Filter out <think> blocks from narration stream — some models
        // (DeepSeek, etc.) emit reasoning inside content instead of
        // reasoning_content, causing raw <think> tags in the UI.
        // We buffer and suppress content inside <think>...</think>.
        if (delta.content.includes("<think>")) inThinkTag = true;
        if (!inThinkTag) {
          if (partCtx) {
            if (!textPart) {
              textPart = createPart("text", sessionId, messageId, { text: assistantText });
              emitPart(partCtx, emit, textPart, delta.content);
            } else {
              (textPart as any).text = assistantText;
              emit({ type: "narration_token", token: delta.content });
            }
          } else {
            emit({ type: "narration_token", token: delta.content });
          }
        }
        if (delta.content.includes("</think>")) inThinkTag = false;
      }

      // ── Tool calls (accumulate) ─────────────────────────────────
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = String(tc.index ?? 0);
          if (!toolCallsMap[idx]) {
            toolCallsMap[idx] = { id: tc.id ?? "", name: tc.function?.name ?? "", argsRaw: "" };
          }
          if (tc.id) toolCallsMap[idx].id = tc.id;
          if (tc.function?.name) toolCallsMap[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCallsMap[idx].argsRaw += tc.function.arguments;
        }
      }

      if (choice.finish_reason && choice.finish_reason !== "tool_calls") {
        finalText = assistantText;
      }

      // ── Usage (last chunk carries usage when stream_options.include_usage=true) ──
      if ((chunk as any).usage) {
        const u = (chunk as any).usage as { prompt_tokens?: number; completion_tokens?: number };
        totalInputTokens += u.prompt_tokens ?? 0;
        totalOutputTokens += u.completion_tokens ?? 0;
      }
    }
    } catch (streamErr: unknown) {
      // Mid-stream disconnect (terminated/ECONNRESET) — retry this iteration
      const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
      if (/terminated|ECONNRESET|ETIMEDOUT|socket hang up|UND_ERR/i.test(msg) && iteration < maxIterations - 1) {
        console.warn(`[agent-loop] stream terminated mid-iteration ${iteration + 1}: ${msg}. Retrying...`);
        streamTerminated = true;
        iteration--; // will be incremented by the for-loop, effectively retrying
        continue;
      }
      throw streamErr;
    }

    const toolCalls = Object.values(toolCallsMap);

    if (toolCalls.length === 0) {
      previousToolCallCount = 0;
      previousToolErrorCount = 0;
      // ── Step Finish (no tool calls → stop) ──────────────────────
      console.warn(`[agent-loop] iteration ${iteration + 1} ended with NO tool_calls. assistantText.length=${assistantText.length} reasoningContent.length=${reasoningContent.length} model=${activeModel} sessionId=${sessionId} inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens}`);

      // GLM and some models sometimes fail to emit tool_calls or return
      // completely empty responses. Nudge them to continue with tools.
      // Bounded: max 3 consecutive nudges to avoid infinite loops.
      const isEmptyOrThinkingOnly = assistantText.length === 0;
      if (isEmptyOrThinkingOnly && iteration < maxIterations - 1 && tools.length > 0) {
        emptyNudgeCount++;
        if (emptyNudgeCount <= 3) {
          console.log(`[agent-loop] Empty/thinking-only response — nudging model to use tools (nudge ${emptyNudgeCount}/3). iteration=${iteration + 1}`);
          messages.push({ role: "assistant", content: "(no action taken)" } as any);
          messages.push({ role: "user", content: "You must use your tools to make progress. Call write_file to write code, mark_step_complete when a step is done, or finish_build when all steps are complete. Do not respond without a tool call." } as any);
          continue; // retry this iteration
        }
      }

      finalText = assistantText;
      if (partCtx) {
        const stepFinish = createPart("step-finish", sessionId, messageId, {
          step: iteration + 1,
          reason: "stop",
        });
        emitPart(partCtx, emit, stepFinish);
      }
      break;
    }

    // Model produced tool calls — reset nudge counter
    emptyNudgeCount = 0;
    previousToolCallCount = toolCalls.length;

    // Push assistant message with tool calls to context.
    // IMPORTANT optimizations to prevent messages[] from exploding:
    // 1. reasoning_content is NOT kept — it's the model's per-turn scratchpad
    //    (GLM-5 can produce 100K+ chars of reasoning). Re-sending it every
    //    iteration is the #1 context bloat source. The model doesn't need its
    //    own prior thinking; the resulting tool_calls capture the decisions.
    // 2. tool_call arguments truncated (write_file content can be 50KB) — the
    //    LLM can read_file again if it needs the content.
    const MAX_ARGS_IN_CONTEXT = 500; // chars — enough for function name + path
    const assistantMsg = {
      role: "assistant" as const,
      content: assistantText || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: tc.argsRaw.length > MAX_ARGS_IN_CONTEXT
            ? tc.argsRaw.slice(0, MAX_ARGS_IN_CONTEXT) + '..."}'
            : tc.argsRaw,
        },
      })),
    };
    messages.push(assistantMsg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam);

    let shouldExit = false;
    let toolErrorCountThisIteration = 0;

    // ── Execute tool calls with state machine ──────────────────────
    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.argsRaw || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      // Create ToolPart in pending state
      let toolPart: ToolPart | undefined;
      if (partCtx) {
        toolPart = createPart("tool", sessionId, messageId, {
          tool: tc.name,
          callId: tc.id,
          state: { status: "pending", input: args },
        });
        emitPart(partCtx, emit, toolPart);
      } else {
        // Legacy: emit action_log directly for tools that don't have their own logs
        const toolsWithOwnLogs = new Set([
          "write_file",
          "read_file",
          "list_files",
          "grep",
          "edit_file",
          "patch_file",
          "hash_patch_file",
          "delete_file",
          "ast_search",
          "ast_replace",
          "lsp_diagnostics",
          "lsp_find_references",
          "lsp_goto_definition",
          "shell_run",
          "run_tests",
          "mcp_search",
          "fetch_url",
          "research",
          "mark_step_complete",
          "finish_build",
          "report_issue",
          "submit_verdict",
        ]);
        if (!toolsWithOwnLogs.has(tc.name) && !tc.name.startsWith("mcp_")) {
          const argsPreview = JSON.stringify(args).slice(0, 120);
          emit({ type: "action_log", actionType: "tool_call", label: tc.name, detail: argsPreview });
        }
      }

      // Transition to running
      if (toolPart && partCtx) {
        updateToolState(partCtx, emit, toolPart, {
          status: "running",
          input: args,
          startedAt: Date.now(),
        });
      }

      let result = "";
      const handler = handlers[tc.name];

      let handlerSucceeded = false;
      if (!handler) {
        result = `Error: unknown tool "${tc.name}"`;
        toolErrorCountThisIteration++;
        if (toolPart && partCtx) {
          updateToolState(partCtx, emit, toolPart, {
            status: "error",
            input: args,
            error: result,
            startedAt: (toolPart.state as any).startedAt ?? Date.now(),
            completedAt: Date.now(),
          });
        }
      } else {
        try {
          result = await handler(args, emit);
          handlerSucceeded = true;
          if (toolPart && partCtx) {
            updateToolState(partCtx, emit, toolPart, {
              status: "completed",
              input: args,
              output: result,
              startedAt: (toolPart.state as any).startedAt ?? Date.now(),
              completedAt: Date.now(),
            });
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          result = `Error executing tool "${tc.name}": ${message}`;
          toolErrorCountThisIteration++;
          if (toolPart && partCtx) {
            updateToolState(partCtx, emit, toolPart, {
              status: "error",
              input: args,
              error: result,
              startedAt: (toolPart.state as any).startedAt ?? Date.now(),
              completedAt: Date.now(),
            });
          }
        }
      }

      // Hard cap on tool result size to prevent unbounded context growth.
      // 48000 chars ≈ 12K tokens — large enough for any reasonable file/output,
      // small enough to prevent a single tool call from exhausting the window.
      const MAX_TOOL_RESULT_CHARS = 48000;
      if (result.length > MAX_TOOL_RESULT_CHARS) {
        result = result.slice(0, MAX_TOOL_RESULT_CHARS) + "\n\n...(truncated — output exceeded 48000 chars)";
      }

      const toolResultMsg: OpenAI.Chat.Completions.ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      };
      messages.push(toolResultMsg);

      // Only treat this as an exit if the handler actually succeeded.
      // A throwing handler signals "rejected, retry" — keep looping so the
      // LLM sees the error message and can re-invoke the tool with fixed args.
      // maxIterations bounds the retry budget.
      if (handlerSucceeded && exitTools.has(tc.name)) {
        shouldExit = true;
        exitTool = tc.name;
        exitArgs = args;
      }
    }
    previousToolErrorCount = toolErrorCountThisIteration;

    // A tool handler may trip the shared exit signal (e.g. the builder marking
    // the final plan step complete) to end the loop without a dedicated exit
    // tool call. Treat it as a clean exit.
    if (opts.exitSignal?.exit) {
      shouldExit = true;
      if (!exitTool) exitTool = opts.exitSignal.reason ?? "exit_signal";
    }

    // ── Step Finish (tool calls processed) ──────────────────────────
    if (partCtx) {
      const stepFinish = createPart("step-finish", sessionId, messageId, {
        step: iteration + 1,
        reason: shouldExit ? "exit_tool" : "tool_calls",
      });
      emitPart(partCtx, emit, stepFinish);
    }

    if (shouldExit) break;
  }

  // 迭代耗尽但没有正常退出 — 只对 builder 主循环 emit 错误，子 agent 静默退出
  if (!exitTool && !opts.exitSignal?.exit) {
    console.warn(`[agent-loop] maxIterations (${maxIterations}) reached without exit signal. sessionId=${sessionId}`);
    if (opts.emitOnIterationExhausted) {
      emit({ type: "build_error", message: `Agent reached iteration limit (${maxIterations}) without completing all steps. Try breaking the task into smaller steps.` });
    }
  }

  return {
    finalText,
    exitTool,
    exitArgs,
    tokenUsage: totalInputTokens + totalOutputTokens > 0
      ? { input: totalInputTokens, output: totalOutputTokens, total: totalInputTokens + totalOutputTokens }
      : undefined,
  };
}
