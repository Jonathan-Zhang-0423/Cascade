import { describe, expect, it } from "vitest";
import {
  describeActionForTimeline,
  getActionDisplayLabel,
  getActionToolMeta,
  getActionVerbLabel,
  isControlOnlyToolLabel,
  isProjectFileAction,
} from "./tool-display";
import type { ActionLogEntry } from "./chat-types";

const entry = (partial: Partial<ActionLogEntry>): ActionLogEntry => ({
  type: "tool_call",
  label: "",
  detail: "",
  timestamp: 1,
  ...partial,
});

describe("tool display metadata", () => {
  it("covers new toolkit tools with user-facing labels", () => {
    expect(getActionToolMeta(entry({ type: "tool_call", label: "read_many_files" })).label).toBe("批量读取文件");
    expect(getActionToolMeta(entry({ type: "tool_call", label: "read_file_range" })).label).toBe("读取文件行范围");
    expect(getActionToolMeta(entry({ type: "tool_call", label: "file_info" })).label).toBe("查看文件信息");
    expect(getActionToolMeta(entry({ type: "tool_call", label: "move_file" })).label).toBe("移动文件");
    expect(getActionToolMeta(entry({ type: "tool_call", label: "update_project_memory" })).label).toBe("更新项目记忆");
  });

  it("recognizes backend action_log labels emitted by concrete tool handlers", () => {
    expect(getActionToolMeta(entry({ type: "file_read", label: "Info: App.tsx", filePath: "/project/App.tsx" })).name).toBe("file_info");
    expect(getActionToolMeta(entry({ type: "file_read", label: "App.tsx lines", filePath: "/project/App.tsx" })).name).toBe("read_file_range");
    expect(getActionToolMeta(entry({ type: "file_read", label: "AST Search" })).name).toBe("ast_search");
    expect(getActionToolMeta(entry({ type: "file_read", label: "LSP: Find References" })).name).toBe("lsp_find_references");
    expect(getActionToolMeta(entry({ type: "research", label: "Fetch URL" })).name).toBe("fetch_url");
    expect(getActionToolMeta(entry({ type: "tool_call", label: "MCP: docs/search" })).name).toBe("mcp");
  });

  it("does not treat shell and tests entries as project file writes", () => {
    const shell = entry({ type: "file_write", label: "Shell", detail: "npm test" });
    const tests = entry({ type: "file_write", label: "Tests", detail: "npm test" });

    expect(isProjectFileAction(shell)).toBe(false);
    expect(isProjectFileAction(tests)).toBe(false);
    expect(getActionVerbLabel(shell)).toBe("命令");
    expect(getActionVerbLabel(tests)).toBe("测试");
  });

  it("keeps control-flow tools identifiable but hideable", () => {
    expect(isControlOnlyToolLabel("mark_step_complete")).toBe(true);
    expect(isControlOnlyToolLabel("finish_build")).toBe(true);
    expect(isControlOnlyToolLabel("read_file")).toBe(false);
  });

  it("formats timeline labels for range reads and memory updates", () => {
    expect(getActionDisplayLabel(entry({
      type: "file_read",
      label: "App.tsx lines",
      detail: "10-20",
      filePath: "/project/App.tsx",
    }))).toBe("App.tsx 行范围");

    expect(describeActionForTimeline(entry({
      type: "tool_call",
      label: "update_project_memory",
      detail: "120 chars via tool",
    }))).toBe("更新项目记忆");
  });
});
