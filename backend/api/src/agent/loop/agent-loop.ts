import { doubaoClient, DOUBAO_MODEL } from "../providers/doubao-client";
import { withRetry } from "../providers/retry";
import { aiSemaphore, CONCURRENCY_QUEUE_TIMEOUT } from "../../infra/concurrency";
import type { SseEmit } from "../orchestrator/build-orchestrator";
import type OpenAI from "openai";
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
  /** When true, set tool_choice="required" so the model must call a tool
   *  every iteration (used by the AIGC agent, which tends to narrate
   *  instead of calling capture_screenshot / generate_poster). */
  forceToolChoice?: boolean;
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
   * instead of waiting on the model to emit a separate request_review tool call
   * (which it sometimes only narrates, leaving the loop spinning to maxIterations).
   */
  exitSignal?: { exit: boolean; reason?: string };
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
  const toolChoice = opts.forceToolChoice ? "required" : "auto";

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

  const isDoubaoModel = activeModel.toLowerCase().includes("doubao");
  const isKimiModel = activeModel.toLowerCase().includes("kimi");
  const isMinimaxModel = activeModel.toLowerCase().includes("minimax");
  const isGLMModel = activeModel.toLowerCase().startsWith("glm");
  const isGLM52 = activeModel.toLowerCase().includes("glm-5.2");
  const isDeepseekModel = activeModel.toLowerCase().includes("deepseek");
  const thinkingParam = opts.disableThinking
    ? isKimiModel
      // kimi-k2.5 enables thinking by default; must explicitly disable it,
      // or tool_choice:"required" returns 400 ("incompatible with thinking").
      ? { thinking: { type: "disabled" } }
      : isDoubaoModel
        ? { thinking: { type: "disabled" } }
        : {}
    : isDoubaoModel
      ? { thinking: { type: "enabled", budget_tokens: 8192 } }
      : isKimiModel
        ? { thinking: { type: "enabled" } }
        : isDeepseekModel
          ? { reasoning_effort: "high" }
          : {};

  // GLM-5.2 dynamic thinking budget: starts generous and shrinks as context
  // grows, ensuring there's always room for narration + tool calls. The problem:
  // GLM-5.2's deep thinking can consume the entire output budget, leaving zero
  // tokens for narration/tool_calls, which triggers an early loop exit.
  //
  // Strategy: reserve at least 4096 tokens for non-thinking output. As
  // totalOutputTokens accumulates, reduce the thinking budget proportionally.
  const GLM52_MAX_THINKING = 4096;
  const GLM52_MIN_THINKING = 1024;
  const GLM52_OUTPUT_CAP = 16384; // max_tokens per request
  const GLM52_NARRATION_RESERVE = 4096; // always keep this much for narration+tools

  function getGlm52ThinkingBudget(): number {
    // As output tokens accumulate across iterations, the context grows and
    // available output budget effectively shrinks. Scale thinking budget down.
    const pressure = Math.min(totalOutputTokens / (GLM52_OUTPUT_CAP * 3), 1);
    const budget = Math.round(GLM52_MAX_THINKING - pressure * (GLM52_MAX_THINKING - GLM52_MIN_THINKING));
    return Math.max(GLM52_MIN_THINKING, Math.min(GLM52_MAX_THINKING, budget));
  }

  function getGlmExtraBody() {
    if (opts.disableThinking) return undefined;
    if (isGLM52) {
      return { thinking: { type: "enabled", budget_tokens: getGlm52ThinkingBudget() } };
    }
    if (isGLMModel) {
      return { thinking: { type: "enabled", budget_tokens: 2048 } };
    }
    if (isMinimaxModel) return { reasoning_split: true };
    if (isDeepseekModel) return { thinking: { type: "enabled" } };
    return undefined;
  }

  const timeoutMs = (isDoubaoModel || isKimiModel || isMinimaxModel || isGLMModel || isDeepseekModel) ? 90_000 : 30_000;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Each iteration is a "message" from the AI perspective
    const messageId = generatePartId();

    // ── Step Start ──────────────────────────────────────────────────
    if (partCtx) {
      const stepStart = createPart("step-start", sessionId, messageId, { step: iteration + 1 });
      emitPart(partCtx, emit, stepStart);
    }

    const response = await aiSemaphore.run(
      () => withRetry(
        `runAgentLoop iteration ${iteration + 1}`,
        () => {
          const extraBody = getGlmExtraBody();
          return activeClient.chat.completions.create(
            {
              model: activeModel,
              messages,
              ...thinkingParam,
              ...(extraBody ? { extra_body: extraBody } : {}),
              tools: tools.length > 0 ? (tools as OpenAI.Chat.Completions.ChatCompletionTool[]) : undefined,
              tool_choice: tools.length > 0 ? (toolChoice as "auto" | "required") : undefined,
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

    let assistantText = "";
    let reasoningContent = "";
    const toolCallsMap: Record<string, PendingToolCall> = {};

    // Track Parts for this iteration (for in-place updates)
    let textPart: Part | undefined;
    let reasoningPart: Part | undefined;
    let inThinkTag = false; // Filter <think> blocks from narration stream

    for await (const chunk of response as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta as typeof choice.delta & {
        reasoning_content?: string;
        reasoning_details?: Array<{ type?: string; text?: string }>;
      };

      // ── Reasoning tokens ────────────────────────────────────────
      if (delta.reasoning_content) {
        if (!reasoningContent) {
          console.log(`[agent-loop] first thinking_token from ${activeModel}, iteration=${iteration + 1}`);
        }
        reasoningContent += delta.reasoning_content;

        if (partCtx) {
          if (!reasoningPart) {
            reasoningPart = createPart("reasoning", sessionId, messageId, { text: reasoningContent });
            emitPart(partCtx, emit, reasoningPart, delta.reasoning_content);
          } else {
            (reasoningPart as any).text = reasoningContent;
            // Delta-only emit (part already in array)
            emit({ type: "thinking_token", token: delta.reasoning_content });
          }
        } else {
          emit({ type: "thinking_token", token: delta.reasoning_content });
        }
      }

      // MiniMax reasoning_details
      if (delta.reasoning_details && delta.reasoning_details.length > 0) {
        for (const rd of delta.reasoning_details) {
          if (rd.text) {
            if (!reasoningContent) {
              console.log(`[agent-loop] first thinking_token (minimax) from ${activeModel}, iteration=${iteration + 1}`);
            }
            reasoningContent += rd.text;

            if (partCtx) {
              if (!reasoningPart) {
                reasoningPart = createPart("reasoning", sessionId, messageId, { text: reasoningContent });
                emitPart(partCtx, emit, reasoningPart, rd.text);
              } else {
                (reasoningPart as any).text = reasoningContent;
                emit({ type: "thinking_token", token: rd.text });
              }
            } else {
              emit({ type: "thinking_token", token: rd.text });
            }
          }
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

    const toolCalls = Object.values(toolCallsMap);

    if (toolCalls.length === 0) {
      // ── Step Finish (no tool calls → stop) ──────────────────────
      console.warn(`[agent-loop] iteration ${iteration + 1} ended with NO tool_calls. assistantText.length=${assistantText.length} reasoningContent.length=${reasoningContent.length} model=${activeModel} sessionId=${sessionId} inputTokens=${totalInputTokens} outputTokens=${totalOutputTokens}`);

      // GLM and some models sometimes fail to emit tool_calls on large contexts.
      // If we got thinking but no text and no tools, and we haven't exhausted
      // retries, nudge the model to continue by injecting a reminder.
      if (assistantText.length === 0 && reasoningContent.length > 0 && iteration < maxIterations - 1 && tools.length > 0) {
        console.log(`[agent-loop] Empty response with reasoning — nudging model to use tools. iteration=${iteration + 1}`);
        // Push the empty assistant message and a nudge
        messages.push({ role: "assistant", content: reasoningContent } as any);
        messages.push({ role: "user", content: "Please continue with the implementation. Use your tools (write_file, mark_step_complete) to make progress on the plan. Do not just describe what you would do — actually do it by calling the appropriate tool." } as any);
        continue; // retry this iteration
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

    // Push assistant message with tool calls to context
    const assistantMsg = {
      role: "assistant" as const,
      content: assistantText || null,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.argsRaw },
      })),
    };
    messages.push(assistantMsg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam);

    let shouldExit = false;

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
        const toolsWithOwnLogs = new Set(["write_file", "read_file", "mark_step_complete", "finish_build", "report_issue", "submit_verdict"]);
        if (!toolsWithOwnLogs.has(tc.name)) {
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
          console.error(`[agent-loop] tool "${tc.name}" threw:`, message);
          result = `Error executing tool "${tc.name}": ${message}`;
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
