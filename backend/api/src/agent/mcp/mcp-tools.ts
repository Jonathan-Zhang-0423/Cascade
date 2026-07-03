import type { ToolSchema, ToolHandler, ToolHandlers } from "../loop/agent-loop";
import type { McpManager, McpToolInfo } from "./mcp-client";
import type { SseEmit } from "../orchestrator/build-orchestrator";

/**
 * Prefix added to MCP tool names to avoid collisions with built-in tools.
 * e.g. MCP tool "web_search" becomes "mcp_web_search" in the agent's tool list.
 */
const MCP_TOOL_PREFIX = "mcp_";

/**
 * Convert discovered MCP tools into Cascade ToolSchema + ToolHandler pairs.
 * Returns schemas and handlers ready to merge into the builder's tool set.
 */
export function buildMcpTools(manager: McpManager, emit: SseEmit): {
  schemas: ToolSchema[];
  handlers: ToolHandlers;
} {
  const tools = manager.getAvailableTools();
  const schemas: ToolSchema[] = [];
  const handlers: ToolHandlers = {};

  for (const tool of tools) {
    const prefixedName = `${MCP_TOOL_PREFIX}${tool.originalName}`;

    const schema: ToolSchema = {
      type: "function",
      function: {
        name: prefixedName,
        description: `[MCP: ${tool.serverName}] ${tool.description}`,
        parameters: normalizeInputSchema(tool.inputSchema),
      },
    };

    const handler: ToolHandler = buildMcpHandler(manager, tool, prefixedName, emit);

    schemas.push(schema);
    handlers[prefixedName] = handler;
  }

  return { schemas, handlers };
}

/**
 * Stable, model-friendly aliases for the built-in web lookup tools. These sit
 * above raw MCP names so the agent can always call `mcp_search` and `fetch_url`
 * instead of guessing whether the connected server exposed search_web,
 * web_search, fetch_url, etc.
 */
export function buildMcpAliasTools(manager: McpManager): {
  schemas: ToolSchema[];
  handlers: ToolHandlers;
} {
  const availableTools = manager.getAvailableTools();
  const searchTool = availableTools.find((tool) =>
    tool.originalName === "search_web" ||
    tool.originalName === "web_search" ||
    tool.originalName.includes("search")
  );
  const fetchTool = availableTools.find((tool) =>
    tool.originalName === "fetch_url" ||
    tool.originalName === "fetch" ||
    tool.originalName.includes("fetch")
  );

  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "mcp_search",
        description: "Search the web through the configured MCP search provider. Use this for current documentation, APIs, packages, examples, and version-specific facts.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
            max_results: {
              type: "number",
              description: "Maximum results to return (default 8, max 20)",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fetch_url",
        description: "Fetch and extract readable text from a URL through MCP. Use after mcp_search when you need to read a specific documentation page or article.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL to fetch",
            },
            max_length: {
              type: "number",
              description: "Maximum characters to return (default 8000, max 50000)",
            },
          },
          required: ["url"],
        },
      },
    },
  ];

  const handlers: ToolHandlers = {
    mcp_search: async (args, emit) => {
      const query = args.query as string;
      if (!query) return "Error: query is required";
      if (!searchTool) return "Search unavailable: no MCP search tool is connected.";
      const maxResults = Math.min(Math.max(typeof args.max_results === "number" ? args.max_results : 8, 1), 20);
      emit({ type: "action_log", actionType: "research", label: "MCP search", detail: query.slice(0, 160) });
      return manager.callTool(searchTool.serverName, searchTool.originalName, {
        query,
        maxResults,
        max_results: maxResults,
      });
    },
    fetch_url: async (args, emit) => {
      const url = args.url as string;
      if (!url) return "Error: url is required";
      if (!fetchTool) return "Fetch unavailable: no MCP fetch_url tool is connected.";
      const maxLength = Math.min(Math.max(typeof args.max_length === "number" ? args.max_length : 8000, 100), 50000);
      emit({ type: "action_log", actionType: "research", label: "Fetch URL", detail: url.slice(0, 200) });
      return manager.callTool(fetchTool.serverName, fetchTool.originalName, {
        url,
        maxLength,
        max_length: maxLength,
      });
    },
  };

  return { schemas, handlers };
}

/**
 * Get the list of MCP tool names (prefixed) for use in prompt injection.
 */
export function getMcpToolNames(manager: McpManager): string[] {
  return manager.getAvailableTools().map((t) => `${MCP_TOOL_PREFIX}${t.originalName}`);
}

/**
 * Normalize an MCP input schema to OpenAI function parameters format.
 * MCP uses standard JSON Schema; OpenAI expects { type: "object", properties, required? }.
 */
function normalizeInputSchema(schema: Record<string, unknown>): {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
} {
  // Most MCP tools already have type: "object" at the top level
  if (schema.type === "object" && schema.properties) {
    return {
      type: "object",
      properties: schema.properties as Record<string, unknown>,
      ...(Array.isArray(schema.required) ? { required: schema.required as string[] } : {}),
    };
  }

  // Fallback: wrap the schema as a single "input" property
  if (Object.keys(schema).length === 0) {
    return { type: "object", properties: {} };
  }

  return {
    type: "object",
    properties: schema as Record<string, unknown>,
  };
}

/**
 * Build a ToolHandler that proxies calls to the MCP server.
 */
function buildMcpHandler(
  manager: McpManager,
  tool: McpToolInfo,
  prefixedName: string,
  emit: SseEmit,
): ToolHandler {
  return async (args: Record<string, unknown>) => {
    emit({
      type: "action_log",
      actionType: "tool_call",
      label: `MCP: ${tool.serverName}/${tool.originalName}`,
      detail: JSON.stringify(args).slice(0, 200),
    });

    const result = await manager.callTool(tool.serverName, tool.originalName, args);
    return result;
  };
}
