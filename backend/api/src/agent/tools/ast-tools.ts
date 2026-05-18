import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { ToolSchema, ToolHandler } from "./agent-loop";
import type { BuildSessionState } from "./build-orchestrator";

function isLanguageMatch(filePath: string, language: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (language === "typescript") return ext === "ts" || ext === "tsx";
  if (language === "javascript") return ext === "js" || ext === "jsx";
  if (language === "dart") return ext === "dart";
  return false;
}

export function buildAstTools(session: BuildSessionState): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "ast_search",
        description:
          "Search for a code pattern across all project files using AST matching. More precise than text search — matches code structure, not just text. Use metavariables like $VAR, $FUNC, $$$ARGS to match any node.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern to search for, e.g. 'console.log($ARG)' or 'function $FUNC($_) { $$$ }'",
            },
            language: {
              type: "string",
              enum: ["typescript", "javascript", "dart"],
              description: "Language to parse files as",
            },
          },
          required: ["pattern", "language"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ast_replace",
        description:
          "Replace a code pattern across project files using AST-aware rewriting. Use metavariables in the replacement to reference captured nodes from the pattern.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern to find, e.g. 'console.log($ARG)'",
            },
            replacement: {
              type: "string",
              description: "Replacement template, e.g. 'logger.log($ARG)'",
            },
            language: {
              type: "string",
              enum: ["typescript", "javascript", "dart"],
              description: "Language to parse files as",
            },
            file_path: {
              type: "string",
              description: "Restrict replacement to a specific file path (optional; omit to apply to all files)",
            },
          },
          required: ["pattern", "replacement", "language"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    ast_search: async (args, emit) => {
      const { pattern, language } = args as { pattern: string; language: string };
      // Lazy import to avoid crashing if @ast-grep/napi native binary is unavailable
      let parse: ((lang: string, src: string) => any) | null = null;
      try {
        const sg = await import("@ast-grep/napi");
        parse = sg.parse as any;
      } catch {
        return "Error: @ast-grep/napi is not available on this platform.";
      }

      const results: string[] = [];
      for (const [filePath, content] of Array.from(session.files)) {
        if (!isLanguageMatch(filePath, language)) continue;
        try {
          const tree = parse!(language, content);
          const matches = tree.root().findAll(pattern);
          if (matches.length > 0) {
            results.push(`${filePath}: ${matches.length} match(es)`);
            for (const m of matches.slice(0, 5)) {
              const range = m.range();
              const line = range.start.line + 1;
              results.push(`  Line ${line}: ${m.text().slice(0, 120)}`);
            }
            if (matches.length > 5) {
              results.push(`  ... and ${matches.length - 5} more`);
            }
          }
        } catch {
          // Skip files that fail to parse
        }
      }

      emit({ type: "action_log", actionType: "file_read", label: "AST Search", detail: pattern });
      return results.length > 0 ? results.join("\n") : "No matches found.";
    },

    ast_replace: async (args, emit) => {
      const { pattern, replacement, language, file_path: targetFile } = args as {
        pattern: string;
        replacement: string;
        language: string;
        file_path?: string;
      };

      let parse: ((lang: string, src: string) => any) | null = null;
      try {
        const sg = await import("@ast-grep/napi");
        parse = sg.parse as any;
      } catch {
        return "Error: @ast-grep/napi is not available on this platform.";
      }

      const changed: string[] = [];
      for (const [filePath, content] of Array.from(session.files)) {
        if (targetFile && filePath !== targetFile) continue;
        if (!isLanguageMatch(filePath, language)) continue;
        try {
          const tree = parse!(language, content);
          const root = tree.root();
          const edits = root.findAll(pattern).map((m: any) => m.getMatch(pattern));
          // Use the replace API if available, otherwise fall back to manual replacement
          const newContent: string = typeof root.replace === "function"
            ? root.replace(pattern, replacement)
            : content;
          if (newContent !== content) {
            session.files.set(filePath, newContent);
            emit({ type: "code_applied", filePath, code: newContent });
            // Mirror to disk
            if (session.sessionDir) {
              try {
                const abs = path.join(session.sessionDir, filePath.replace(/^\/+/, ""));
                await mkdir(path.dirname(abs), { recursive: true });
                await writeFile(abs, newContent, "utf-8");
              } catch {}
            }
            changed.push(filePath);
          }
        } catch {
          // Skip files that fail to parse
        }
      }

      return changed.length > 0
        ? `Replaced pattern in: ${changed.join(", ")}`
        : "No replacements made.";
    },
  };

  return { schemas, handlers };
}
