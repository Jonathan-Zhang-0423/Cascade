import { mkdir, writeFile, rm, rename } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import type { ToolSchema, ToolHandler } from "../loop/agent-loop";
import type { BuildSessionState, BuildStep, SseEmit } from "../orchestrator/build-orchestrator";
import { buildAstTools } from "./ast-tools";
import { buildLspTools } from "./lsp-tools";
import { lspManager } from "./lsp-manager";
import { buildShellTools } from "./shell-tools";
import { buildTestTools } from "./test-tools";
import { extractBlocks, applyBlockReplacement, formatBlockIndex } from "./block-hash";
import type { BuildTelemetry } from "../../infra/telemetry";
import { storage } from "../../infra/storage";
import { validateDslSequence } from "../../api/video/dsl-executor";

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

function matchesPathFilter(filePath: string, include?: string, exclude?: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (include && !globToRegExp(include).test(normalized)) return false;
  if (exclude && globToRegExp(exclude).test(normalized)) return false;
  return true;
}

export function fileVersionHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function normalizeProjectPath(rawPath: unknown): string | null {
  if (typeof rawPath !== "string") return null;
  const trimmed = rawPath.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.includes("\0")) return null;
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const parts = withSlash.split("/");
  if (parts.some((part) => part === "..")) return null;
  return withSlash.replace(/\/{2,}/g, "/");
}

function resolveProjectFilePath(files: Map<string, string>, rawPath: unknown): string | null {
  const normalized = normalizeProjectPath(rawPath);
  if (!normalized) return null;
  if (files.has(normalized)) return normalized;
  const withoutLeading = normalized.replace(/^\/+/, "");
  const projectPrefixed = `/project/${withoutLeading.replace(/^project\//, "")}`;
  if (files.has(projectPrefixed)) return projectPrefixed;
  return normalized;
}

function normalizeMoveDestination(rawPath: unknown, fromPath: string): string | null {
  const normalized = normalizeProjectPath(rawPath);
  if (!normalized) return null;
  if (normalized.startsWith("/project/")) return normalized;
  if (fromPath.startsWith("/project/")) {
    return `/project/${normalized.replace(/^\/+/, "").replace(/^project\//, "")}`;
  }
  return normalized;
}

function lineCount(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\r?\n/).length;
}

function makeFileInfo(path_: string, content: string): string {
  return [
    `File: ${path_}`,
    `Exists: true`,
    `Lines: ${lineCount(content)}`,
    `Chars: ${content.length}`,
    `File version hash: ${fileVersionHash(content)}`,
  ].join("\n");
}

function compactLogDetail(content: string, limit = 800): string {
  if (content.length <= limit) return content;
  return `${content.slice(0, limit)}\n...(log detail truncated; total ${content.length} chars)`;
}

function applyLineRange(content: string, startLineRaw: unknown, endLineRaw: unknown): {
  ok: true;
  startLine: number;
  endLine: number;
  totalLines: number;
  text: string;
} | { ok: false; message: string } {
  const lines = content.split(/\r?\n/);
  const totalLines = content.length === 0 ? 0 : lines.length;
  const startLine = Math.floor(Number(startLineRaw));
  const endLine = Math.floor(Number(endLineRaw));
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
    return { ok: false, message: "Error: start_line and end_line must be numbers" };
  }
  if (startLine < 1 || endLine < startLine) {
    return { ok: false, message: "Error: expected 1-based line range with end_line >= start_line" };
  }
  if (totalLines === 0) {
    return { ok: true, startLine: 1, endLine: 0, totalLines: 0, text: "" };
  }
  const clampedStart = Math.min(startLine, totalLines);
  const clampedEnd = Math.min(endLine, totalLines);
  return {
    ok: true,
    startLine: clampedStart,
    endLine: clampedEnd,
    totalLines,
    text: lines.slice(clampedStart - 1, clampedEnd).join("\n"),
  };
}

async function mirrorFileChangeToDiskAndLsp(
  session: BuildSessionState,
  filePath: string,
  content: string,
): Promise<void> {
  if (!session.sessionDir) return;
  try {
    const abs = path.resolve(session.sessionDir, filePath.replace(/^\/+/, ""));
    const normalizedBase = path.resolve(session.sessionDir);
    // Guard: ensure the resolved path is inside sessionDir (prevent ../../ escape)
    if (!abs.startsWith(normalizedBase)) {
      console.warn(`[agent-tools] path traversal blocked: ${filePath}`);
    } else {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf-8");
    }
  } catch (err) {
    console.warn("[agent-tools] disk mirror failed for", filePath, err instanceof Error ? err.message : err);
  }
  lspManager.notifyFileChange(session.id, filePath, content).catch(() => {});
}

async function buildTypeScriptDiagnosticSuffix(
  session: BuildSessionState,
  filePath: string,
  telemetry?: BuildTelemetry,
): Promise<string> {
  if (!session.sessionDir || (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx"))) {
    return "";
  }
  try {
    const diags = await lspManager.getDiagnostics(session.id, filePath);
    if (diags.length === 0) return "\n\nLSP: no errors.";
    const errCount = diags.filter((d) => d.severity === 1).length;
    if (errCount > 0) telemetry?.incrLspErrors(errCount);
    const lines = diags.map(d => {
      const sev = d.severity === 1 ? "ERROR" : d.severity === 2 ? "WARNING" : "INFO";
      return `  [${sev}] Line ${d.range.start.line + 1}: ${d.message}`;
    });
    return `\n\nLSP diagnostics (fix before proceeding):\n${lines.join("\n")}`;
  } catch {
    // LSP not available - silent, don't break the file operation.
    return "";
  }
}

async function applyFileContentUpdate(
  session: BuildSessionState,
  telemetry: BuildTelemetry | undefined,
  emit: SseEmit,
  filePath: string,
  content: string,
  touchedStepId?: number | string,
): Promise<string> {
  const fileName = filePath.split("/").pop() || filePath;
  emit({ type: "action_log", actionType: "file_write", label: fileName, detail: compactLogDetail(content), filePath });
  session.files.set(filePath, content);
  session.todoLedger?.recordTouchedFile(filePath, touchedStepId);
  persistFileToDb(session, filePath, content);
  emit({ type: "code_applied", filePath, code: content });
  await mirrorFileChangeToDiskAndLsp(session, filePath, content);
  telemetry?.addFileWritten(filePath);
  return buildTypeScriptDiagnosticSuffix(session, filePath, telemetry);
}

/**
 * Fire-and-forget persist of a single file to the DB. Used by write tools to
 * keep the project_files table in sync mid-build so a page refresh during a
 * long build doesn't lose intermediate iterations.
 */
export function persistFileToDb(session: BuildSessionState, filePath: string, content: string): void {
  if (!session.projectId) return;
  // Skip DB persist if a prior attempt already hit FK violation (project doesn't exist in DB)
  if ((session as any)._dbPersistDisabled) return;
  storage.upsertProjectFile(session.projectId, filePath, content).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("foreign key constraint")) {
      // Project row doesn't exist — disable further persist attempts to avoid log spam
      (session as any)._dbPersistDisabled = true;
      console.warn(`[BuildSession ${session.id}] DB persist disabled — project ${session.projectId} not found in DB`);
    } else {
      console.warn(`[BuildSession ${session.id}] mid-build DB persist failed for ${filePath}:`, msg);
    }
  });
}

export interface VerifierIssue {
  type: "bug" | "missing_feature" | "regression";
  description: string;
  affected_file?: string;
}

