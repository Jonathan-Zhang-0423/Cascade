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
    reg.register("mcp", [makeSchema("mcp_search")], { mcp_search: async () => "found" });
    const { schemas, handlers } = reg.build();
    expect(schemas).toHaveLength(2);
    expect(handlers["write_file"]).toBeDefined();
    expect(handlers["mcp_search"]).toBeDefined();
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
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("protected"));
    warn.mockRestore();
  });

  it("allows builder source to register protected names", () => {
    const reg = new ToolRegistry();
    reg.register("builder", [makeSchema("write_file")], { write_file: async () => "ok" });
    const { schemas } = reg.build();
    expect(schemas.some(s => s.function.name === "write_file")).toBe(true);
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
    reg.register("a", [makeSchema("t1"), makeSchema("t2")], {});
    reg.register("b", [makeSchema("t3")], {});
    expect(reg.size).toBe(3);
  });

  it("listSources returns registered source names", () => {
    const reg = new ToolRegistry();
    reg.register("builder", [], {});
    reg.register("mcp", [], {});
    expect(reg.listSources()).toEqual(["builder", "mcp"]);
  });
});
