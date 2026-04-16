import type { ToolSchema, ToolHandler } from "./agent-loop";
import type { BuildSessionState } from "./build-orchestrator";
import { lspManager } from "./lsp-manager";

export function buildLspTools(session: BuildSessionState): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "lsp_diagnostics",
        description:
          "Get type errors, syntax errors, and warnings for a file using the language server. Returns each diagnostic with file, line number, severity, and message.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Path of the file to check, e.g. /project/src/App.tsx",
            },
          },
          required: ["file_path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "lsp_find_references",
        description:
          "Find all usages of a symbol across the project using the language server. Requires the file path and the position (line and column) of the symbol.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "File containing the symbol",
            },
            line: {
              type: "number",
              description: "0-based line number of the symbol",
            },
            col: {
              type: "number",
              description: "0-based column (character offset) of the symbol",
            },
          },
          required: ["file_path", "line", "col"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "lsp_goto_definition",
        description:
          "Find where a symbol is defined using the language server. Returns the file path and line number of the definition.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "File containing the symbol",
            },
            line: {
              type: "number",
              description: "0-based line number of the symbol",
            },
            col: {
              type: "number",
              description: "0-based column (character offset) of the symbol",
            },
          },
          required: ["file_path", "line", "col"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    lsp_diagnostics: async (args, emit) => {
      const filePath = args.file_path as string;
      if (!filePath) return "Error: file_path is required";
      const fileName = filePath.split("/").pop() || filePath;
      emit({ type: "action_log", actionType: "file_read", label: `LSP: ${fileName}`, detail: "" });

      const diagnostics = await lspManager.getDiagnostics(session.id, filePath);
      if (diagnostics.length === 0) {
        return `No diagnostics for ${filePath} — file looks clean.`;
      }

      const lines = diagnostics.map(d => {
        const severity = d.severity === 1 ? "ERROR"
          : d.severity === 2 ? "WARNING"
          : d.severity === 3 ? "INFO"
          : "HINT";
        const line = d.range.start.line + 1;
        return `  [${severity}] Line ${line}: ${d.message}`;
      });
      return `Diagnostics for ${filePath}:\n${lines.join("\n")}`;
    },

    lsp_find_references: async (args, emit) => {
      const filePath = args.file_path as string;
      const line = args.line as number;
      const col = args.col as number;
      if (!filePath || line === undefined || col === undefined) {
        return "Error: file_path, line, and col are required";
      }
      emit({ type: "action_log", actionType: "file_read", label: "LSP: Find References", detail: filePath });

      const locations = await lspManager.findReferences(session.id, filePath, line, col);
      if (locations.length === 0) return "No references found.";

      const lines = locations.map(loc => {
        const refPath = loc.uri.replace(/^file:\/\//, "");
        return `  ${refPath}:${loc.range.start.line + 1}:${loc.range.start.character}`;
      });
      return `References (${locations.length}):\n${lines.join("\n")}`;
    },

    lsp_goto_definition: async (args, emit) => {
      const filePath = args.file_path as string;
      const line = args.line as number;
      const col = args.col as number;
      if (!filePath || line === undefined || col === undefined) {
        return "Error: file_path, line, and col are required";
      }
      emit({ type: "action_log", actionType: "file_read", label: "LSP: Goto Definition", detail: filePath });

      const loc = await lspManager.gotoDefinition(session.id, filePath, line, col);
      if (!loc) return "Definition not found.";

      const defPath = loc.uri.replace(/^file:\/\//, "");
      return `Defined at: ${defPath}:${loc.range.start.line + 1}:${loc.range.start.character}`;
    },
  };

  return { schemas, handlers };
}