/**
 * Shared `update_project_memory` tool. Lets the agent (builder/fixer/manager)
 * record durable, project-specific learnings into the per-project memory doc,
 * which is injected as authoritative context at the start of future sessions.
 * The model rewrites the WHOLE doc each call (self-compacting); storage caps it.
 */
function buildProjectMemoryTool(
  projectId: string | undefined,
  userId: string | undefined,
  onUpdate?: (content: string) => void,
): { schema: ToolSchema; handler: ToolHandler } {
  const schema: ToolSchema = {
    type: "function",
    function: {
      name: "update_project_memory",
      description:
        "Record durable, project-specific knowledge into this project's long-term memory: implemented user-facing features that future work must preserve, changed files/modules and their ownership, bugs you hit and their fixes, architecture/tools/conventions in use, gotchas, and ideas worth revisiting. This memory is shown to you at the start of every future session for THIS project, so it compounds and prevents accidental regressions. Provide the COMPLETE new memory document — rewrite it, keeping it tight (drop stale/obvious entries, merge duplicates). Only record things that will help future sessions; skip one-off trivia.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The full updated memory document (markdown). Replaces the previous one. Include durable implemented behavior, touched files/modules, conventions, gotchas, and regression risks worth preserving.",
          },
        },
        required: ["content"],
      },
    },
  };
  const handler: ToolHandler = async (args, emit) => {
    const content = args.content as string;
    if (typeof content !== "string") return "Error: content (string) is required";
    if (!projectId) return "Project memory unavailable (no project context).";
    await storage.setProjectMemory(projectId, userId ?? "", content);
    onUpdate?.(content); // reflect within this session too
    emit?.({ type: "memory_updated", chars: content.length, source: "tool" });
    return `Project memory updated (${content.length} chars).`;
  };
  return { schema, handler };
}

export interface VerifierVerdict {
  status: "pass" | "fail";
  summary: string;
  requirementMatchPercent: number;
}

export interface VerifierSessionState {
  issues: VerifierIssue[];
  verdict?: VerifierVerdict;
  review?: Record<string, unknown>;
}

/** Severity assigned by the standalone review agent. Drives triage in the
 * review orchestrator: `isBlocking(severity, strictness)` decides what triggers
 * a fix round. `nit` is never blocking under any strictness. */
export type ReviewSeverity = "critical" | "major" | "minor" | "nit";

export interface ReviewIssue {
  type: "bug" | "missing_feature" | "regression";
  severity: ReviewSeverity;
  description: string;
  affected_file?: string;
}

export interface ReviewVerdict {
  summary: string;
  requirementMatchPercent: number;
}

export interface ReviewSessionState {
  issues: ReviewIssue[];
  verdict?: ReviewVerdict;
}

export interface ManagerSessionState {
  plan?: Record<string, unknown>;
  memoryTouched?: boolean;
}

async function removeFileFromDiskAndLsp(session: BuildSessionState, filePath: string): Promise<void> {
  if (!session.sessionDir) return;
  try {
    const abs = path.resolve(session.sessionDir, filePath.replace(/^\/+/, ""));
    const normalizedBase = path.resolve(session.sessionDir);
    if (!abs.startsWith(normalizedBase)) {
      console.warn(`[agent-tools] path traversal blocked on delete: ${filePath}`);
    } else {
      await rm(abs, { force: true });
    }
  } catch (err) {
    console.warn("[agent-tools] disk delete failed for", filePath, err instanceof Error ? err.message : err);
  }
  lspManager.notifyFileChange(session.id, filePath, "").catch(() => {});
}

const LATEST_PLAN_MEMORY_MARKER = "<!-- cascade:latest-plan -->";

