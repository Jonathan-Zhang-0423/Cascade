import type { ToolHandler, ToolHandlers, ToolSchema } from "../loop/agent-loop";
import { buildMcpAliasTools, buildMcpTools } from "../mcp/mcp-tools";
import type { McpManager } from "../mcp/mcp-client";
import { runResearchAgent, sanitizeResearchResult } from "../mcp/research-agent";
import type { AIProvider } from "../providers/kimi-client";
import type { AgentRole, ToolPolicy } from "../runtime/types";
import { inferToolPolicy } from "../runtime/tool-policy";
import type { BuildTelemetry } from "../../infra/telemetry";
import type { SseEmit } from "../../infra/sse";
import {
  buildBuilderTools,
  buildFixerTools,
  buildManagerTools,
  buildReviewTools,
  buildVerifierTools,
  type BuilderToolState,
  type ManagerSessionState,
  type ReviewSessionState,
  type VerifierSessionState,
} from "./agent-tools";
import { ToolRegistry } from "./tool-registry";
import type { BuildSessionState, BuildStep } from "../orchestrator/build-orchestrator";

export type ToolCategory = ToolPolicy["category"];

export interface ToolCapabilityMetadata {
  name: string;
  category: ToolCategory;
  mutatesFiles: boolean;
  safeToParallelize: boolean;
  allowedRoles: AgentRole[];
  source: string;
  resultCompaction?: ToolPolicy["resultCompaction"];
}

export interface AgentToolDefinition {
  schema: ToolSchema;
  handler: ToolHandler;
  policy: ToolPolicy;
  capabilityMetadata: ToolCapabilityMetadata;
}

export interface AgentToolkit {
  schemas: ToolSchema[];
  handlers: ToolHandlers;
  policies: Record<string, ToolPolicy>;
  sources: string[];
  definitions: AgentToolDefinition[];
  toolManifest: string;
  state?: BuilderToolState;
}

export interface AgentToolkitContext {
  session?: BuildSessionState;
  planSteps?: BuildStep[];
  telemetry?: BuildTelemetry;
  exitSignal?: { exit: boolean; reason?: string };
  builderOptions?: {
    allowedStepIds?: Array<number | string>;
    completeOnlyCurrentStep?: boolean;
    currentStepId?: number | string;
  };
  managerState?: ManagerSessionState;
  verifierState?: VerifierSessionState;
  reviewState?: ReviewSessionState;
  memoryCtx?: { projectId?: string; userId?: string };
  mcpManager?: McpManager | null;
  emit?: SseEmit;
  provider?: AIProvider;
  userSkillTools?: {
    schemas: ToolSchema[];
    handlers: ToolHandlers;
    policies?: Record<string, Partial<ToolPolicy>>;
  };
}

function hasBuilderState(value: unknown): value is { state: BuilderToolState } {
  return typeof value === "object" && value !== null && "state" in value;
}

const READ_TOOL_NAMES = new Set([
  "list_files",
  "grep",
  "read_file",
  "read_many_files",
  "read_file_range",
  "file_info",
  "ast_search",
  "lsp_diagnostics",
  "lsp_find_references",
  "lsp_goto_definition",
]);

const EXPLORER_TOOL_NAMES = new Set([
  "list_files",
  "grep",
  "read_file",
  "read_many_files",
  "read_file_range",
  "file_info",
  "ast_search",
  "lsp_find_references",
  "lsp_goto_definition",
]);

const VERIFY_TOOL_NAMES = new Set([
  ...READ_TOOL_NAMES,
  "shell_run",
  "run_tests",
  "report_issue",
  "submit_verdict",
  "submit_review",
]);

const EDITOR_ROLES: AgentRole[] = ["editor", "fixer"];

const BUILTIN_SOURCE_BY_ROLE: Partial<Record<AgentRole, string>> = {
  manager: "manager",
  explorer: "explorer",
  editor: "builder",
  fixer: "fixer",
  verifier: "verifier",
};

function roleAllowedTools(role: AgentRole): Set<string> | null {
  switch (role) {
    case "manager":
      return new Set([
        ...READ_TOOL_NAMES,
        "submit_plan",
        "update_project_memory",
        "mcp_*",
        "mcp_search",
        "fetch_url",
        "research",
      ]);
    case "explorer":
      return EXPLORER_TOOL_NAMES;
    case "editor":
    case "fixer":
      return null;
    case "verifier":
      return VERIFY_TOOL_NAMES;
    case "research":
      return new Set(["mcp_*", "mcp_search", "fetch_url", "research"]);
    case "memory":
    case "communicator":
      return new Set();
    default:
      return new Set();
  }
}

