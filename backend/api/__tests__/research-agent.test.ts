import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the agent loop to avoid real LLM calls
vi.mock("../src/agent/loop/agent-loop", () => ({
  runAgentLoop: vi.fn(),
}));

// Mock the fast client provider
vi.mock("../src/agent/providers/kimi-client", () => ({
  getFastClient: vi.fn(() => ({ client: { __id: "fast" }, model: "fast-model" })),
  withFallback: vi.fn(),
  buildFallbackChain: vi.fn(() => ["doubao"]),
  getAIClient: vi.fn(() => ({ client: { __id: "test" }, model: "test-model" })),
}));

import { runResearchAgent } from "../src/agent/mcp/research-agent";
import { runAgentLoop } from "../src/agent/loop/agent-loop";
import type { McpManager } from "../src/agent/mcp/mcp-client";
import type { SseEmit } from "../src/agent/orchestrator/build-orchestrator";

function makeMockMcpManager(tools: Array<{ serverName: string; originalName: string; description: string; inputSchema: Record<string, unknown> }>): McpManager {
  return {
    getAvailableTools: () => tools,
    callTool: vi.fn(async () => "mock search result"),
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as McpManager;
}

const mockEmit: SseEmit = vi.fn();

describe("research-agent: runResearchAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no-tools message when MCP manager has no tools", async () => {
    const manager = makeMockMcpManager([]);
    const result = await runResearchAgent("What is React 19?", manager, mockEmit);
    expect(result).toContain("No research tools available");
    expect(runAgentLoop).not.toHaveBeenCalled();
  });

  it("calls runAgentLoop with MCP tools and returns finalText", async () => {
    const manager = makeMockMcpManager([
      { serverName: "search", originalName: "web_search", description: "Search the web", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
    ]);

    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      finalText: "React 19 introduces the use() hook for async data loading.",
      exitTool: undefined,
      exitArgs: undefined,
    });

    const result = await runResearchAgent("What is new in React 19?", manager, mockEmit);

    expect(runAgentLoop).toHaveBeenCalledTimes(1);
    expect(result).toBe("React 19 introduces the use() hook for async data loading.");

    // Verify the agent loop was called with correct structure
    const callArgs = (runAgentLoop as ReturnType<typeof vi.fn>).mock.calls[0];
    const systemPrompt = callArgs[0] as string;
    const initialMessages = callArgs[1] as Array<{ role: string; content: string }>;
    const schemas = callArgs[2] as Array<{ type: string; function: { name: string } }>;
    const opts = callArgs[5] as Record<string, unknown>;

    expect(systemPrompt).toContain("research specialist");
    expect(initialMessages[0].content).toContain("What is new in React 19?");
    expect(schemas.length).toBe(1);
    expect(schemas[0].function.name).toBe("mcp_web_search");
    expect(opts.maxIterations).toBe(8);
    expect(opts.disableThinking).toBe(true);
  });

  it("returns timeout message when agent loop takes too long", async () => {
    const manager = makeMockMcpManager([
      { serverName: "s", originalName: "search", description: "Search", inputSchema: { type: "object", properties: {} } },
    ]);

    // Simulate a long-running agent loop (longer than 60s timeout)
    (runAgentLoop as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 120_000)),
    );

    const result = await runResearchAgent("slow query", manager, mockEmit);
    expect(result).toContain("Research timed out");
  }, 65_000); // Give the test enough time for the 60s internal timeout

  it("returns error message when agent loop throws", async () => {
    const manager = makeMockMcpManager([
      { serverName: "s", originalName: "search", description: "Search", inputSchema: { type: "object", properties: {} } },
    ]);

    (runAgentLoop as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Provider unavailable"));

    const result = await runResearchAgent("failing query", manager, mockEmit);
    expect(result).toContain("Research failed");
    expect(result).toContain("Provider unavailable");
  });

  it("returns fallback message when finalText is empty", async () => {
    const manager = makeMockMcpManager([
      { serverName: "s", originalName: "search", description: "Search", inputSchema: { type: "object", properties: {} } },
    ]);

    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      finalText: "",
      exitTool: undefined,
      exitArgs: undefined,
    });

    const result = await runResearchAgent("empty result query", manager, mockEmit);
    expect(result).toContain("Research completed but returned no text");
  });

  it("passes multiple MCP tools to the sub-agent when available", async () => {
    const manager = makeMockMcpManager([
      { serverName: "search", originalName: "web_search", description: "Search", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
      { serverName: "search", originalName: "fetch_url", description: "Fetch a URL", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
      { serverName: "github", originalName: "list_repos", description: "List repos", inputSchema: { type: "object", properties: {} } },
    ]);

    (runAgentLoop as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      finalText: "Found info",
      exitTool: undefined,
      exitArgs: undefined,
    });

    await runResearchAgent("test", manager, mockEmit);

    const schemas = (runAgentLoop as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(schemas.length).toBe(3);
    expect(schemas.map((s: any) => s.function.name).sort()).toEqual([
      "mcp_fetch_url", "mcp_list_repos", "mcp_web_search",
    ]);
  });
});
