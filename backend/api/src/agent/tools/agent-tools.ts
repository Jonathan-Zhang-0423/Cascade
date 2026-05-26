import { mkdir, writeFile } from "fs/promises";
import path from "path";
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

/**
 * Fire-and-forget persist of a single file to the DB. Used by write tools to
 * keep the project_files table in sync mid-build so a page refresh during a
 * long build doesn't lose intermediate iterations.
 */
export function persistFileToDb(session: BuildSessionState, filePath: string, content: string): void {
  if (!session.projectId) return;
  storage.upsertProjectFile(session.projectId, filePath, content).catch((err) => {
    console.warn(
      `[BuildSession ${session.id}] mid-build DB persist failed for ${filePath}:`,
      err instanceof Error ? err.message : err,
    );
  });
}

export interface VerifierIssue {
  type: "bug" | "missing_feature" | "regression";
  description: string;
  affected_file?: string;
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

export interface ManagerSessionState {
  plan?: Record<string, unknown>;
}

export function buildBuilderTools(
  session: BuildSessionState,
  planSteps?: BuildStep[],
  telemetry?: BuildTelemetry,
): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const stepByNum = new Map<number, BuildStep>();
  if (planSteps) {
    for (const s of planSteps) stepByNum.set(s.step, s);
  }
  const totalSteps = planSteps?.length ?? 0;

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
        name: "request_review",
        description: "Signal that you are done implementing all steps and the project is ready for quality review. Call this ONLY when all plan steps are complete.",
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
  ];

  const handlers: Record<string, ToolHandler> = {
    write_file: async (args, emit) => {
      const path_ = args.path as string;
      const content = args.content as string;
      if (!path_ || typeof content !== "string") {
        return "Error: path and content are required";
      }
      const fileName = path_.split("/").pop() || path_;
      emit({ type: "action_log", actionType: "file_write", label: fileName, detail: content, filePath: path_ });
      session.files.set(path_, content);
      persistFileToDb(session, path_, content);
      emit({ type: "code_applied", filePath: path_, code: content });

      // Mirror to disk
      if (session.sessionDir) {
        try {
          const abs = path.join(session.sessionDir, path_.replace(/^\/+/, ""));
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, content, "utf-8");
        } catch (err) {
          console.warn("[agent-tools] disk mirror failed for", path_, err instanceof Error ? err.message : err);
        }
        // Notify LSP server of the change
        lspManager.notifyFileChange(session.id, path_, content).catch(() => {});
      }

      // Inline LSP diagnostics for TypeScript files
      let diagSuffix = "";
      if (session.sessionDir && (path_.endsWith(".ts") || path_.endsWith(".tsx"))) {
        try {
          const diags = await lspManager.getDiagnostics(session.id, path_);
          if (diags.length > 0) {
            const errCount = diags.filter((d) => d.severity === 1).length;
            if (errCount > 0) telemetry?.incrLspErrors(errCount);
            const lines = diags.map(d => {
              const sev = d.severity === 1 ? "ERROR" : d.severity === 2 ? "WARNING" : "INFO";
              return `  [${sev}] Line ${d.range.start.line + 1}: ${d.message}`;
            });
            diagSuffix = `\n\nLSP diagnostics (fix before proceeding):\n${lines.join("\n")}`;
          } else {
            diagSuffix = "\n\nLSP: no errors.";
          }
        } catch {
          // LSP not available — silent, don't break the write
        }
      }

      telemetry?.incr("writeFileCount");
      telemetry?.addFileWritten(path_);
      return `File written successfully: ${path_} (${content.length} chars)${diagSuffix}`;
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
      const patched = current.replace(oldContent, newContent);
      const fileName = path_.split("/").pop() || path_;
      emit({ type: "action_log", actionType: "file_write", label: fileName, detail: patched, filePath: path_ });
      session.files.set(path_, patched);
      persistFileToDb(session, path_, patched);
      emit({ type: "code_applied", filePath: path_, code: patched });

      if (session.sessionDir) {
        try {
          const abs = path.join(session.sessionDir, path_.replace(/^\/+/, ""));
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, patched, "utf-8");
        } catch (err) {
          console.warn("[agent-tools] disk mirror failed for", path_, err instanceof Error ? err.message : err);
        }
        lspManager.notifyFileChange(session.id, path_, patched).catch(() => {});
      }

      // Inline LSP diagnostics for TypeScript files
      let diagSuffix = "";
      if (session.sessionDir && (path_.endsWith(".ts") || path_.endsWith(".tsx"))) {
        try {
          const diags = await lspManager.getDiagnostics(session.id, path_);
          if (diags.length > 0) {
            const lines = diags.map(d => {
              const sev = d.severity === 1 ? "ERROR" : d.severity === 2 ? "WARNING" : "INFO";
              return `  [${sev}] Line ${d.range.start.line + 1}: ${d.message}`;
            });
            diagSuffix = `\n\nLSP diagnostics (fix before proceeding):\n${lines.join("\n")}`;
          } else {
            diagSuffix = "\n\nLSP: no errors.";
          }
        } catch {
          // LSP not available — silent, don't break the patch
        }
      }

      telemetry?.incr("patchFileCount");
      telemetry?.addFileWritten(path_);
      return `File patched successfully: ${path_} (replaced ${oldContent.length} chars with ${newContent.length} chars)${diagSuffix}`;
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
      const fileName = path_.split("/").pop() || path_;
      emit({ type: "action_log", actionType: "file_write", label: fileName, detail: patched, filePath: path_ });
      session.files.set(path_, patched);
      persistFileToDb(session, path_, patched);
      emit({ type: "code_applied", filePath: path_, code: patched });

      if (session.sessionDir) {
        try {
          const abs = path.join(session.sessionDir, path_.replace(/^\/+/, ""));
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, patched, "utf-8");
        } catch (err) {
          console.warn("[agent-tools] disk mirror failed for", path_, err instanceof Error ? err.message : err);
        }
        lspManager.notifyFileChange(session.id, path_, patched).catch(() => {});
      }

      let diagSuffix = "";
      if (session.sessionDir && (path_.endsWith(".ts") || path_.endsWith(".tsx"))) {
        try {
          const diags = await lspManager.getDiagnostics(session.id, path_);
          if (diags.length > 0) {
            const lines = diags.map(d => {
              const sev = d.severity === 1 ? "ERROR" : d.severity === 2 ? "WARNING" : "INFO";
              return `  [${sev}] Line ${d.range.start.line + 1}: ${d.message}`;
            });
            diagSuffix = `\n\nLSP diagnostics (fix before proceeding):\n${lines.join("\n")}`;
          } else {
            diagSuffix = "\n\nLSP: no errors.";
          }
        } catch {
          // LSP not available — silent
        }
      }

      const label = match.name ? `${match.kind} ${match.name}` : match.kind;
      telemetry?.incr("hashPatchFileCount");
      telemetry?.addFileWritten(path_);
      return `File patched: ${path_}, block [${regionHash}] ${label} replaced (${newContent.length} chars)${diagSuffix}`;
    },

    read_file: async (args, emit) => {
      const path = args.path as string;
      if (!path) return "Error: path is required";
      const fileName = path.split("/").pop() || path;
      const content = session.files.get(path);
      emit({ type: "action_log", actionType: "file_read", label: fileName, detail: content ?? "", filePath: path });
      if (content === undefined) {
        return `File not found: ${path}. Available files: ${Array.from(session.files.keys()).join(", ") || "(none)"}`;
      }
      // AG-16: Append block hash index so the editor can use hash_patch_file.
      let blockSuffix = "";
      try {
        const blocks = await extractBlocks(path, content);
        const formatted = formatBlockIndex(blocks);
        if (formatted) blockSuffix = `\n\n${formatted}`;
      } catch {
        // silent — block indexing is best-effort
      }
      return `File: ${path}\n\n${content}${blockSuffix}`;
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

      emit({ type: "step_completed", stepNumber: resolvedNum });

      // Advance to the next step
      const numericCompleted = typeof resolvedNum === "number" ? resolvedNum : NaN;
      if (!isNaN(numericCompleted) && totalSteps > 0) {
        const nextStep = stepByNum.get(numericCompleted + 1);
        if (nextStep) {
          emit({ type: "step_starting", stepNumber: nextStep.step, stepTitle: nextStep.title, totalSteps });
        }
      }

      return `Step ${stepId} marked complete: ${summary}`;
    },

    request_review: async (_args, emit) => {
      emit({ type: "reviewing" });
      return "Review requested. Proceeding to quality review phase.";
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

  return { schemas, handlers };
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

export function buildManagerTools(
  managerState: ManagerSessionState,
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
          },
          required: ["steps", "summary"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    submit_plan: async (args) => {
      const plan: Record<string, unknown> = {
        overview: args.overview as string,
        what_and_why: args.what_and_why as string,
        done_looks_like: args.done_looks_like as string,
        out_of_scope: args.out_of_scope as string,
        relevant_files: args.relevant_files as string[],
        summary: args.summary as string,
        steps: args.steps as unknown[],
        needs_input: (args.needs_input as string[] | undefined) ?? [],
      };
      managerState.plan = plan;
      return "Plan submitted successfully.";
    },
  };

  return { schemas, handlers };
}

export function buildFixerTools(session: BuildSessionState, planSteps?: BuildStep[], telemetry?: BuildTelemetry): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  return buildBuilderTools(session, planSteps, telemetry);
}
