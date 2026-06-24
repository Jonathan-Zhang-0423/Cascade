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
