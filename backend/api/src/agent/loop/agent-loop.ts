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
  /** Part-based emission context. When provided, the loop emits structured
   *  Parts instead of raw SSE events directly. */
  partCtx?: PartEmitContext;
  /** Session ID for part creation. Required when partCtx is provided. */
  sessionId?: string;
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

  const isDoubaoModel = activeModel.toLowerCase().includes("doubao");
  const isKimiModel = activeModel.toLowerCase().includes("kimi");
  const isMinimaxModel = activeModel.toLowerCase().includes("minimax");
  const isGLMModel = activeModel.toLowerCase().startsWith("glm");
  const isDeepseekModel = activeModel.toLowerCase().includes("deepseek");
  const thinkingParam = opts.disableThinking
    ? {}
    : isDoubaoModel
      ? { thinking: { type: "enabled", budget_tokens: 8192 } }
      : isKimiModel
        ? { thinking: { type: "enabled" } }
        : isDeepseekModel
          ? { reasoning_effort: "high" }
          : {};
  const extraBody = opts.disableThinking
    ? undefined
    : isMinimaxModel
      ? { reasoning_split: true }
      : isGLMModel
        ? { thinking: { type: "enabled" } }
        : isDeepseekModel
          ? { thinking: { type: "enabled" } }
          : undefined;
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
        () =>
          activeClient.chat.completions.create(
            {
              model: activeModel,
              messages,
              ...thinkingParam,
              ...(extraBody ? { extra_body: extraBody } : {}),
              tools: tools.length > 0 ? (tools as OpenAI.Chat.Completions.ChatCompletionTool[]) : undefined,
              tool_choice: tools.length > 0 ? "auto" : undefined,
              stream: true,
              max_tokens: 16384,
            } as any,
            { timeout: timeoutMs },
          ),
      ),
      CONCURRENCY_QUEUE_TIMEOUT,
    );

    let assistantText = "";
    let reasoningContent = "";
    const toolCallsMap: Record<string, PendingToolCall> = {};

    // Track Parts for this iteration (for in-place updates)
    let textPart: Part | undefined;
    let reasoningPart: Part | undefined;

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
    }

    const toolCalls = Object.values(toolCallsMap);

    if (toolCalls.length === 0) {
      // ── Step Finish (no tool calls → stop) ──────────────────────
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
        const toolsWithOwnLogs = new Set(["write_file", "read_file", "mark_step_complete", "request_review", "report_issue", "submit_verdict"]);
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

  return { finalText, exitTool, exitArgs };
}
