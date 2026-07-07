import type { ToolPolicy, AgentRole } from "./types";

const READ_TOOLS = new Set([
  "read_file",
  "read_many_files",
  "read_file_range",
  "file_info",
  "list_files",
  "grep",
  "ast_search",
  "lsp_diagnostics",
  "lsp_find_references",
  "lsp_goto_definition",
]);

const EDIT_TOOLS = new Set(["write_file", "edit_file", "patch_file", "hash_patch_file", "move_file", "ast_replace"]);
const DELETE_TOOLS = new Set(["delete_file"]);
const CONTROL_TOOLS = new Set([
  "mark_step_complete",
  "finish_build",
  "submit_plan",
  "submit_verdict",
  "submit_review",
  "report_issue",
  "submit_interaction_script",
]);
const MEMORY_TOOLS = new Set(["update_project_memory"]);
const SHELL_TOOLS = new Set(["shell_run"]);
const TEST_TOOLS = new Set(["run_tests"]);
const NETWORK_TOOLS = new Set(["mcp_search", "fetch_url", "research"]);

export function inferToolPolicy(name: string, allowedRoles?: AgentRole[]): ToolPolicy {
  if (READ_TOOLS.has(name)) {
    return { name, category: name === "grep" || name === "ast_search" ? "search" : "read", mutatesFiles: false, safeToParallelize: true, allowedRoles, resultCompaction: "standard" };
  }
  if (EDIT_TOOLS.has(name)) {
    return { name, category: "edit", mutatesFiles: true, safeToParallelize: false, allowedRoles, resultCompaction: "standard" };
  }
  if (DELETE_TOOLS.has(name)) {
    return { name, category: "delete", mutatesFiles: true, safeToParallelize: false, allowedRoles, resultCompaction: "standard" };
  }
  if (CONTROL_TOOLS.has(name)) {
    return { name, category: "control", mutatesFiles: false, safeToParallelize: false, allowedRoles, resultCompaction: "none" };
  }
  if (MEMORY_TOOLS.has(name)) {
    return { name, category: "memory", mutatesFiles: false, safeToParallelize: false, allowedRoles, resultCompaction: "aggressive" };
  }
  if (SHELL_TOOLS.has(name)) {
    return { name, category: "shell", mutatesFiles: false, safeToParallelize: false, allowedRoles, resultCompaction: "aggressive" };
  }
  if (TEST_TOOLS.has(name)) {
    return { name, category: "test", mutatesFiles: false, safeToParallelize: false, allowedRoles, resultCompaction: "aggressive" };
  }
  if (NETWORK_TOOLS.has(name) || name.startsWith("mcp_")) {
    return { name, category: "network", mutatesFiles: false, safeToParallelize: true, allowedRoles, resultCompaction: "aggressive" };
  }
  return { name, category: "other", mutatesFiles: false, safeToParallelize: false, allowedRoles, resultCompaction: "standard" };
}

export function shouldRunToolInParallel(policy: ToolPolicy): boolean {
  return policy.safeToParallelize && !policy.mutatesFiles && policy.category !== "control" && policy.category !== "memory";
}

export function compactToolResultForPolicy(result: string, policy: ToolPolicy): string {
  const limit =
    policy.resultCompaction === "aggressive" ? 8000 :
    policy.resultCompaction === "none" ? 48000 :
    16000;
  if (result.length <= limit) return result;
  return `${result.slice(0, limit)}\n\n...(truncated by ${policy.category} tool policy; call the tool again with a narrower query if needed)`;
}