function allowedRolesForTool(name: string): AgentRole[] {
  if (name === "submit_plan") return ["manager"];
  if (name === "update_project_memory") return ["manager", "editor", "fixer"];
  if (name === "report_issue" || name === "submit_verdict" || name === "submit_review") return ["verifier"];
  if (name === "mark_step_complete" || name === "finish_build" || name === "submit_interaction_script") return EDITOR_ROLES;
  if (
    name === "write_file" ||
    name === "edit_file" ||
    name === "patch_file" ||
    name === "hash_patch_file" ||
    name === "move_file" ||
    name === "delete_file" ||
    name === "ast_replace"
  ) {
    return EDITOR_ROLES;
  }
  if (name === "shell_run" || name === "run_tests" || name === "lsp_diagnostics") return ["editor", "fixer", "verifier"];
  if (name === "mcp_search" || name === "fetch_url" || name === "research" || name.startsWith("mcp_")) {
    return ["manager", "editor", "fixer", "research"];
  }
  if (READ_TOOL_NAMES.has(name)) return ["manager", "explorer", "editor", "fixer", "verifier"];
  return ["editor", "fixer"];
}

function filterToolset(
  schemas: ToolSchema[],
  handlers: ToolHandlers,
  allow: Set<string> | null,
): { schemas: ToolSchema[]; handlers: ToolHandlers } {
  if (allow === null) return { schemas, handlers };
  const filteredSchemas = schemas.filter((schema) => {
    const name = schema.function.name;
    return allow.has(name) || (name.startsWith("mcp_") && allow.has("mcp_*"));
  });
  const filteredHandlers: ToolHandlers = {};
  for (const schema of filteredSchemas) {
    const name = schema.function.name;
    if (handlers[name]) filteredHandlers[name] = handlers[name];
  }
  return { schemas: filteredSchemas, handlers: filteredHandlers };
}

function registerToolset(
  registry: ToolRegistry,
  source: string,
  schemas: ToolSchema[],
  handlers: ToolHandlers,
  role: AgentRole,
  overridePolicies?: Record<string, Partial<ToolPolicy>>,
  sourceByTool?: Map<string, string>,
): void {
  const policies: Record<string, Partial<ToolPolicy>> = {};
  for (const schema of schemas) {
    const name = schema.function.name;
    sourceByTool?.set(name, source);
    policies[name] = {
      ...(overridePolicies?.[name] ?? {}),
      allowedRoles: allowedRolesForTool(name),
    };
  }
  registry.register(source, schemas, handlers, policies);
}

