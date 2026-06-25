import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadMcpConfig } from "../src/agent/mcp/mcp-config";
import type { BuildSessionState } from "../src/agent/orchestrator/build-orchestrator";

function makeSession(files: Record<string, string>): BuildSessionState {
  return {
    id: "test-session",
    aborted: false,
    files: new Map(Object.entries(files)),
    plan: {},
    userRequest: "test",
    userLang: "English",
    events: [],
    nextEventId: 1,
    done: false,
    sseWriters: new Set(),
    parts: [],
    status: { type: "idle" },
  } as BuildSessionState;
}

describe("mcp-config: loadMcpConfig", () => {
  it("returns null when no .cascade/mcp.json exists", () => {
    const session = makeSession({});
    expect(loadMcpConfig(session)).toBeNull();
  });

  it("returns null when mcp.json is invalid JSON", () => {
    const session = makeSession({ ".cascade/mcp.json": "not json{" });
    expect(loadMcpConfig(session)).toBeNull();
  });

  it("returns null when mcp.json has no servers object", () => {
    const session = makeSession({ ".cascade/mcp.json": JSON.stringify({ foo: "bar" }) });
    expect(loadMcpConfig(session)).toBeNull();
  });

  it("returns null when all servers are disabled", () => {
    const config = {
      servers: {
        s1: { transport: "stdio", command: "echo", enabled: false },
      },
    };
    const session = makeSession({ ".cascade/mcp.json": JSON.stringify(config) });
    expect(loadMcpConfig(session)).toBeNull();
  });

  it("parses a valid stdio server config", () => {
    const config = {
      servers: {
        search: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@anthropic/mcp-server-web-search"],
          env: { API_KEY: "xxx" },
        },
      },
    };
    const session = makeSession({ ".cascade/mcp.json": JSON.stringify(config) });
    const result = loadMcpConfig(session);
    expect(result).not.toBeNull();
    expect(result!.servers.search).toBeDefined();
    expect(result!.servers.search.transport).toBe("stdio");
    expect(result!.servers.search.command).toBe("npx");
    expect(result!.servers.search.args).toEqual(["-y", "@anthropic/mcp-server-web-search"]);
    expect(result!.servers.search.env).toEqual({ API_KEY: "xxx" });
  });

  it("parses a valid SSE server config", () => {
    const config = {
      servers: {
        remote: {
          transport: "sse",
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "Bearer token" },
        },
      },
    };
    const session = makeSession({ ".cascade/mcp.json": JSON.stringify(config) });
    const result = loadMcpConfig(session);
    expect(result).not.toBeNull();
    expect(result!.servers.remote.transport).toBe("sse");
    expect(result!.servers.remote.url).toBe("https://mcp.example.com/sse");
  });

  it("skips stdio server with no command", () => {
    const config = {
      servers: {
        bad: { transport: "stdio" },
        good: { transport: "stdio", command: "echo" },
      },
    };
    const session = makeSession({ ".cascade/mcp.json": JSON.stringify(config) });
    const result = loadMcpConfig(session);
    expect(result).not.toBeNull();
    expect(result!.servers.bad).toBeUndefined();
    expect(result!.servers.good).toBeDefined();
  });

  it("skips sse server with no url", () => {
    const config = {
      servers: {
        bad: { transport: "sse" },
        good: { transport: "sse", url: "https://example.com/mcp" },
      },
    };
    const session = makeSession({ ".cascade/mcp.json": JSON.stringify(config) });
    const result = loadMcpConfig(session);
    expect(result).not.toBeNull();
    expect(result!.servers.bad).toBeUndefined();
    expect(result!.servers.good).toBeDefined();
  });

  it("skips servers with unsupported transport", () => {
    const config = {
      servers: {
        bad: { transport: "websocket", url: "ws://localhost" },
        good: { transport: "stdio", command: "echo" },
      },
    };
    const session = makeSession({ ".cascade/mcp.json": JSON.stringify(config) });
    const result = loadMcpConfig(session);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.servers)).toEqual(["good"]);
  });

  it("filters out disabled servers but keeps enabled ones", () => {
    const config = {
      servers: {
        off: { transport: "stdio", command: "echo", enabled: false },
        on: { transport: "stdio", command: "node", enabled: true },
        default: { transport: "stdio", command: "cat" },
      },
    };
    const session = makeSession({ ".cascade/mcp.json": JSON.stringify(config) });
    const result = loadMcpConfig(session);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.servers).sort()).toEqual(["default", "on"]);
  });
});
