import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/providers/doubao-client", () => ({
  doubaoClient: {},
  DOUBAO_MODEL: "doubao-test",
}));

import { runAgentLoop, type ToolSchema } from "../src/agent/loop/agent-loop";
import type { ModelAdapter } from "../src/agent/providers/model-adapter";

function makeToolCallStream(iteration: number) {
  const callId = `call_${iteration}`;
  async function* stream() {
    yield {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: callId,
            function: {
              name: "keep_working",
              arguments: JSON.stringify({ iteration }),
            },
          }],
        },
      }],
    };
    yield {
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
  }
  return stream();
}

const keepWorkingTool: ToolSchema = {
  type: "function",
  function: {
    name: "keep_working",
    description: "A non-exit tool used to keep the loop running.",
    parameters: {
      type: "object",
      properties: {
        iteration: { type: "number" },
      },
    },
  },
};

describe("runAgentLoop iteration exhaustion", () => {
  it("returns a structured exhausted result instead of pretending the loop completed", async () => {
    let createCount = 0;
    const client = {
      chat: {
        completions: {
          create: vi.fn(() => makeToolCallStream(++createCount)),
        },
      },
    } as any;
    const adapter: ModelAdapter = {
      name: "test",
      client,
      model: "test-model",
      timeoutMs: 1_000,
      supportsThinking: false,
      getThinkingConfig: () => ({ thinkingParam: {}, extraBody: undefined }),
      extractReasoning: () => null,
    };
    const emit = vi.fn();

    const result = await runAgentLoop(
      "system",
      [{ role: "user", content: "work until the budget is exhausted" }],
      [keepWorkingTool],
      { keep_working: vi.fn(async () => "ok") },
      emit,
      {
        maxIterations: 2,
        client,
        model: "test-model",
        adapter,
        exitTools: ["finish_build"],
        sessionId: "sess-exhaust",
      },
    );

    expect(result.exhausted).toBe(true);
    expect(result.exitTool).toBeUndefined();
    expect(createCount).toBe(2);
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: "build_error" }));
  });
});