export function buildResearchTool(mcpManager: McpManager, provider?: AIProvider): {
  schemas: ToolSchema[];
  handlers: ToolHandlers;
} {
  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "research",
        description: "Run a focused research sub-agent to find external information from the web. Use this when you need current docs, API references, best practices, version numbers, or any information not available in the project files. The sub-agent will search the web and return a synthesized answer.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The research question - be specific. E.g. 'What is the latest TailwindCSS v4 configuration format?' or 'How to configure ESLint flat config for TypeScript?'",
            },
          },
          required: ["query"],
        },
      },
    },
  ];
  const handlers: ToolHandlers = {
    research: async (args, emitFn) => {
      const query = args.query as string;
      if (!query) return "Error: query is required";
      emitFn({ type: "action_log", actionType: "research", label: "Research", detail: query.slice(0, 100) });
      const result = await runResearchAgent(query, mcpManager, emitFn, { provider });
      const wordCount = result ? result.split(/\s+/).length : 0;
      const sourceCount = (result?.match(/https?:\/\//g) || []).length;
      const summaryLine = sourceCount > 0
        ? `Found ${sourceCount} source(s), ${wordCount} words`
        : `${wordCount} words`;
      emitFn({ type: "action_log", actionType: "research", label: "Research complete", detail: summaryLine });
      const sanitized = sanitizeResearchResult(result);
      return sanitized || "(No findings)";
    },
  };
  return { schemas, handlers };
}

function definitionsFromBuilt(
  built: { schemas: ToolSchema[]; handlers: ToolHandlers; policies: Record<string, ToolPolicy> },
  sourceByTool: Map<string, string>,
): AgentToolDefinition[] {
  return built.schemas.map((schema) => {
    const name = schema.function.name;
    const policy = built.policies[name] ?? inferToolPolicy(name, allowedRolesForTool(name));
    return {
      schema,
      handler: built.handlers[name],
      policy,
      capabilityMetadata: {
        name,
        category: policy.category,
        mutatesFiles: policy.mutatesFiles,
        safeToParallelize: policy.safeToParallelize,
        allowedRoles: policy.allowedRoles ?? allowedRolesForTool(name),
        source: sourceByTool.get(name) ?? "toolkit",
        resultCompaction: policy.resultCompaction,
      },
    };
  });
}

export function buildToolManifest(role: AgentRole, definitions: AgentToolDefinition[]): string {
  if (definitions.length === 0) return `Tool Manifest (${role}): no tools available.`;
  const lines = definitions
    .map((def) => {
      const mode = def.policy.mutatesFiles
        ? "mutates files"
        : def.policy.safeToParallelize
          ? "read-only, parallel-safe"
          : "serial";
      return `- ${def.schema.function.name}: ${def.policy.category}; ${mode}. ${def.schema.function.description}`;
    })
    .join("\n");
  const usage =
    role === "editor" || role === "fixer"
      ? "Recommended order: use explorer/required_files, read_many_files or read_file_range for targeted context, edit_file/hash_patch_file for small changes, write_file for new files or true full rewrites, then run verification and complete the step."
      : role === "explorer"
        ? "Recommended order: list_files or grep briefly, read_many_files/read_file_range for the most relevant files, then summarize without editing."
        : role === "verifier"
          ? "Recommended order: read/search relevant files, run tests or diagnostics when useful, report_issue for real in-scope findings, then submit_review."
          : "Use only tools needed for the current role; avoid broad discovery when context already identifies the relevant files.";
  return [`Tool Manifest (${role})`, usage, lines].join("\n");
}

export function buildAgentToolkit(role: AgentRole, context: AgentToolkitContext = {}): AgentToolkit {
  const registry = new ToolRegistry();
  const sourceByTool = new Map<string, string>();
  let state: BuilderToolState | undefined;
  const allow = roleAllowedTools(role);
  const session = context.session;
  const builtinSource = BUILTIN_SOURCE_BY_ROLE[role] ?? "toolkit";

  if (session && (role === "editor" || role === "fixer")) {
    const tools = role === "fixer"
      ? buildFixerTools(session, context.planSteps, context.telemetry)
      : buildBuilderTools(session, context.planSteps, context.telemetry, context.exitSignal, context.builderOptions);
    state = hasBuilderState(tools) ? tools.state : undefined;
    const filtered = filterToolset(tools.schemas, tools.handlers, allow);
    registerToolset(registry, builtinSource, filtered.schemas, filtered.handlers, role, undefined, sourceByTool);
  } else if (session && (role === "explorer" || role === "manager")) {
    const tools = buildBuilderTools(session, context.planSteps, context.telemetry, context.exitSignal, context.builderOptions);
    state = tools.state;
    const managerReadOnlyAllow = role === "manager" ? READ_TOOL_NAMES : allow;
    const filtered = filterToolset(tools.schemas, tools.handlers, managerReadOnlyAllow);
    registerToolset(registry, role === "manager" ? "explorer" : builtinSource, filtered.schemas, filtered.handlers, role, undefined, sourceByTool);
  } else if (session && role === "verifier") {
    const readTools = buildBuilderTools(session, context.planSteps, context.telemetry);
    const filteredReadTools = filterToolset(readTools.schemas, readTools.handlers, allow);
    registerToolset(registry, "explorer", filteredReadTools.schemas, filteredReadTools.handlers, role, undefined, sourceByTool);

    const verifierState = context.verifierState;
    const reviewState = context.reviewState;
    const tools = reviewState
      ? buildReviewTools(session, reviewState)
      : buildVerifierTools(session, verifierState ?? { issues: [] });
    const filtered = filterToolset(tools.schemas, tools.handlers, allow);
    registerToolset(registry, "reviewer", filtered.schemas, filtered.handlers, role, undefined, sourceByTool);
  }

  if (role === "manager" && context.managerState) {
    const managerTools = buildManagerTools(context.managerState, context.memoryCtx);
    const filtered = filterToolset(managerTools.schemas, managerTools.handlers, allow);
    registerToolset(registry, "manager", filtered.schemas, filtered.handlers, role, undefined, sourceByTool);
  }

  if ((role === "editor" || role === "fixer") && context.userSkillTools) {
    registerToolset(
      registry,
      "user-skills",
      context.userSkillTools.schemas,
      context.userSkillTools.handlers,
      role,
      context.userSkillTools.policies,
      sourceByTool,
    );
  }

  const mcpManager = context.mcpManager;
  if (mcpManager && mcpManager.getAvailableTools().length > 0) {
    const rawMcp = buildMcpTools(mcpManager, context.emit ?? (() => {}));
    const filteredRawMcp = filterToolset(rawMcp.schemas, rawMcp.handlers, allow);
    registerToolset(registry, "mcp", filteredRawMcp.schemas, filteredRawMcp.handlers, role, undefined, sourceByTool);

    const aliases = buildMcpAliasTools(mcpManager);
    const filteredAliases = filterToolset(aliases.schemas, aliases.handlers, allow);
    registerToolset(registry, "mcp-aliases", filteredAliases.schemas, filteredAliases.handlers, role, undefined, sourceByTool);

    const research = buildResearchTool(mcpManager, context.provider);
    const filteredResearch = filterToolset(research.schemas, research.handlers, allow);
    registerToolset(registry, "research", filteredResearch.schemas, filteredResearch.handlers, role, undefined, sourceByTool);
  }

  const built = registry.build();
  const sources = registry.listSources();
  const definitions = definitionsFromBuilt(built, sourceByTool);
  return {
    ...built,
    sources,
    definitions,
    toolManifest: buildToolManifest(role, definitions),
    state,
  };
}
