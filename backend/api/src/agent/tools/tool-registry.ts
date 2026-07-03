import type { ToolSchema, ToolHandler, ToolHandlers } from "../loop/agent-loop";
import type { ToolPolicy } from "../runtime/types";
import { inferToolPolicy } from "../runtime/tool-policy";

/**
 * ModalityPlugin — extension point for future multimodal capabilities
 * (image generation, audio, video, etc.). Implementing this interface and
 * registering it with ToolRegistry is all that's needed to give the agent
 * access to a new modality. Currently no concrete implementations exist;
 * the interface is published so external/future modules can target it.
 */
export interface ModalityPlugin {
  /** Unique identifier for this modality (e.g. "image", "audio", "video"). */
  readonly name: string;
  /** Tool schemas this modality provides to the agent. */
  getToolSchemas(): ToolSchema[];
  /** Tool handlers this modality provides. */
  getToolHandlers(): ToolHandlers;
  /** Optional: pre-process user message (e.g. extract image from multipart). */
  preprocessMessage?(message: any): Promise<any>;
  /** Optional: post-process agent output (e.g. render generated image). */
  postprocessOutput?(output: string): Promise<string>;
  /** Cleanup resources on session end. */
  dispose(): Promise<void>;
}

/**
 * ToolRegistry — unified tool registration for the agent loop. All tool
 * sources (builder, MCP, research, future modalities) register through here
 * instead of ad-hoc schema/handler array concatenation in the orchestrator.
 *
 * Benefits:
 * - Single source of truth for what tools the agent has
 * - Protected-name validation (prevent shadowing built-in tools)
 * - Modality plugins plug in without touching orchestrator code
 * - Clean iteration over registered sources for debugging/logging
 *
 * Usage:
 *   const registry = new ToolRegistry();
 *   registry.register("builder", builderSchemas, builderHandlers);
 *   registry.register("mcp", mcpSchemas, mcpHandlers);
 *   registry.registerModality(imagePlugin); // future
 *   const { schemas, handlers } = registry.build();
 */
export class ToolRegistry {
  private sources = new Map<string, { schemas: ToolSchema[]; handlers: ToolHandlers; policies: Record<string, ToolPolicy> }>();
  private modalities: ModalityPlugin[] = [];

  /** Names that cannot be overridden by external sources (MCP, modalities). */
  private static PROTECTED_NAMES = new Set([
    "write_file", "read_file", "list_files", "grep", "edit_file",
    "patch_file", "hash_patch_file", "delete_file",
    "mark_step_complete", "finish_build", "submit_plan",
    "update_project_memory", "ast_search", "ast_replace",
    "lsp_diagnostics", "lsp_find_references", "lsp_goto_definition",
    "shell_run", "run_tests", "report_issue", "submit_verdict", "submit_review",
    "mcp_search", "fetch_url", "research",
  ]);

  /** Sources that are allowed to provide protected built-in tools. */
  private static BUILTIN_SOURCES = new Set([
    "builder",
    "fixer",
    "verifier",
    "reviewer",
    "manager",
  ]);

  /**
   * Register a named tool source. Later registrations with the same source
   * name overwrite (idempotent for re-registration on retry).
   */
  register(source: string, schemas: ToolSchema[], handlers: ToolHandlers, policies: Record<string, Partial<ToolPolicy>> = {}): void {
    const isBuiltinSource = ToolRegistry.BUILTIN_SOURCES.has(source);
    const filteredSchemas: ToolSchema[] = [];
    const filteredHandlers: ToolHandlers = {};
    const filteredPolicies: Record<string, ToolPolicy> = {};

    for (const schema of schemas) {
      const name = schema.function.name;
      if (!isBuiltinSource && ToolRegistry.PROTECTED_NAMES.has(name)) {
        console.warn(`[ToolRegistry] Source "${source}" tried to register protected tool "${name}" - skipped`);
        continue;
      }
      if (!handlers[name]) {
        console.warn(`[ToolRegistry] Source "${source}" registered schema "${name}" without a handler - skipped`);
        continue;
      }
      filteredSchemas.push(schema);
      filteredHandlers[name] = handlers[name];
      filteredPolicies[name] = {
        ...inferToolPolicy(name),
        ...policies[name],
        name,
      };
    }

    for (const name of Object.keys(handlers)) {
      if (!filteredSchemas.some((schema) => schema.function.name === name)) {
        console.warn(`[ToolRegistry] Source "${source}" registered handler "${name}" without a schema - skipped`);
      }
    }

    this.sources.set(source, { schemas: filteredSchemas, handlers: filteredHandlers, policies: filteredPolicies });
  }

  /**
   * Register a modality plugin. Its tools are merged at build() time.
   */
  registerModality(plugin: ModalityPlugin): void {
    this.modalities.push(plugin);
    this.register(`modality:${plugin.name}`, plugin.getToolSchemas(), plugin.getToolHandlers());
  }

  /**
   * Build the final merged tool set for the agent loop.
   * Returns schemas + handlers ready to pass to runAgentLoop.
   */
  build(): { schemas: ToolSchema[]; handlers: ToolHandlers; policies: Record<string, ToolPolicy> } {
    const schemas: ToolSchema[] = [];
    const handlers: ToolHandlers = {};
    const policies: Record<string, ToolPolicy> = {};
    const seen = new Set<string>();

    for (const [source, { schemas: s, handlers: h, policies: p }] of Array.from(this.sources.entries())) {
      for (const schema of s) {
        const name = schema.function.name;
        if (seen.has(name)) {
          console.warn(`[ToolRegistry] Duplicate tool "${name}" from source "${source}" — skipping`);
          continue;
        }
        seen.add(name);
        schemas.push(schema);
        if (h[name]) handlers[name] = h[name];
        policies[name] = p[name] ?? inferToolPolicy(name);
      }
    }

    return { schemas, handlers, policies };
  }

  /**
   * Get all registered modality plugins (for lifecycle management).
   */
  getModalities(): readonly ModalityPlugin[] {
    return this.modalities;
  }

  /**
   * Dispose all modality plugins (call on session cleanup).
   */
  async disposeModalities(): Promise<void> {
    await Promise.allSettled(this.modalities.map(p => p.dispose()));
  }

  /**
   * List registered sources (for debugging/logging).
   */
  listSources(): string[] {
    return Array.from(this.sources.keys());
  }

  /**
   * Total tool count across all sources.
   */
  get size(): number {
    let n = 0;
    for (const { schemas } of this.sources.values()) n += schemas.length;
    return n;
  }
}
