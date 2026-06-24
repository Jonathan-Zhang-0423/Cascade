import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpConfig, McpServerConfig } from "./mcp-config";

export interface McpToolInfo {
  /** Which MCP server this tool belongs to */
  serverName: string;
  /** Original tool name from the MCP server */
  originalName: string;
  /** Description from the MCP server */
  description: string;
  /** JSON Schema for the tool's input parameters */
  inputSchema: Record<string, unknown>;
}

interface McpConnection {
  client: Client;
  transport: StdioClientTransport | SSEClientTransport;
  tools: McpToolInfo[];
}

const MCP_CONNECT_TIMEOUT = 15_000;
const MCP_CALL_TIMEOUT = 30_000;

/**
 * Manages MCP server connections for a single build session.
 * Connects to configured servers, discovers their tools, and proxies tool calls.
 */
export class McpManager {
  private connections = new Map<string, McpConnection>();

  /**
   * Connect to all servers defined in the config.
   * Failures are logged and skipped — a single broken server won't block the build.
   */
  async connect(config: McpConfig): Promise<void> {
    const entries = Object.entries(config.servers);
    const results = await Promise.allSettled(
      entries.map(([name, cfg]) => this.connectOne(name, cfg)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        console.warn(`[MCP] Failed to connect to '${entries[i][0]}': ${result.reason}`);
      }
    }

    const totalTools = Array.from(this.connections.values()).reduce((sum, c) => sum + c.tools.length, 0);
    if (this.connections.size > 0) {
      console.log(`[MCP] Connected to ${this.connections.size} server(s), discovered ${totalTools} tool(s)`);
    }
  }

  /**
   * Disconnect all MCP servers and clean up child processes.
   */
  async disconnect(): Promise<void> {
    const disconnects = Array.from(this.connections.entries()).map(async ([name, conn]) => {
      try {
        await conn.transport.close();
      } catch (err) {
        console.warn(`[MCP] Error closing '${name}':`, err instanceof Error ? err.message : err);
      }
    });
    await Promise.allSettled(disconnects);
    this.connections.clear();
  }

  /**
   * Get all discovered tools across all connected servers.
   */
  getAvailableTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = [];
    for (const conn of this.connections.values()) {
      tools.push(...conn.tools);
    }
    return tools;
  }

  /**
   * Call a tool on a specific MCP server. Returns the result as a string.
   */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      return `Error: MCP server '${serverName}' is not connected`;
    }

    try {
      const result = await Promise.race([
        conn.client.callTool({ name: toolName, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`MCP tool call timed out after ${MCP_CALL_TIMEOUT}ms`)), MCP_CALL_TIMEOUT),
        ),
      ]);

      // MCP tool results are content arrays — concatenate text parts
      if (!result.content || !Array.isArray(result.content)) {
        return result.isError ? "Error: tool returned an error with no content" : "(empty result)";
      }

      const parts: string[] = [];
      for (const item of result.content) {
        if (item.type === "text") {
          parts.push(item.text);
        } else if (item.type === "image") {
          parts.push(`[image: ${item.mimeType ?? "unknown"}, ${(item.data?.length ?? 0)} bytes base64]`);
        } else if (item.type === "resource") {
          const res = item.resource;
          if (res && typeof res.text === "string") {
            parts.push(res.text);
          } else {
            parts.push(`[embedded resource: ${res?.uri ?? "unknown"}]`);
          }
        }
      }

      const output = parts.join("\n");
      if (result.isError) {
        return `Error from MCP tool: ${output}`;
      }
      return output || "(empty result)";
    } catch (err) {
      return `Error calling MCP tool '${toolName}': ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async connectOne(name: string, cfg: McpServerConfig): Promise<void> {
    const client = new Client(
      { name: "cascade-agent", version: "1.0.0" },
      { capabilities: {} },
    );

    let transport: StdioClientTransport | SSEClientTransport;

    if (cfg.transport === "stdio") {
      transport = new StdioClientTransport({
        command: cfg.command!,
        args: cfg.args,
        env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
      });
    } else {
      // SSE transport
      transport = new SSEClientTransport(new URL(cfg.url!), {
        requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
      } as any);
    }

    // Connect with timeout
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Connection timed out after ${MCP_CONNECT_TIMEOUT}ms`)), MCP_CONNECT_TIMEOUT),
      ),
    ]);

    // Discover tools
    let tools: McpToolInfo[] = [];
    try {
      const toolList = await client.listTools();
      tools = (toolList.tools ?? []).map((t) => ({
        serverName: name,
        originalName: t.name,
        description: t.description ?? "",
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      }));
    } catch (err) {
      console.warn(`[MCP] Connected to '${name}' but failed to list tools:`, err instanceof Error ? err.message : err);
    }

    this.connections.set(name, { client, transport, tools });
    console.log(`[MCP] Connected to '${name}' (${cfg.transport}) — ${tools.length} tool(s): ${tools.map(t => t.originalName).join(", ") || "(none)"}`);
  }
}
