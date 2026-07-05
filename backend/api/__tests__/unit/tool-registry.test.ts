import { describe, it, expect, vi } from "vitest";
import { ToolRegistry, type ModalityPlugin } from "../../src/agent/tools/tool-registry";
import type { ToolSchema, ToolHandlers } from "../../src/agent/loop/agent-loop";

function makeSchema(name: string): ToolSchema {
  return { type: "function", function: { name, description: `Tool ${name}`, parameters: { type: "object", properties: {} } } };
}

describe("ToolRegistry", () => {
  it("merges schemas and handlers from multiple sources", () => {
    const reg = new ToolRegistry();
    reg.register("builder", [makeSchema("write_file")], { write_file: async () => "ok" });
    reg.register("mcp", [makeSchema("mcp_custom_lookup")], { mcp_custom_lookup: async () => "found" });
    const { schemas, handlers, policies } = reg.build();
    expect(schemas).toHaveLength(2);
    expect(handlers["write_file"]).toBeDefined();
    expect(handlers["mcp_custom_lookup"]).toBeDefined();
    expect(policies["write_file"]).toMatchObject({ category: "edit", mutatesFiles: true, safeToParallelize: false });
    expect(policies["mcp_custom_lookup"]).toMatchObject({ category: "network", mutatesFiles: false, safeToParallelize: true });
  });

  it("skips duplicate tool names (first registration wins)", async () => {
    const reg = new ToolRegistry();
    reg.register("a", [makeSchema("dup")], { dup: async () => "first" });
    reg.register("b", [makeSchema("dup")], { dup: async () => "second" });
    const { schemas, handlers } = reg.build();
    expect(schemas).toHaveLength(1);
    // First source wins
    expect(await handlers["dup"]({}, (() => {}) as any)).toBe("first");
  });

  it("protects built-in tool names from external sources", () => {
    const reg = new ToolRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reg.register("mcp", [makeSchema("write_file")], { write_file: async () => "hijacked" });
    const { schemas, handlers } = reg.build();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("protected"));
    expect(schemas).toHaveLength(0);
    expect(handlers["write_file"]).toBeUndefined();
    warn.mockRestore();
  });

  it("allows builder source to register protected names", () => {
    const reg = new ToolRegistry();
    reg.register("builder", [makeSchema("write_file")], { write_file: async () => "ok" });
    const { schemas } = reg.build();
    expect(schemas.some(s => s.function.name === "write_file")).toBe(true);
  });

  it("allows other built-in agent sources to register protected names", () => {
    const reg = new ToolRegistry();
    reg.register("verifier", [makeSchema("report_issue")], { report_issue: async () => "ok" });
    reg.register("manager", [makeSchema("submit_plan")], { submit_plan: async () => "ok" });
    const { schemas, handlers } = reg.build();
    expect(schemas.map((s) => s.function.name)).toEqual(["report_issue", "submit_plan"]);
    expect(handlers["report_issue"]).toBeDefined();
    expect(handlers["submit_plan"]).toBeDefined();
  });

  it("allows MCP alias and research sources to register protected convenience names", () => {
    const reg = new ToolRegistry();
    reg.register("mcp-aliases", [makeSchema("mcp_search"), makeSchema("fetch_url")], {
      mcp_search: async () => "search",
      fetch_url: async () => "fetch",
    });
    reg.register("research", [makeSchema("research")], { research: async () => "research" });
    const { schemas, handlers } = reg.build();
    expect(schemas.map((s) => s.function.name)).toEqual(["mcp_search", "fetch_url", "research"]);
    expect(handlers["mcp_search"]).toBeDefined();
    expect(handlers["fetch_url"]).toBeDefined();
    expect(handlers["research"]).toBeDefined();
  });

  it("skips schemas without matching handlers", () => {
    const reg = new ToolRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reg.register("mcp", [makeSchema("mcp_custom_lookup")], {});
    const { schemas, handlers } = reg.build();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("without a handler"));
    expect(schemas).toHaveLength(0);
    expect(handlers["mcp_custom_lookup"]).toBeUndefined();
    warn.mockRestore();
  });

  it("skips handlers without matching schemas", () => {
    const reg = new ToolRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reg.register("mcp", [], { mcp_custom_lookup: async () => "found" });
    const { schemas, handlers } = reg.build();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("without a schema"));
    expect(schemas).toHaveLength(0);
    expect(handlers["mcp_custom_lookup"]).toBeUndefined();
    warn.mockRestore();
  });

  it("registerModality adds plugin tools via register()", () => {
    const reg = new ToolRegistry();
    const plugin: ModalityPlugin = {
      name: "image",
      getToolSchemas: () => [makeSchema("generate_image")],
      getToolHandlers: () => ({ generate_image: async () => "img_url" }),
      dispose: async () => {},
    };
    reg.registerModality(plugin);
    const { schemas, handlers } = reg.build();
    expect(schemas.some(s => s.function.name === "generate_image")).toBe(true);
    expect(handlers["generate_image"]).toBeDefined();
    expect(reg.getModalities()).toHaveLength(1);
  });

  it("disposeModalities calls dispose on all plugins", async () => {
    const reg = new ToolRegistry();
    const dispose = vi.fn(async () => {});
    reg.registerModality({ name: "a", getToolSchemas: () => [], getToolHandlers: () => ({}), dispose });
    reg.registerModality({ name: "b", getToolSchemas: () => [], getToolHandlers: () => ({}), dispose });
    await reg.disposeModalities();
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("size counts total tools across all sources", () => {
    const reg = new ToolRegistry();
    reg.register("a", [makeSchema("t1"), makeSchema("t2")], { t1: async () => "1", t2: async () => "2" });
    reg.register("b", [makeSchema("t3")], { t3: async () => "3" });
    expect(reg.size).toBe(3);
  });

  it("listSources returns registered source names", () => {
    const reg = new ToolRegistry();
    reg.register("builder", [], {});
    reg.register("mcp", [], {});
    expect(reg.listSources()).toEqual(["builder", "mcp"]);
  });
});