function compactPlanMemoryLine(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : "";
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

function buildLatestPlanMemorySection(plan: Record<string, unknown>): string {
  const steps = Array.isArray(plan.steps) ? plan.steps as Array<Record<string, unknown>> : [];
  const stepLines = steps.slice(0, 8).map((step, index) => {
    const title = compactPlanMemoryLine(step.title, 90) || `Step ${index + 1}`;
    const files = Array.isArray(step.required_files)
      ? step.required_files.filter((f): f is string => typeof f === "string").slice(0, 5)
      : [];
    return `- ${title}${files.length > 0 ? ` (${files.join(", ")})` : ""}`;
  });
  const files = Array.isArray(plan.relevant_files)
    ? plan.relevant_files.filter((f): f is string => typeof f === "string").slice(0, 12)
    : [];
  return [
    LATEST_PLAN_MEMORY_MARKER,
    "## Latest Plan",
    `Summary: ${compactPlanMemoryLine(plan.summary, 240) || "(none)"}`,
    `Intent: ${compactPlanMemoryLine(plan.what_and_why, 360) || compactPlanMemoryLine(plan.overview, 360) || "(none)"}`,
    files.length > 0 ? `Relevant files: ${files.join(", ")}` : "",
    stepLines.length > 0 ? ["Steps:", ...stepLines].join("\n") : "",
    "Preservation: future work should extend this plan and preserve existing user-facing behavior unless the user explicitly changes scope.",
  ].filter(Boolean).join("\n");
}

function upsertLatestPlanMemory(existing: string, plan: Record<string, unknown>): string {
  const section = buildLatestPlanMemorySection(plan);
  const trimmed = existing.trim();
  if (!trimmed) return section;
  const markerIdx = trimmed.indexOf(LATEST_PLAN_MEMORY_MARKER);
  if (markerIdx === -1) return `${trimmed}\n\n${section}`;
  return `${trimmed.slice(0, markerIdx).trimEnd()}\n\n${section}`.trim();
}

export interface BuilderToolState {
  getCompletedStepCount(): number;
  getCompletedSteps(): Array<number | string>;
}

export function buildBuilderTools(
  session: BuildSessionState,
  planSteps?: BuildStep[],
  telemetry?: BuildTelemetry,
  exitSignal?: { exit: boolean; reason?: string },
  options?: { allowedStepIds?: Array<number | string>; completeOnlyCurrentStep?: boolean; currentStepId?: number | string },
): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
  state: BuilderToolState;
} {
  const stepByNum = new Map<number, BuildStep>();
  if (planSteps) {
    for (const s of planSteps) stepByNum.set(s.step, s);
  }
  const totalSteps = planSteps?.length ?? 0;
  const allowedStepIds = new Set<number | string>();
  for (const id of options?.allowedStepIds ?? []) {
    allowedStepIds.add(id);
    const asNum = typeof id === "string" ? Number(id) : id;
    if (Number.isFinite(asNum)) allowedStepIds.add(asNum);
  }
  // Track which steps have been marked complete so we can end the builder loop
  // deterministically once the final step is done — without depending on the
  // model to emit a separate finish_build tool call.
  const completedSteps = new Set<number | string>();
  const lastReadHashes = new Map<string, string>();

  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Write or overwrite a file in the project with the given content. Use this to create or modify any project file.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path, e.g. /project/index.html",
            },
            content: {
              type: "string",
              description: "The complete file content to write",
            },
            expected_hash: {
              type: "string",
              description: "Required when overwriting an existing file unless you just read it this session. Use the File version hash from read_file.",
            },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the current content of a file from the project. Use this to understand existing code before modifying it.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to read, e.g. /project/index.html",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_many_files",
        description: "Read several known project files in one tool call. Prefer this after explorer/plan identifies multiple relevant files. Returns each file's version hash and truncated content.",
        parameters: {
          type: "object",
          properties: {
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Exact file paths to read, e.g. ['/project/src/App.tsx', '/project/src/styles.css']",
            },
            max_chars_per_file: {
              type: "number",
              description: "Maximum characters returned per file (default 12000, max 32000)",
            },
          },
          required: ["paths"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file_range",
        description: "Read a precise 1-based line range from a large file. Use this when read_file output was truncated or you need exact context for a targeted edit.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to read, e.g. /project/src/App.tsx",
            },
            start_line: {
              type: "number",
              description: "1-based start line",
            },
            end_line: {
              type: "number",
              description: "1-based end line, inclusive",
            },
          },
          required: ["path", "start_line", "end_line"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "file_info",
        description: "Return metadata for a project file: existence, line count, character count, file version hash, and available block hashes. Use before risky edits or moves.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to inspect, e.g. /project/src/App.tsx",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List project files. Use this to discover the project structure before reading or editing files.",
        parameters: {
          type: "object",
          properties: {
            include: {
              type: "string",
              description: "Optional glob filter, e.g. '/project/src/**/*.tsx' or '**/*.json'",
            },
            exclude: {
              type: "string",
              description: "Optional glob exclude, e.g. '**/node_modules/**' or '**/*.png'",
            },
            limit: {
              type: "number",
              description: "Maximum files to return (default 200, max 1000)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "grep",
        description: "Search text across project files. Supports regex by default. Returns matching file paths with line numbers and snippets.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Text or regular expression to search for",
            },
            include: {
              type: "string",
              description: "Optional glob filter, e.g. '/project/src/**/*.tsx' or '**/*.css'",
            },
            exclude: {
              type: "string",
              description: "Optional glob exclude, e.g. '**/dist/**'",
            },
            case_sensitive: {
              type: "boolean",
              description: "Whether the search is case-sensitive (default false)",
            },
            regex: {
              type: "boolean",
              description: "Treat pattern as a regular expression (default true). Set false for literal text.",
            },
            max_results: {
              type: "number",
              description: "Maximum matching lines to return (default 80, max 300)",
            },
            context_before: {
              type: "number",
              description: "Number of lines before each match to include (default 0, max 5)",
            },
            context_after: {
              type: "number",
              description: "Number of lines after each match to include (default 0, max 5)",
            },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mark_step_complete",
        description: "Mark a plan step as complete after you have written all files for it.",
        parameters: {
          type: "object",
          properties: {
            step_id: {
              type: "string",
              description: "The step number or sub_task_id being completed, e.g. '1' or 'T001-01'",
            },
            summary: {
              type: "string",
              description: "Brief summary of what was accomplished in this step",
            },
          },
          required: ["step_id", "summary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit_file",
        description: "Edit an existing file by replacing exact text. Prefer this for small/medium changes. old_content must match exactly; by default it must match exactly once. Use replace_all only for intentional repeated replacements.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to edit, e.g. /project/src/App.tsx",
            },
            old_content: {
              type: "string",
              description: "Exact text to replace, including whitespace",
            },
            new_content: {
              type: "string",
              description: "Replacement text",
            },
            replace_all: {
              type: "boolean",
              description: "Replace all occurrences. Default false.",
            },
            expected_replacements: {
              type: "number",
              description: "Expected replacement count. Default 1 for single edit; required for safer replace_all.",
            },
          },
          required: ["path", "old_content", "new_content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "patch_file",
        description: "Replace a specific section of an existing file. Use this instead of write_file when modifying an existing file — it is more accurate because you only reproduce the changed section, not the entire file. old_content must match the current file content exactly (including whitespace). If the match fails, the tool returns an error and the file is unchanged.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to patch, e.g. /project/index.ts",
            },
            old_content: {
              type: "string",
              description: "The exact text to replace — must match the current file content verbatim",
            },
            new_content: {
              type: "string",
              description: "The replacement text",
            },
          },
          required: ["path", "old_content", "new_content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "hash_patch_file",
        description:
          "Replace a named block (function, class, interface, variable, etc.) in an existing file by its hash. More reliable than patch_file when the file contains repeated patterns or may have shifted whitespace since the last read. The block hash comes from the '--- Block hashes ---' section appended to read_file output. Fails loudly if the hash is not found — re-read the file and retry.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to patch, e.g. /project/app.ts",
            },
            region_hash: {
              type: "string",
              description: "The 8-char hash of the block to replace, from read_file output",
            },
            new_content: {
              type: "string",
              description: "The replacement text for the block (include matching indentation)",
            },
          },
          required: ["path", "region_hash", "new_content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_file",
        description: "Delete a file from the project. Use this for genuine cleanup — removing a dead/obsolete file, or the old file after moving its content elsewhere (rename = write_file the new path, then delete_file the old). Do NOT delete files a plan step doesn't call for. Fails if the file does not exist.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to delete, e.g. /project/old-helper.ts",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "move_file",
        description: "Safely rename or move a project file while preserving content. Prefer this over write_file + delete_file for renames. Supports expected_hash to avoid moving a stale version.",
        parameters: {
          type: "object",
          properties: {
            from_path: {
              type: "string",
              description: "Current file path, e.g. /project/src/old.ts",
            },
            to_path: {
              type: "string",
              description: "New file path, e.g. /project/src/new.ts",
            },
            expected_hash: {
              type: "string",
              description: "Optional current File version hash for from_path.",
            },
            overwrite: {
              type: "boolean",
              description: "Allow replacing an existing destination file. Default false.",
            },
          },
          required: ["from_path", "to_path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finish_build",
        description: "Signal that you have finished implementing ALL plan steps and the build is complete. Call this once, after every step is done and any compile checks pass. This ENDS the build — it does NOT trigger a review.",
        parameters: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "A brief summary of everything you built",
            },
          },
          required: ["summary"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submit_interaction_script",
        description: "Submit a JSON interaction script that demonstrates the app's core features. Call this BEFORE finish_build, after all steps are complete. The script will be used to auto-record a real demo video of the app running — no user involvement. If this call fails with a validation error, fix the script and retry.",
        parameters: {
          type: "object",
          properties: {
            script: {
              type: "array",
              description: "Ordered list of interaction steps demonstrating the app's main user journey",
              items: {
                type: "object",
                properties: {
                  action: { type: "string", enum: ["waitFor", "click", "fill", "press", "hover", "scroll", "wait"] },
                  by: { type: "string", enum: ["role", "text", "label", "placeholder"] },
                  role: { type: "string", description: "ARIA role for getByRole" },
                  name: { type: "string", description: "Accessible name for getByRole" },
                  text: { type: "string", description: "Visible text for getByText" },
                  label: { type: "string", description: "Label text for getByLabel" },
                  placeholder: { type: "string", description: "Placeholder text for getByPlaceholder" },
                  value: { type: "string", description: "Text to fill into an input" },
                  key: { type: "string", description: "Keyboard key to press, e.g. 'Enter', 'ArrowLeft'" },
                  selector: { type: "string", description: "CSS-free selector — only use for loadState/condition waitFor" },
                  state: { type: "string", description: "Element state for waitFor: visible|hidden|attached|detached" },
                  loadState: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
                  condition: { type: "string", description: "JS expression for waitForFunction" },
                  deltaY: { type: "number", description: "Vertical scroll delta in pixels" },
                  ms: { type: "number", description: "Wait duration in ms (max 3000)" },
                },
                required: ["action"],
              },
            },
            duration_hint: {
              type: "number",
              description: "Estimated demo video duration in seconds (10–30). Use 15 if unsure.",
            },
          },
          required: ["script", "duration_hint"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    write_file: async (args, emit) => {
      const path_ = args.path as string;
      const content = args.content as string;
      const expectedHash = typeof args.expected_hash === "string" ? args.expected_hash.trim() : "";
      if (!path_ || typeof content !== "string") {
        return "Error: path and content are required";
      }
      const current = session.files.get(path_);
      if (current !== undefined) {
        const currentHash = fileVersionHash(current);
        const lastReadHash = lastReadHashes.get(path_);
        if (expectedHash && expectedHash !== currentHash) {
          return `Error: ${path_} changed since the version you are trying to overwrite (expected_hash=${expectedHash}, current_hash=${currentHash}). Re-read the file and prefer edit_file/patch_file/hash_patch_file for targeted changes.`;
        }
        if (!expectedHash && lastReadHash !== currentHash) {
          return `Error: refusing full overwrite of existing file ${path_} without a current read. Call read_file first and then either use targeted edit_file/patch_file/hash_patch_file, or retry write_file with expected_hash=${currentHash} if a true full rewrite is required.`;
        }
      }
      const diagSuffix = await applyFileContentUpdate(session, telemetry, emit, path_, content, options?.currentStepId);
      telemetry?.incr("writeFileCount");
      const newHash = fileVersionHash(content);
      lastReadHashes.set(path_, newHash);
      return `File written successfully: ${path_} (${content.length} chars)\nFile version hash: ${newHash}${diagSuffix}`;
    },

    list_files: async (args, emit) => {
      const include = typeof args.include === "string" ? args.include : undefined;
      const exclude = typeof args.exclude === "string" ? args.exclude : undefined;
      const limit = Math.min(Math.max(typeof args.limit === "number" ? args.limit : 200, 1), 1000);
      const detail = [
        include ? `include=${include}` : "",
        exclude ? `exclude=${exclude}` : "",
        `limit=${limit}`,
      ].filter(Boolean).join(" ");
      emit({ type: "action_log", actionType: "tool_call", label: "list_files", detail });
      const allFiles = Array.from(session.files.keys())
        .filter((filePath) => matchesPathFilter(filePath, include, exclude))
        .sort();
      const shown = allFiles.slice(0, limit);
      const suffix = allFiles.length > shown.length
        ? `\n\n...${allFiles.length - shown.length} more file(s) omitted. Increase limit or narrow include.`
        : "";
      return shown.length > 0
        ? `Files (${shown.length}/${allFiles.length}):\n${shown.join("\n")}${suffix}`
        : "No files matched.";
    },

    grep: async (args, emit) => {
      const pattern = args.pattern as string;
      if (!pattern) return "Error: pattern is required";
      const include = typeof args.include === "string" ? args.include : undefined;
      const exclude = typeof args.exclude === "string" ? args.exclude : undefined;
      const caseSensitive = args.case_sensitive === true;
      const useRegex = args.regex !== false;
      const maxResults = Math.min(Math.max(typeof args.max_results === "number" ? args.max_results : 80, 1), 300);
      const contextBefore = Math.min(Math.max(typeof args.context_before === "number" ? Math.floor(args.context_before) : 0, 0), 5);
      const contextAfter = Math.min(Math.max(typeof args.context_after === "number" ? Math.floor(args.context_after) : 0, 0), 5);
      let matcher: RegExp;
      try {
        const source = useRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        matcher = new RegExp(source, caseSensitive ? "" : "i");
      } catch (err) {
        return `Error: invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`;
      }

      emit({ type: "action_log", actionType: "file_read", label: "grep", detail: pattern });

      const matches: string[] = [];
      let totalMatches = 0;
      for (const [filePath, content] of Array.from(session.files.entries()).sort(([a], [b]) => a.localeCompare(b))) {
        if (!matchesPathFilter(filePath, include, exclude)) continue;
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (!matcher.test(lines[i])) continue;
          matcher.lastIndex = 0;
          totalMatches++;
          if (matches.length < maxResults) {
            if (contextBefore === 0 && contextAfter === 0) {
              matches.push(`${filePath}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
            } else {
              const start = Math.max(0, i - contextBefore);
              const end = Math.min(lines.length - 1, i + contextAfter);
              const snippet = lines
                .slice(start, end + 1)
                .map((line, offset) => {
                  const lineNo = start + offset + 1;
                  const marker = lineNo === i + 1 ? ">" : " ";
                  return `${marker} ${lineNo}: ${line.slice(0, 240)}`;
                })
                .join("\n");
              matches.push(`${filePath}:${i + 1}\n${snippet}`);
            }
          }
        }
      }

      if (totalMatches === 0) return `No matches for ${JSON.stringify(pattern)}.`;
      const omitted = totalMatches > matches.length ? `\n\n...${totalMatches - matches.length} more match(es) omitted.` : "";
      return `Matches (${matches.length}/${totalMatches}):\n${matches.join("\n")}${omitted}`;
    },

    edit_file: async (args, emit) => {
      const path_ = args.path as string;
      const oldContent = args.old_content as string;
      const newContent = args.new_content as string;
      const replaceAll = args.replace_all === true;
      const expectedReplacements = typeof args.expected_replacements === "number"
        ? args.expected_replacements
        : (replaceAll ? undefined : 1);
      if (!path_ || typeof oldContent !== "string" || typeof newContent !== "string") {
        return "Error: path, old_content, and new_content are required";
      }
      if (oldContent.length === 0) {
        return "Error: old_content must not be empty. Use write_file if you need to replace the entire file.";
      }
      const current = session.files.get(path_);
      if (current === undefined) {
        return `Error: file not found: ${path_}. Use write_file to create new files.`;
      }
      if (!current.includes(oldContent)) {
        return `Error: old_content not found verbatim in ${path_}. The file may have changed. Read the file first and retry with the exact current content.`;
      }

      const occurrences = current.split(oldContent).length - 1;
      if (!replaceAll && occurrences > 1) {
        return `Error: old_content appears ${occurrences} times in ${path_}, so the edit is ambiguous. Include more surrounding context to make old_content unique, set replace_all with expected_replacements, or use hash_patch_file.`;
      }
      if (expectedReplacements !== undefined && occurrences !== expectedReplacements) {
        return `Error: expected ${expectedReplacements} replacement(s) in ${path_}, but found ${occurrences}. File unchanged.`;
      }

      const patched = replaceAll
        ? current.split(oldContent).join(newContent)
        : current.replace(oldContent, newContent);
      const diagSuffix = await applyFileContentUpdate(session, telemetry, emit, path_, patched, options?.currentStepId);
      telemetry?.incr("patchFileCount");
      const newHash = fileVersionHash(patched);
      lastReadHashes.set(path_, newHash);
      return `File edited successfully: ${path_} (${replaceAll ? occurrences : 1} replacement(s), ${oldContent.length} chars -> ${newContent.length} chars)\nFile version hash: ${newHash}${diagSuffix}`;
    },

    patch_file: async (args, emit) => {
      const path_ = args.path as string;
      const oldContent = args.old_content as string;
      const newContent = args.new_content as string;
      if (!path_ || typeof oldContent !== "string" || typeof newContent !== "string") {
        return "Error: path, old_content, and new_content are required";
      }
      const current = session.files.get(path_);
      if (current === undefined) {
        return `Error: file not found: ${path_}. Use write_file to create new files.`;
      }
      if (!current.includes(oldContent)) {
        return `Error: old_content not found verbatim in ${path_}. The file may have changed. Read the file first and retry with the exact current content.`;
      }
      // Refuse ambiguous patches: if old_content appears more than once, a blind
      // replace would silently patch only the FIRST occurrence — a real
      // correctness footgun. Make the model disambiguate with more context
      // (or use hash_patch_file for a named block).
      const occurrences = current.split(oldContent).length - 1;
      if (occurrences > 1) {
        return `Error: old_content appears ${occurrences} times in ${path_}, so the patch is ambiguous. Include more surrounding context to make old_content unique, or use hash_patch_file to target a specific block.`;
      }
      const patched = current.replace(oldContent, newContent);
      const diagSuffix = await applyFileContentUpdate(session, telemetry, emit, path_, patched, options?.currentStepId);
      telemetry?.incr("patchFileCount");
      const newHash = fileVersionHash(patched);
      lastReadHashes.set(path_, newHash);
      return `File patched successfully: ${path_} (replaced ${oldContent.length} chars with ${newContent.length} chars)\nFile version hash: ${newHash}${diagSuffix}`;
    },

    hash_patch_file: async (args, emit) => {
      const path_ = args.path as string;
      const regionHash = args.region_hash as string;
      const newContent = args.new_content as string;
      if (!path_ || typeof regionHash !== "string" || typeof newContent !== "string") {
        return "Error: path, region_hash, and new_content are required";
      }
      const current = session.files.get(path_);
      if (current === undefined) {
        return `Error: file not found: ${path_}. Use write_file to create new files.`;
      }

      let blocks;
      try {
        blocks = await extractBlocks(path_, current);
      } catch (err) {
        return `Error extracting blocks from ${path_}: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (blocks.length === 0) {
        return `Error: no blocks could be extracted from ${path_}. Use patch_file or write_file instead.`;
      }
      const match = blocks.find((b) => b.hash === regionHash);
      if (!match) {
        const available = blocks.slice(0, 5).map((b) => {
          const label = b.name ? `${b.kind} ${b.name}` : b.kind;
          return `  [${b.hash}] ${label} (lines ${b.startLine}-${b.endLine})`;
        }).join("\n");
        telemetry?.incr("hashPatchMissCount");
        return `Error: block hash ${regionHash} not found in ${path_}. Re-read the file and retry.\nAvailable blocks:\n${available}`;
      }

      const patched = applyBlockReplacement(current, match, newContent);
      const diagSuffix = await applyFileContentUpdate(session, telemetry, emit, path_, patched, options?.currentStepId);
      const label = match.name ? `${match.kind} ${match.name}` : match.kind;
      telemetry?.incr("hashPatchFileCount");
      const newHash = fileVersionHash(patched);
      lastReadHashes.set(path_, newHash);
      return `File patched: ${path_}, block [${regionHash}] ${label} replaced (${newContent.length} chars)\nFile version hash: ${newHash}${diagSuffix}`;
    },

    delete_file: async (args, emit) => {
      const path_ = args.path as string;
      if (!path_) return "Error: path is required";
      if (!session.files.has(path_)) {
        return `Error: file not found: ${path_}. Available files: ${Array.from(session.files.keys()).join(", ") || "(none)"}`;
      }
      const fileName = path_.split("/").pop() || path_;
      emit({ type: "action_log", actionType: "file_delete", label: fileName, detail: "", filePath: path_ });
      session.files.delete(path_);
      session.todoLedger?.recordTouchedFile(path_, options?.currentStepId);
      if (session.projectId) {
        try {
          await storage.deleteProjectFile(session.projectId, path_);
        } catch (err) {
          console.warn(`[agent-tools] DB delete failed for ${path_}:`, err instanceof Error ? err.message : err);
        }
      }
      emit({ type: "file_deleted", filePath: path_ });

      // Remove the disk mirror + tell the LSP the file is gone (empty content).
      await removeFileFromDiskAndLsp(session, path_);

      telemetry?.incr("deleteFileCount");
      return `File deleted: ${path_}`;
    },

    move_file: async (args, emit) => {
      const fromPath = resolveProjectFilePath(session.files, args.from_path);
      const toPath = fromPath ? normalizeMoveDestination(args.to_path, fromPath) : normalizeProjectPath(args.to_path);
      const expectedHash = typeof args.expected_hash === "string" ? args.expected_hash.trim() : "";
      const overwrite = args.overwrite === true;
      if (!fromPath || !toPath) return "Error: from_path and to_path are required project paths";
      if (fromPath === toPath) return "Error: from_path and to_path are the same";
      const content = session.files.get(fromPath);
      if (content === undefined) {
        return `Error: file not found: ${fromPath}. Available files: ${Array.from(session.files.keys()).join(", ") || "(none)"}`;
      }
      if (session.files.has(toPath) && !overwrite) {
        return `Error: destination already exists: ${toPath}. Pass overwrite=true only if replacing it is intentional.`;
      }
      const currentHash = fileVersionHash(content);
      if (expectedHash && expectedHash !== currentHash) {
        return `Error: ${fromPath} changed since the version you are trying to move (expected_hash=${expectedHash}, current_hash=${currentHash}). Re-read the file and retry.`;
      }

      const fileName = `${fromPath.split("/").pop() || fromPath} -> ${toPath.split("/").pop() || toPath}`;
      emit({ type: "action_log", actionType: "file_write", label: fileName, detail: `${fromPath} -> ${toPath}`, filePath: toPath });

      session.files.delete(fromPath);
      session.files.set(toPath, content);
      session.todoLedger?.recordTouchedFile(fromPath, options?.currentStepId);
      session.todoLedger?.recordTouchedFile(toPath, options?.currentStepId);
      if (session.projectId) {
        try {
          await storage.deleteProjectFile(session.projectId, fromPath);
          await storage.upsertProjectFile(session.projectId, toPath, content);
        } catch (err) {
          console.warn(`[agent-tools] DB move failed for ${fromPath} -> ${toPath}:`, err instanceof Error ? err.message : err);
        }
      }
      if (session.sessionDir) {
        try {
          const base = path.resolve(session.sessionDir);
          const fromAbs = path.resolve(session.sessionDir, fromPath.replace(/^\/+/, ""));
          const toAbs = path.resolve(session.sessionDir, toPath.replace(/^\/+/, ""));
          if (!fromAbs.startsWith(base) || !toAbs.startsWith(base)) {
            console.warn(`[agent-tools] path traversal blocked on move: ${fromPath} -> ${toPath}`);
          } else {
            await mkdir(path.dirname(toAbs), { recursive: true });
            await rename(fromAbs, toAbs).catch(async () => {
              await writeFile(toAbs, content, "utf-8");
              await rm(fromAbs, { force: true });
            });
          }
        } catch (err) {
          console.warn(`[agent-tools] disk move failed for ${fromPath} -> ${toPath}:`, err instanceof Error ? err.message : err);
        }
        lspManager.notifyFileChange(session.id, fromPath, "").catch(() => {});
        lspManager.notifyFileChange(session.id, toPath, content).catch(() => {});
      }
      emit({ type: "file_deleted", filePath: fromPath });
      emit({ type: "code_applied", filePath: toPath, code: content });
      telemetry?.addFileWritten(toPath);
      lastReadHashes.set(toPath, currentHash);
      lastReadHashes.delete(fromPath);
      return `File moved: ${fromPath} -> ${toPath}\nFile version hash: ${currentHash}`;
    },

    read_file: async (args, emit) => {
      const path = resolveProjectFilePath(session.files, args.path);
      if (!path) return "Error: path is required";
      const fileName = path.split("/").pop() || path;
      const content = session.files.get(path);
      emit({ type: "action_log", actionType: "file_read", label: fileName, detail: content ?? "", filePath: path });
      if (content === undefined) {
        return `File not found: ${path}. Available files: ${Array.from(session.files.keys()).join(", ") || "(none)"}`;
      }
      const versionHash = fileVersionHash(content);
      lastReadHashes.set(path, versionHash);

      // Hard cap on file content to prevent context window exhaustion.
      const MAX_READ_CHARS = 32000;
      const truncatedContent = content.length > MAX_READ_CHARS
        ? content.slice(0, MAX_READ_CHARS) + `\n\n...(file truncated at ${MAX_READ_CHARS} chars — total ${content.length} chars)`
        : content;
      // AG-16: Append block hash index so the editor can use hash_patch_file.
      let blockSuffix = "";
      try {
        const blocks = await extractBlocks(path, truncatedContent);
        const formatted = formatBlockIndex(blocks);
        if (formatted) blockSuffix = `\n\n${formatted}`;
      } catch {
        // silent — block indexing is best-effort
      }
      return `File: ${path}\nFile version hash: ${versionHash}\n\n${truncatedContent}${blockSuffix}`;
    },

    read_many_files: async (args, emit) => {
      const rawPaths = Array.isArray(args.paths) ? args.paths : [];
      if (rawPaths.length === 0) return "Error: paths must be a non-empty array";
      const maxChars = Math.min(Math.max(typeof args.max_chars_per_file === "number" ? Math.floor(args.max_chars_per_file) : 12000, 1000), 32000);
      const normalizedPaths = rawPaths
        .map((p) => resolveProjectFilePath(session.files, p))
        .filter((p): p is string => !!p);
      if (normalizedPaths.length === 0) return "Error: no valid project paths supplied";
      const uniquePaths = Array.from(new Set(normalizedPaths)).slice(0, 20);
      emit({
        type: "action_log",
        actionType: "file_read",
        label: "read_many_files",
        detail: uniquePaths.join(", "),
      });

      const chunks: string[] = [];
      for (const filePath of uniquePaths) {
        const content = session.files.get(filePath);
        if (content === undefined) {
          chunks.push(`--- ${filePath} ---\nFile not found.`);
          continue;
        }
        const versionHash = fileVersionHash(content);
        lastReadHashes.set(filePath, versionHash);
        const truncated = content.length > maxChars
          ? `${content.slice(0, maxChars)}\n\n...(file truncated at ${maxChars} chars — total ${content.length} chars; use read_file_range for precise sections)`
          : content;
        chunks.push(`--- ${filePath} ---\nFile version hash: ${versionHash}\nLines: ${lineCount(content)}\nChars: ${content.length}\n\n${truncated}`);
      }
      return chunks.join("\n\n");
    },

    read_file_range: async (args, emit) => {
      const path = resolveProjectFilePath(session.files, args.path);
      if (!path) return "Error: path is required";
      const content = session.files.get(path);
      const fileName = path.split("/").pop() || path;
      emit({ type: "action_log", actionType: "file_read", label: `${fileName} lines`, detail: `${args.start_line}-${args.end_line}`, filePath: path });
      if (content === undefined) {
        return `File not found: ${path}. Available files: ${Array.from(session.files.keys()).join(", ") || "(none)"}`;
      }
      const range = applyLineRange(content, args.start_line, args.end_line);
      if (!range.ok) return range.message;
      const versionHash = fileVersionHash(content);
      lastReadHashes.set(path, versionHash);
      return [
        `File: ${path}`,
        `File version hash: ${versionHash}`,
        `Lines: ${range.startLine}-${range.endLine} of ${range.totalLines}`,
        "",
        range.text,
      ].join("\n");
    },

    file_info: async (args, emit) => {
      const path = resolveProjectFilePath(session.files, args.path);
      if (!path) return "Error: path is required";
      const content = session.files.get(path);
      const fileName = path.split("/").pop() || path;
      emit({ type: "action_log", actionType: "file_read", label: `Info: ${fileName}`, detail: "", filePath: path });
      if (content === undefined) {
        return `File: ${path}\nExists: false\nAvailable files: ${Array.from(session.files.keys()).join(", ") || "(none)"}`;
      }
      const versionHash = fileVersionHash(content);
      lastReadHashes.set(path, versionHash);
      let blockSuffix = "";
      try {
        const blocks = await extractBlocks(path, content);
        const formatted = formatBlockIndex(blocks);
        if (formatted) blockSuffix = `\n\n${formatted}`;
      } catch {
        // best effort
      }
      return `${makeFileInfo(path, content)}${blockSuffix}`;
    },

    mark_step_complete: async (args, emit) => {
      const stepId = args.step_id as string;
      const summary = args.summary as string;
      const stepNum = parseInt(stepId, 10);

      // Resolve a canonical numeric step number.
      // If the model passed a non-numeric ID (e.g. "T001-01"), look it up by sub_task_id.
      let resolvedNum: number | string = isNaN(stepNum) ? stepId : stepNum;
      if (isNaN(stepNum) && planSteps) {
        const matched = planSteps.find((s) => s.sub_task_id === stepId);
        if (matched) resolvedNum = matched.step;
      }

      if (allowedStepIds.size > 0 && !allowedStepIds.has(resolvedNum) && !allowedStepIds.has(stepId)) {
        const allowed = Array.from(allowedStepIds).join(", ");
        return `Error: this agent loop is scoped to step ${allowed}. Complete the current step only; do not mark other steps complete.`;
      }

      // Guard: if this step was already completed, acknowledge but don't re-emit
      // events or re-trigger the completion check. Prevents the LLM from looping
      // back to redo finished steps or double-triggering all_steps_complete.
      if (completedSteps.has(resolvedNum)) {
        return `Step ${stepId} was already completed — skipping. Move on to the next incomplete step.`;
      }

      session.todoLedger?.complete(resolvedNum, summary);
      emit({ type: "step_completed", stepNumber: resolvedNum, summary });
      if (session.todoLedger) emit({ type: "ledger_snapshot", ledger: session.todoLedger.snapshot() });
      completedSteps.add(resolvedNum);

      // Advance to the next step. Step-scoped loops let the orchestrator emit
      // the next step_starting event, so do not auto-advance there.
      const numericCompleted = typeof resolvedNum === "number" ? resolvedNum : NaN;
      if (!options?.completeOnlyCurrentStep && !isNaN(numericCompleted) && totalSteps > 0) {
        const nextStep = stepByNum.get(numericCompleted + 1);
        if (nextStep) {
          session.todoLedger?.start(nextStep.step);
          if (session.todoLedger) emit({ type: "ledger_snapshot", ledger: session.todoLedger.snapshot() });
          emit({ type: "step_starting", stepNumber: nextStep.step, stepTitle: nextStep.title, totalSteps });
        }
      }

      // When every plan step has been marked complete, end the build directly
      // and signal the agent loop to exit. This makes completion deterministic
      // instead of waiting on a separate finish_build tool call that the model
      // sometimes only narrates (leaving the loop spinning to maxIterations and
      // looking frozen). Build completion does NOT trigger any review.
      if (!options?.completeOnlyCurrentStep && totalSteps > 0 && completedSteps.size >= totalSteps && exitSignal) {
        emit({ type: "build_complete" });
        exitSignal.exit = true;
        exitSignal.reason = "all_steps_complete";
      } else if (options?.completeOnlyCurrentStep && exitSignal) {
        exitSignal.exit = true;
        exitSignal.reason = "step_complete";
      }

      return `Step ${stepId} marked complete: ${summary}`;
    },

    finish_build: async (_args, emit) => {
      const snap = session.todoLedger?.snapshot();
      if (snap && !snap.allDone) {
        const open = snap.steps
          .filter((s) => s.status !== "done")
          .map((s) => `${s.stepNumber}:${s.status}`)
          .join(", ");
        return `Error: cannot finish_build yet. Unfinished plan steps: ${open || "(none)"}. Call mark_step_complete for each completed step first; if a step is still incomplete, finish that work before calling finish_build.`;
      }
      emit({ type: "build_complete" });
      return "Build finished.";
    },

    submit_interaction_script: async (args) => {
      const raw = args.script;
      const result = validateDslSequence(raw);
      if (!result.valid) {
        // Throw so the agent loop does NOT exit — Builder gets another iteration to fix it
        throw new Error(`submit_interaction_script rejected: ${result.error}`);
      }
      const durationHint = typeof args.duration_hint === "number" ? args.duration_hint : 20;
      if (session.projectId) {
        await storage.updateProjectActionSequence(session.projectId, JSON.stringify(result.actions), durationHint);
      }
      return `Interaction script saved: ${result.actions!.length} steps, ~${durationHint}s demo.`;
    },
  };

  // Add AST-Grep tools for structural code search/rewrite
  const astTools = buildAstTools(session);
  schemas.push(...astTools.schemas);
  Object.assign(handlers, astTools.handlers);

  // Add LSP tools (all three — editor/fixer can read diagnostics + navigate)
  const lspTools = buildLspTools(session);
  schemas.push(...lspTools.schemas);
  Object.assign(handlers, lspTools.handlers);

  // Add Shell tools (compile/test in sandboxed container)
  const shellTools = buildShellTools(session);
  schemas.push(...shellTools.schemas);
  Object.assign(handlers, shellTools.handlers);

  // AG-15: Add run_tests tool with auto-detected test runner
  const testTools = buildTestTools(session, telemetry);
  schemas.push(...testTools.schemas);
  Object.assign(handlers, testTools.handlers);

  // Self-evolving project memory
  const mem = buildProjectMemoryTool(session.projectId, session.userId, (c) => { session.projectMemory = c; });
  schemas.push(mem.schema);
  handlers[mem.schema.function.name] = mem.handler;

  return {
    schemas,
    handlers,
    state: {
      getCompletedStepCount: () => completedSteps.size,
      getCompletedSteps: () => Array.from(completedSteps),
    },
  };
}

export function buildVerifierTools(
  session: BuildSessionState,
  verifierState: VerifierSessionState,
): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the current content of a file from the project to review it.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to read, e.g. /project/index.html",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "report_issue",
        description: "Report a bug, missing feature, or regression found during review.",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["bug", "missing_feature", "regression"],
              description: "The type of issue",
            },
            description: {
              type: "string",
              description: "Clear description of the issue",
            },
            affected_file: {
              type: "string",
              description: "The file path where the issue exists (optional)",
            },
          },
          required: ["type", "description"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submit_verdict",
        description: "Submit your final review verdict. Call this when you have reviewed all relevant files and reported all issues.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["pass", "fail"],
              description: "Pass if the project meets requirements, fail if there are critical/major issues",
            },
            summary: {
              type: "string",
              description: "A plain-language summary of your review findings for the user",
            },
            requirement_match_percent: {
              type: "number",
              description: "Estimated percentage of requirements that are met (0-100)",
            },
          },
          required: ["status", "summary"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    read_file: async (args, emit) => {
      const path = args.path as string;
      if (!path) return "Error: path is required";
      const content = session.files.get(path);
      const fileName = path.split("/").pop() || path;
      emit({ type: "action_log", actionType: "file_read", label: fileName, detail: content ?? "", filePath: path });
      if (content === undefined) {
        return `File not found: ${path}. Available files: ${Array.from(session.files.keys()).join(", ") || "(none)"}`;
      }
      return `File: ${path}\n\n${content}`;
    },

    report_issue: async (args) => {
      const issueType = args.type as VerifierIssue["type"];
      const description = args.description as string;
      const affected_file = args.affected_file as string | undefined;
      verifierState.issues.push({ type: issueType, description, affected_file });
      return `Issue recorded (${issueType}): ${description}`;
    },

    submit_verdict: async (args) => {
      const status = args.status as "pass" | "fail";
      const summary = args.summary as string;
      const requirementMatchPercent = typeof args.requirement_match_percent === "number"
        ? args.requirement_match_percent
        : (status === "pass" ? 95 : 60);

      const bugs = verifierState.issues.filter(i => i.type === "bug").map((i, idx) => ({
        id: `BUG-${idx + 1}`,
        severity: "major" as const,
        file: i.affected_file ?? "unknown",
        description: i.description,
        expected: "",
        actual: "",
      }));
      const missing_features = verifierState.issues.filter(i => i.type === "missing_feature").map((i, idx) => ({
        id: `MISS-${idx + 1}`,
        description: i.description,
        related_step: 0,
      }));
      const regressions = verifierState.issues.filter(i => i.type === "regression").map((i, idx) => ({
        id: `REG-${idx + 1}`,
        file: i.affected_file ?? "unknown",
        description: i.description,
      }));

      verifierState.verdict = { status, summary, requirementMatchPercent };
      verifierState.review = {
        overall_status: status,
        bugs,
        missing_features,
        regressions,
        summary,
        suggestion: "",
        requirement_match_percent: requirementMatchPercent,
        user_confirmation_needed: [],
      };

      return `Verdict submitted: ${status}`;
    },
  };

  // Add LSP tools (diagnostics + references — read-only for verifier)
  const lspTools = buildLspTools(session);
  const lspVerifierSchemas = lspTools.schemas.filter(s => s.function.name !== "lsp_goto_definition");
  lspVerifierSchemas.forEach(s => schemas.push(s));
  ["lsp_diagnostics", "lsp_find_references"].forEach(name => {
    if (lspTools.handlers[name]) handlers[name] = lspTools.handlers[name];
  });

  // Add Shell tools (verifier can run tests to check correctness)
  const shellTools = buildShellTools(session);
  schemas.push(...shellTools.schemas);
  Object.assign(handlers, shellTools.handlers);

  return { schemas, handlers };
}

/**
 * Tools for the standalone review agent. Mirrors buildVerifierTools but:
 *  - report_issue carries a real `severity` (critical/major/minor/nit) instead
 *    of the in-build verifier's implicit "everything is major".
 *  - submit_review (replaces submit_verdict) derives per-severity counts from
 *    the reported issues and emits no pass/fail itself — triage against the
 *    strictness threshold happens in the review orchestrator.
 * Kept separate from buildVerifierTools so the dormant in-build review path is
 * untouched during migration.
 */
export function buildReviewTools(
  session: BuildSessionState,
  reviewState: ReviewSessionState,
): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the current content of a file from the project to review it.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "The file path to read, e.g. /project/index.html",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "report_issue",
        description: "Report a real, in-scope issue found during review. Do NOT report pre-existing unrelated lint, style preferences, or speculative concerns. Assign severity honestly — do not inflate.",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["bug", "missing_feature", "regression"],
              description: "The type of issue",
            },
            severity: {
              type: "string",
              enum: ["critical", "major", "minor", "nit"],
              description: "critical = app cannot build/run or core functionality broken (browser console errors are critical); major = a requested feature missing/broken or a real regression; minor = small correctness/UX issue that does not block requested functionality; nit = style/naming/formatting/preference. When unsure, choose the LOWER severity.",
            },
            description: {
              type: "string",
              description: "Clear, specific description of the issue",
            },
            affected_file: {
              type: "string",
              description: "The file path where the issue exists (optional)",
            },
          },
          required: ["type", "severity", "description"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submit_review",
        description: "Submit your final review. Call this once after reading the relevant files and reporting all in-scope issues. Severities you assigned drive whether issues are fixed — you do not decide pass/fail here.",
        parameters: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description: "A plain-language summary of your review findings for the user",
            },
            requirement_match_percent: {
              type: "number",
              description: "Estimated percentage of requirements that are met (0-100)",
            },
          },
          required: ["summary"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    read_file: async (args, emit) => {
      const path = args.path as string;
      if (!path) return "Error: path is required";
      const content = session.files.get(path);
      const fileName = path.split("/").pop() || path;
      emit({ type: "action_log", actionType: "file_read", label: fileName, detail: content ?? "", filePath: path });
      if (content === undefined) {
        return `File not found: ${path}. Available files: ${Array.from(session.files.keys()).join(", ") || "(none)"}`;
      }
      return `File: ${path}\n\n${content}`;
    },

    report_issue: async (args) => {
      const issueType = args.type as ReviewIssue["type"];
      const severityRaw = args.severity as string | undefined;
      const severity: ReviewSeverity =
        severityRaw === "critical" || severityRaw === "major" || severityRaw === "minor" || severityRaw === "nit"
          ? severityRaw
          : "minor";
      const description = args.description as string;
      const affected_file = args.affected_file as string | undefined;
      reviewState.issues.push({ type: issueType, severity, description, affected_file });
      return `Issue recorded (${severity} ${issueType}): ${description}`;
    },

    submit_review: async (args) => {
      const summary = args.summary as string;
      const requirementMatchPercent = typeof args.requirement_match_percent === "number"
        ? args.requirement_match_percent
        : 90;
      reviewState.verdict = { summary, requirementMatchPercent };
      return "Review submitted.";
    },
  };

  // LSP diagnostics + references (read-only — no goto_definition for review)
  const lspTools = buildLspTools(session);
  lspTools.schemas
    .filter(s => s.function.name !== "lsp_goto_definition")
    .forEach(s => schemas.push(s));
  ["lsp_diagnostics", "lsp_find_references"].forEach(name => {
    if (lspTools.handlers[name]) handlers[name] = lspTools.handlers[name];
  });

  // Shell tools (review can run compile checks / tests to confirm correctness)
  const shellTools = buildShellTools(session);
  schemas.push(...shellTools.schemas);
  Object.assign(handlers, shellTools.handlers);

  return { schemas, handlers };
}

