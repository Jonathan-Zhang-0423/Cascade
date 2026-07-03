import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/providers/doubao-client", () => ({
  doubaoClient: {},
  DOUBAO_MODEL: "doubao-test",
}));

import { runAgentLoop, type ToolSchema } from "../src/agent/loop/agent-loop";
import type { ModelAdapter } from "../src/agent/providers/model-adapter";

function toolSchema(name: string): ToolSchema {
  return {
    type: "function",
    function: {
      name,
      description: `${name} test tool`,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          pattern: { type: "string" },
          content: { type: "string" },
        },
      },
    },
  };
}

function makeToolCallStream(name: string, args: Record<string, unknown>, iteration: number) {
  async function* stream() {
    yield {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: `call_${iteration}`,
            function: {
              name,
              arguments: JSON.stringify(args),
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

function makeAdapter(client: any): ModelAdapter {
  return {
    name: "test",
    client,
    model: "test-model",
    timeoutMs: 1_000,
    supportsThinking: false,
    getThinkingConfig: () => ({ thinkingParam: {}, extraBody: undefined }),
    extractReasoning: () => null,
  };
}

describe("runAgentLoop discovery stall nudges", () => {
  it("waits until iteration 20 before nudging the editor to act after read/search-only rounds", async () => {
    const sentMessages: any[][] = [];
    let createCount = 0;
    const script = Array.from({ length: 21 }, (_, index) => (
      index % 2 === 0
        ? { name: "read_file", args: { path: "/project/src/App.tsx" } }
        : { name: "grep", args: { pattern: "App", path: "/project" } }
    ));
    const client = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            sentMessages.push(params.messages.map((m: any) => ({ ...m })));
            const next = script[createCount] ?? script[script.length - 1];
            createCount++;
            return makeToolCallStream(next.name, next.args, createCount);
          }),
        },
      },
    } as any;
    const emit = vi.fn();

    await runAgentLoop(
      "system",
      [{ role: "user", content: "edit the app" }],
      [toolSchema("read_file"), toolSchema("grep")],
      {
        read_file: vi.fn(async () => "file contents"),
        grep: vi.fn(async () => "/project/src/App.tsx:1:App"),
      },
      emit,
      {
        maxIterations: 21,
        client,
        model: "test-model",
        adapter: makeAdapter(client),
        phase: "editor",
        sessionId: "sess-discovery-stall",
      },
    );

    const hasDiscoveryNudge = (messages: any[]) => messages.some((m) =>
      m.role === "user" &&
      typeof m.content === "string" &&
      m.content.includes("several consecutive rounds only reading/searching")
    );

    expect(sentMessages.slice(0, 20).some(hasDiscoveryNudge)).toBe(false);
    expect(hasDiscoveryNudge(sentMessages[20])).toBe(true);
  });
});
