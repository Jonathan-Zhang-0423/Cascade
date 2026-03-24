import { doubaoClient, DOUBAO_MODEL } from "./doubao-client";
import { withRetry } from "./retry";
import type { SseEmit } from "./build-orchestrator";
import type OpenAI from "openai";

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

export async function runAgentLoop(
  systemPrompt: string,
  initialMessages: Array<{ role: "user" | "assistant"; content: string }>,
  tools: ToolSchema[],
  handlers: ToolHandlers,
  emit: SseEmit,
  opts: { maxIterations?: number; exitTools?: string[]; client?: OpenAI; model?: string } = {},
): Promise<AgentLoopResult> {
  const maxIterations = opts.maxIterations ?? 30;
  const exitTools = new Set(opts.exitTools ?? []);

  const activeClient = opts.client ?? doubaoClient;
  const activeModel = opts.model ?? DOUBAO_MODEL;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...initialMessages,
  ];

  let finalText = "";
  let exitTool: string | undefined;
  let exitArgs: Record<string, unknown> | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await withRetry(
      `runAgentLoop iteration ${iteration + 1}`,
      () =>
        activeClient.chat.completions.create(
          {
            model: activeModel,
            messages,
            tools: tools.length > 0 ? (tools as OpenAI.Chat.Completions.ChatCompletionTool[]) : undefined,
            tool_choice: tools.length > 0 ? "auto" : undefined,
            stream: true,
            max_tokens: 16384,
          },
          { timeout: 30_000 },
        ),
    );

    let assistantText = "";
    let reasoningContent = "";
    const toolCallsMap: Record<string, PendingToolCall> = {};

    for await (const chunk of response) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta as typeof choice.delta & { reasoning_content?: string };

      if (delta.reasoning_content) {
        reasoningContent += delta.reasoning_content;
        emit({ type: "thinking_token", token: delta.reasoning_content });
      }

      if (delta.content) {
        assistantText += delta.content;
        emit({ type: "narration_token", token: delta.content });
      }

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
      finalText = assistantText;
      break;
    }

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

    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.argsRaw || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      let result = "";
      const handler = handlers[tc.name];

      if (!handler) {
        result = `Error: unknown tool "${tc.name}"`;
      } else {
        try {
          result = await handler(args, emit);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          result = `Error executing tool "${tc.name}": ${message}`;
        }
      }

      const toolResultMsg: OpenAI.Chat.Completions.ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      };
      messages.push(toolResultMsg);

      if (exitTools.has(tc.name)) {
        shouldExit = true;
        exitTool = tc.name;
        exitArgs = args;
      }
    }

    if (shouldExit) break;
  }

  return { finalText, exitTool, exitArgs };
}
