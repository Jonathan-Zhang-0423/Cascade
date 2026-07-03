import { describe, expect, it, vi } from "vitest";
import { buildMcpAliasTools } from "../src/agent/mcp/mcp-tools";
import type { McpManager, McpToolInfo } from "../src/agent/mcp/mcp-client";

function makeMockManager(tools: McpToolInfo[]): McpManager {
  return {
    getAvailableTools: () => tools,
    callTool: vi.fn(async (_server: string, tool: string, args: object) => `${tool}:${JSON.stringify(args)}`),
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as McpManager;
}

const noopEmit = vi.fn();

describe("external MCP tool aliases", () => {
  it("mcp_search calls the connected MCP search tool", async () => {
    const manager = makeMockManager([
      { serverName: "builtin-web-search", originalName: "search_web", description: "Search", inputSchema: {} },
    ]);
    const { handlers } = buildMcpAliasTools(manager);

    const result = await handlers.mcp_search({ query: "Tailwind v4 config", max_results: 3 }, noopEmit);

    expect(manager.callTool).toHaveBeenCalledWith("builtin-web-search", "search_web", {
      query: "Tailwind v4 config",
      maxResults: 3,
      max_results: 3,
    });
    expect(result).toContain("search_web");
  });

  it("fetch_url calls the connected MCP fetch_url tool", async () => {
    const manager = makeMockManager([
      { serverName: "builtin-web-search", originalName: "fetch_url", description: "Fetch", inputSchema: {} },
    ]);
    const { handlers } = buildMcpAliasTools(manager);

    const result = await handlers.fetch_url({ url: "https://example.com/docs", max_length: 1200 }, noopEmit);

    expect(manager.callTool).toHaveBeenCalledWith("builtin-web-search", "fetch_url", {
      url: "https://example.com/docs",
      maxLength: 1200,
      max_length: 1200,
    });
    expect(result).toContain("fetch_url");
  });

  it("returns a clear unavailable message when no search tool is connected", async () => {
    const manager = makeMockManager([]);
    const { handlers } = buildMcpAliasTools(manager);

    const result = await handlers.mcp_search({ query: "anything" }, noopEmit);

    expect(result).toContain("Search unavailable");
    expect(manager.callTool).not.toHaveBeenCalled();
  });
});
