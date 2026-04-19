import { db } from "./db";
import { userSkills, projectSkills } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { ToolSchema, ToolHandler } from "./agent-loop";
import type { BuildSessionState, SseEmit } from "./build-orchestrator";
import { shellManager } from "./shell-manager";

export interface LoadedSkills {
  knowledgePacks: string[];
  toolSchemas: ToolSchema[];
  toolHandlers: Record<string, ToolHandler>;
}

const PROTECTED_TOOL_NAMES = new Set([
  "write_file", "read_file", "patch_file", "hash_patch_file",
  "mark_step_complete", "request_review",
  "lsp_diagnostics", "lsp_find_references", "lsp_goto_definition",
  "ast_search", "ast_replace", "shell_run", "run_tests",
]);

type ToolPluginDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: { type: "shell"; command: string } | { type: "http"; url: string; headers?: Record<string, string> };
};

function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = args[key];
    if (val === undefined) return "";
    // Shell-escape: wrap in single quotes, escape internal single quotes
    return "'" + String(val).replace(/'/g, "'\\''") + "'";
  });
}

function buildToolPlugin(
  def: ToolPluginDef,
  sessionId: string,
): { schema: ToolSchema; handler: ToolHandler } | null {
  if (PROTECTED_TOOL_NAMES.has(def.name)) {
    console.warn(`[UserSkillLoader] Tool '${def.name}' shadows a built-in tool — skipping`);
    return null;
  }

  const schema: ToolSchema = {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters as { type: "object"; properties: Record<string, unknown>; required?: string[] },
    },
  };

  let handler: ToolHandler;

  if (def.handler.type === "shell") {
    const commandTemplate = def.handler.command;
    handler = async (args, emit) => {
      const command = interpolate(commandTemplate, args);
      emit({ type: "action_log", actionType: "file_write", label: "Skill", detail: command });
      const result = await shellManager.runCommand(sessionId, command);
      const parts: string[] = [];
      if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.trim()}`);
      if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trim()}`);
      parts.push(`exit code: ${result.exitCode}`);
      return parts.join("\n\n");
    };
  } else if (def.handler.type === "http") {
    const url = def.handler.url;
    const headers = def.handler.headers ?? {};
    if (!url.startsWith("https://")) {
      console.warn(`[UserSkillLoader] Tool '${def.name}' has non-HTTPS URL — skipping`);
      return null;
    }
    handler = async (args, emit) => {
      emit({ type: "action_log", actionType: "file_write", label: "Skill", detail: `POST ${url}` });
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(args),
        });
        const text = await resp.text();
        return `HTTP ${resp.status}: ${text}`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    };
  } else {
    return null;
  }

  return { schema, handler };
}

function parseSkillContent(
  name: string,
  type: string,
  content: string,
  sessionId: string,
  result: LoadedSkills,
): void {
  if (type === "knowledge") {
    result.knowledgePacks.push(`### User Skill: ${name}\n\n${content}`);
    return;
  }
  if (type === "tool") {
    try {
      const def = JSON.parse(content) as ToolPluginDef;
      const built = buildToolPlugin(def, sessionId);
      if (built) {
        result.toolSchemas.push(built.schema);
        result.toolHandlers[def.name] = built.handler;
      }
    } catch (err) {
      console.warn(`[UserSkillLoader] Failed to parse tool plugin '${name}':`, err);
    }
  }
}

export async function loadUserSkills(
  session: BuildSessionState,
  projectId: string,
  userId: string,
): Promise<LoadedSkills> {
  const result: LoadedSkills = { knowledgePacks: [], toolSchemas: [], toolHandlers: {} };
  const seen = new Set<string>();

  // 1. Project-local: .cascade/skills/** files in session.files (highest priority)
  for (const [filePath, content] of session.files.entries()) {
    if (!filePath.startsWith(".cascade/skills/")) continue;
    const fileName = filePath.split("/").pop() ?? "";
    const isKnowledge = fileName.endsWith(".md");
    const isTool = fileName.endsWith(".tool.json");
    if (!isKnowledge && !isTool) continue;
    const name = fileName.replace(/\.(md|tool\.json)$/, "");
    seen.add(name);
    parseSkillContent(name, isKnowledge ? "knowledge" : "tool", content, session.id, result);
  }

  // 2. DB project skills
  const projSkills = await db
    .select()
    .from(projectSkills)
    .where(and(eq(projectSkills.projectId, projectId), eq(projectSkills.enabled, true)));

  for (const skill of projSkills) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    parseSkillContent(skill.name, skill.type, skill.content, session.id, result);
  }

  // 3. DB user skills (lowest priority)
  const uSkills = await db
    .select()
    .from(userSkills)
    .where(and(eq(userSkills.userId, userId), eq(userSkills.enabled, true)));

  for (const skill of uSkills) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    parseSkillContent(skill.name, skill.type, skill.content, session.id, result);
  }

  return result;
}