export function buildManagerTools(
  managerState: ManagerSessionState,
  memoryCtx?: { projectId?: string; userId?: string },
): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "submit_plan",
        description: "Submit the final build plan when the user has confirmed what they want to build. Only call this after the user has confirmed your Stage 2 summary.",
        parameters: {
          type: "object",
          properties: {
            project_name: {
              type: "string",
              description: "Short project name (2-5 words)",
            },
            overview: {
              type: "string",
              description: "3-5 sentence overview of the approach and technical decisions",
            },
            what_and_why: {
              type: "string",
              description: "2-3 sentences describing what is being built and why",
            },
            done_looks_like: {
              type: "string",
              description: "Concrete description of the end state",
            },
            out_of_scope: {
              type: "string",
              description: "Brief statement of related but excluded concerns",
            },
            relevant_files: {
              type: "array",
              items: { type: "string" },
              description: "Every file that will be created or modified",
            },
            summary: {
              type: "string",
              description: "Brief one-line description of the plan",
            },
            steps: {
              type: "array",
              description: "The ordered build steps",
              items: {
                type: "object",
                properties: {
                  step: { type: "number" },
                  sub_task_id: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  acceptance_criteria: { type: "string" },
                  required_files: { type: "array", items: { type: "string" } },
                },
                required: ["step", "title", "description"],
              },
            },
            needs_input: {
              type: "array",
              items: { type: "string" },
              description: "Items needing user decision, empty array if none",
            },
            mode: {
              type: "string",
              enum: ["plan", "direct", "media"],
              description: "Set to 'media' when the user wants to generate promotional posters or demo videos for their App, not write code.",
            },
            media_task: {
              type: "object",
              description: "Required when mode is 'media'. Describes the AIGC task.",
              properties: {
                type: { type: "string", enum: ["poster", "video", "both"], description: "What to generate" },
                prompt: { type: "string", description: "User's style/content description" },
                style: { type: "string", description: "Visual style hint e.g. cyberpunk, minimalist, anime" },
                duration: { type: "number", description: "Video duration in seconds (10-30)" },
              },
              required: ["type"],
            },
          },
          required: ["steps", "summary"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    submit_plan: async (args) => {
      // Reject empty/missing steps by throwing — the agent loop treats a
      // throwing exit-tool handler as "not an exit", so the LLM sees the
      // error message and gets another iteration to re-call submit_plan
      // with real steps. maxIterations bounds the retry budget.
      const stepsRaw = args.steps;
      if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
        throw new Error("submit_plan requires a non-empty `steps` array. Each step needs at minimum { step, title, description }. Re-call submit_plan with the full ordered build steps.");
      }
      // Reject placeholder steps with empty title/description. These slip past
      // the model occasionally and render as literal "Step N" in the UI, and a
      // step that is never given real work can never be marked complete — which
      // would leave the build loop unable to reach its completion condition.
      const emptyStep = (stepsRaw as Array<Record<string, unknown>>).find((s) => {
        const title = typeof s?.title === "string" ? s.title.trim() : "";
        const description = typeof s?.description === "string" ? s.description.trim() : "";
        return title === "" || description === "";
      });
      if (emptyStep) {
        throw new Error("submit_plan rejected: every step must have a non-empty `title` AND `description`. Remove any placeholder steps and re-call submit_plan with fully described steps only.");
      }
      const plan: Record<string, unknown> = {
        overview: args.overview as string,
        what_and_why: args.what_and_why as string,
        done_looks_like: args.done_looks_like as string,
        out_of_scope: args.out_of_scope as string,
        relevant_files: args.relevant_files as string[],
        summary: args.summary as string,
        steps: stepsRaw,
        needs_input: (args.needs_input as string[] | undefined) ?? [],
        mode: (args.mode as string | undefined) ?? "plan",
        media_task: args.media_task as Record<string, unknown> | undefined,
      };
      managerState.plan = plan;
      if (memoryCtx?.projectId) {
        try {
          const existing = await storage.getProjectMemory(memoryCtx.projectId);
          const updated = upsertLatestPlanMemory(existing, plan);
          await storage.setProjectMemory(memoryCtx.projectId, memoryCtx.userId ?? "", updated);
          managerState.memoryTouched = true;
        } catch (err) {
          console.warn("[manager-tools] latest plan memory update failed:", err instanceof Error ? err.message : err);
        }
      }
      return "Plan submitted successfully.";
    },
  };

  // Self-evolving project memory (planning-time insights)
  if (memoryCtx?.projectId) {
    const mem = buildProjectMemoryTool(memoryCtx.projectId, memoryCtx.userId);
    schemas.push(mem.schema);
    handlers[mem.schema.function.name] = mem.handler;
  }

  return { schemas, handlers };
}

export function buildFixerTools(session: BuildSessionState, planSteps?: BuildStep[], telemetry?: BuildTelemetry): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  return buildBuilderTools(session, planSteps, telemetry);
}
