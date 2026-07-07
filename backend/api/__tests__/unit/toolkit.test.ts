import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/agent/providers/doubao-client", () => ({
  doubaoClient: {},
  DOUBAO_MODEL: "doubao-test",
}));

import { buildAgentToolkit } from "../../src/agent/tools/toolkit";
import { runAgentLoop, type ToolSchema } from "../../src/agent/loop/agent-loop";
import type { BuildSessionState } from "../../src/agent/orchestrator/build-orchestrator";
import type { ModelAdapter } from "../../src/agent/providers/model-adapter";

function makeSession(files: Record<string, string>): BuildSessionState {
  return {
    id: "toolkit-test",
    aborted: false,
    files: new Map(Object.entries(files)),
    plan: { steps: [{ step: 1, title: "Test", description: "Test step" }] },
    userRequest: "test request",
    userLang: "English",
    events: [],
    nextEventId: 1,
    done: false,
    sseWriters: new Set(),
    parts: [],
    status: { type: "busy", agent: "test" },
  };
}

function toolNames(toolkit: ReturnType<typeof buildAgentToolkit>): string[] {
  return toolkit.schemas.map((schema) => schema.function.name).sort();
}

function makeToolCallStream(name: string, args: Record<string, unknown>) {
  async function* stream() {
    yield {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
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

describe("AgentToolkit", () => {
  it("scopes tools by role", () => {
    const session = makeSession({ "/project/src/App.tsx": "export function App() { return null; }" });
    const explorer = buildAgentToolkit("explorer", { session });
    const verifier = buildAgentToolkit("verifier", { session, reviewState: { issues: [] } });
    const editor = buildAgentToolkit("editor", { session, planSteps: [] });

    expect(toolNames(explorer)).toContain("read_many_files");
    expect(toolNames(explorer)).toContain("read_file_range");
    expect(toolNames(explorer)).not.toContain("write_file");
    expect(toolNames(explorer)).not.toContain("delete_file");

    expect(toolNames(verifier)).toContain("grep");
    expect(toolNames(verifier)).toContain("run_tests");
    expect(toolNames(verifier)).toContain("submit_review");
    expect(toolNames(verifier)).not.toContain("write_file");

    expect(toolNames(editor)).toContain("write_file");
    expect(toolNames(editor)).toContain("move_file");
    expect(editor.policies.write_file.allowedRoles).toEqual(["editor", "fixer"]);
  });

  it("supports read_many_files, read_file_range, file_info, grep context, and move_file", async () => {
    const session = makeSession({
      "/project/src/App.tsx": ["line one", "const needle = true;", "line three", "line four"].join("\n"),
      "/project/src/util.ts": "export const value = 1;",
    });
    const toolkit = buildAgentToolkit("editor", { session, planSteps: [] });
    const emit = vi.fn();

    const many = await toolkit.handlers.read_many_files(
      { paths: ["src/App.tsx", "/project/src/util.ts"], max_chars_per_file: 1000 },
      emit,
    );
    expect(many).toContain("--- /project/src/App.tsx ---");
    expect(many).toContain("File version hash:");
    expect(many).toContain("export const value = 1");

    const range = await toolkit.handlers.read_file_range(
      { path: "/project/src/App.tsx", start_line: 2, end_line: 3 },
      emit,
    );
    expect(range).toContain("Lines: 2-3 of 4");
    expect(range).toContain("const needle = true;");

    const info = await toolkit.handlers.file_info({ path: "src/App.tsx" }, emit);
    expect(info).toContain("Exists: true");
    expect(info).toContain("Lines: 4");

    const grep = await toolkit.handlers.grep(
      { pattern: "needle", regex: false, context_before: 1, context_after: 1 },
      emit,
    );
    expect(grep).toContain("> 2: const needle = true;");
    expect(grep).toContain("  1: line one");

    const moved = await toolkit.handlers.move_file(
      { from_path: "/project/src/util.ts", to_path: "src/lib/util.ts" },
      emit,
    );
    expect(moved).toContain("File moved: /project/src/util.ts -> /project/src/lib/util.ts");
    expect(moved).toContain("File version hash:");
    expect(session.files.has("/project/src/util.ts")).toBe(false);
    expect(session.files.get("/project/src/lib/util.ts")).toBe("export const value = 1;");
  });

  it("rejects role-disallowed tools in runAgentLoop before calling handlers", async () => {
    const writeFileSchema: ToolSchema = {
      type: "function",
      function: {
        name: "write_file",
        description: "Write file",
        parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
      },
    };
    const client = {
      chat: {
        completions: {
          create: vi.fn(() => makeToolCallStream("write_file", { path: "/project/a.txt", content: "x" })),
        },
      },
    } as any;
    const handler = vi.fn(async () => "should not run");
    const emit = vi.fn();

    const result = await runAgentLoop(
      "system",
      [{ role: "user", content: "try write" }],
      [writeFileSchema],
      { write_file: handler },
      emit,
      {
        maxIterations: 1,
        client,
        model: "test-model",
        adapter: makeAdapter(client),
        runtimePolicy: {
          role: "explorer",
          maxIterations: 1,
          toolPolicies: {
            write_file: {
              name: "write_file",
              category: "edit",
              mutatesFiles: true,
              safeToParallelize: false,
              allowedRoles: ["editor", "fixer"],
            },
          },
        },
        toolPolicies: {
          write_file: {
            name: "write_file",
            category: "edit",
            mutatesFiles: true,
            safeToParallelize: false,
            allowedRoles: ["editor", "fixer"],
          },
        },
      },
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result.exhausted).toBe(true);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "action_log",
      actionType: "tool_error",
      label: "write_file",
    }));
  });
});
