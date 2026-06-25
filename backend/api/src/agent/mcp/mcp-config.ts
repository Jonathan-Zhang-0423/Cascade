import { srcDir } from "../../infra/paths";
import { resolve } from "path";

export interface McpServerConfig {
  transport: "stdio" | "sse";
  /** stdio only: the executable to run */
  command?: string;
  /** stdio only: arguments for the command */
  args?: string[];
  /** stdio only: environment variables for the child process */
  env?: Record<string, string>;
  /** sse only: the SSE endpoint URL */
  url?: string;
  /** sse only: extra headers */
  headers?: Record<string, string>;
  /** Defaults to true. Set false to skip this server. */
  enabled?: boolean;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

const MCP_CONFIG_PATH = ".cascade/mcp.json";

/**
 * Returns the MCP config for the built-in web search server.
 * Always available — no user configuration needed.
 */
export function getBuiltinMcpConfig(): McpConfig {
  const serverPath = resolve(srcDir("agent", "mcp"), "builtin-search-server.ts");
  return {
    servers: {
      "builtin-web-search": {
        transport: "stdio",
        command: "npx",
        args: ["tsx", serverPath],
      },
    },
  };
}

/**
 * Load MCP configuration from the project's .cascade/mcp.json file.
 * Returns null if no config exists or parsing fails.
 * Accepts either a BuildSessionState (with .files Map) or a plain file array.
 */
export function loadMcpConfig(session: { files: Map<string, string> }): McpConfig | null {
  const raw = session.files.get(MCP_CONFIG_PATH);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as McpConfig;
    if (!parsed.servers || typeof parsed.servers !== "object") {
      console.warn("[MCP] mcp.json missing 'servers' object — skipping");
      return null;
    }

    // Filter out disabled servers and validate minimal fields
    const servers: Record<string, McpServerConfig> = {};
    for (const [name, cfg] of Object.entries(parsed.servers)) {
      if (cfg.enabled === false) continue;
      if (cfg.transport === "stdio" && !cfg.command) {
        console.warn(`[MCP] Server '${name}' has transport=stdio but no command — skipping`);
        continue;
      }
      if (cfg.transport === "sse" && !cfg.url) {
        console.warn(`[MCP] Server '${name}' has transport=sse but no url — skipping`);
        continue;
      }
      if (cfg.transport !== "stdio" && cfg.transport !== "sse") {
        console.warn(`[MCP] Server '${name}' has unsupported transport '${cfg.transport}' — skipping`);
        continue;
      }
      servers[name] = cfg;
    }

    if (Object.keys(servers).length === 0) return null;
    return { servers };
  } catch (err) {
    console.warn("[MCP] Failed to parse .cascade/mcp.json:", err instanceof Error ? err.message : err);
    return null;
  }
}
