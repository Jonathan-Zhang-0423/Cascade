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
  it("nudges the editor to act after consecutive read/search-only rounds and resets after a write", async () => {
    const sentMessages: any[][] = [];
    let createCount = 0;
    const script = [
      { name: "read_file", args: { path: "/project/src/App.tsx" } },
      { name: "grep", args: { pattern: "App", path: "/project" } },
      { name: "read_file", args: { path: "/project/src/App.tsx" } },
      { name: "grep", args: { pattern: "useState", path: "/project" } },
      { name: "write_file", args: { path: "/project/src/App.tsx", content: "export default function App() { return null; }\n" } },
      { name: "read_file", args: { path: "/project/src/App.tsx" } },
    ];
    const client = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            sentMessages.push(params.messages);
            const next = script[createCount] ?? script[script.length - 1];
            createCount++;
            return makeToolCallStream(next.name, next.args, createCount);
          }),
        },
      },
    } as any;
    const emit = vi.fn();
    const writeFile = vi.fn(async () => "File written successfully");

    await runAgentLoop(
      "system",
      [{ role: "user", content: "edit the app" }],
      [toolSchema("read_file"), toolSchema("grep"), toolSchema("write_file")],
      {
        read_file: vi.fn(async () => "file contents"),
        grep: vi.fn(async () => "/project/src/App.tsx:1:App"),
        write_file: writeFile,
      },
      emit,
      {
        maxIterations: 6,
        client,
        model: "test-model",
        adapter: makeAdapter(client),
        phase: "editor",
        sessionId: "sess-discovery-stall",
      },
    );

    const fifthRequest = sentMessages[4];
    expect(fifthRequest.some((m) =>
      m.role === "user" &&
      typeof m.content === "string" &&
      m.content.includes("several consecutive rounds only reading/searching"),
    )).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(1);

    const sixthRequest = sentMessages[5];
    const nudgeCount = sixthRequest.filter((m) =>
      m.role === "user" &&
      typeof m.content === "string" &&
      m.content.includes("several consecutive rounds only reading/searching"),
    ).length;
    expect(nudgeCount).toBe(1);
  });
});
