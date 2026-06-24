import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildMcpTools, getMcpToolNames } from "../src/agent/mcp/mcp-tools";
import type { McpManager, McpToolInfo } from "../src/agent/mcp/mcp-client";
import type { SseEmit } from "../src/agent/orchestrator/build-orchestrator";

function makeMockManager(tools: McpToolInfo[]): McpManager {
  return {
    getAvailableTools: () => tools,
    callTool: vi.fn(async (_server: string, _tool: string, _args: object) => "mock result"),
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as McpManager;
}

const mockEmit: SseEmit = vi.fn();

describe("mcp-tools: buildMcpTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty schemas/handlers when no tools available", () => {
    const manager = makeMockManager([]);
    const { schemas, handlers } = buildMcpTools(manager, mockEmit);
    expect(schemas).toHaveLength(0);
    expect(Object.keys(handlers)).toHaveLength(0);
  });

  it("prefixes tool names with mcp_", () => {
    const tools: McpToolInfo[] = [
      { serverName: "search", originalName: "web_search", description: "Search the web", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    ];
    const manager = makeMockManager(tools);
    const { schemas, handlers } = buildMcpTools(manager, mockEmit);

    expect(schemas).toHaveLength(1);
    expect(schemas[0].function.name).toBe("mcp_web_search");
    expect(schemas[0].function.description).toContain("[MCP: search]");
    expect(schemas[0].function.description).toContain("Search the web");
    expect(schemas[0].function.parameters.properties).toHaveProperty("query");
    expect(schemas[0].function.parameters.required).toEqual(["query"]);
    expect(handlers["mcp_web_search"]).toBeDefined();
  });

  it("converts multiple tools from multiple servers", () => {
    const tools: McpToolInfo[] = [
      { serverName: "search", originalName: "web_search", description: "Search", inputSchema: { type: "object", properties: {} } },
      { serverName: "search", originalName: "fetch_url", description: "Fetch", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
      { serverName: "github", originalName: "list_repos", description: "List repos", inputSchema: { type: "object", properties: {} } },
    ];
    const manager = makeMockManager(tools);
    const { schemas, handlers } = buildMcpTools(manager, mockEmit);

    expect(schemas).toHaveLength(3);
    expect(Object.keys(handlers).sort()).toEqual(["mcp_fetch_url", "mcp_list_repos", "mcp_web_search"]);
  });

  it("handler calls manager.callTool and returns result", async () => {
    const tools: McpToolInfo[] = [
      { serverName: "search", originalName: "web_search", description: "Search", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
    ];
    const manager = makeMockManager(tools);
    (manager.callTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce("Result: found 3 items");

    const { handlers } = buildMcpTools(manager, mockEmit);
    const result = await handlers["mcp_web_search"]({ query: "test" }, mockEmit);

    expect(manager.callTool).toHaveBeenCalledWith("search", "web_search", { query: "test" });
    expect(result).toBe("Result: found 3 items");
  });

  it("handler emits action_log event", async () => {
    const tools: McpToolInfo[] = [
      { serverName: "gh", originalName: "list_prs", description: "List PRs", inputSchema: { type: "object", properties: {} } },
    ];
    const manager = makeMockManager(tools);
    const { handlers } = buildMcpTools(manager, mockEmit);

    await handlers["mcp_list_prs"]({}, mockEmit);

    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
      type: "action_log",
      actionType: "tool_call",
      label: "MCP: gh/list_prs",
    }));
  });

  it("normalizes empty inputSchema to object with no properties", () => {
    const tools: McpToolInfo[] = [
      { serverName: "s", originalName: "ping", description: "Ping", inputSchema: {} },
    ];
    const manager = makeMockManager(tools);
    const { schemas } = buildMcpTools(manager, mockEmit);

    expect(schemas[0].function.parameters).toEqual({ type: "object", properties: {} });
  });
});

describe("mcp-tools: getMcpToolNames", () => {
  it("returns prefixed names of all available tools", () => {
    const tools: McpToolInfo[] = [
      { serverName: "a", originalName: "tool1", description: "", inputSchema: {} },
      { serverName: "b", originalName: "tool2", description: "", inputSchema: {} },
    ];
    const manager = makeMockManager(tools);
    expect(getMcpToolNames(manager)).toEqual(["mcp_tool1", "mcp_tool2"]);
  });
});
