import { runAgentLoop, type ToolHandler, type ToolSchema } from "../loop/agent-loop";
import { resolveAgentModel, type AIProvider } from "../providers/agent-model-router";

const EXPLORE_SYSTEM_PROMPT = `You are a fast codebase scanner. Your job is to quickly understand the most relevant parts of an existing project for a given user request.

Use list_files, grep, and read_file to inspect only the most relevant files. Then return a concise summary using exactly these headings:

relevantFiles:
- exact paths the editor should read or touch

existingBehavior:
- current user-facing behavior and code patterns that must be preserved

editRisks:
- likely regression risks or files that should not be rewritten wholesale

suggestedReadOrder:
- ordered exact paths for the editor to read first

Be brief and specific. Focus on what matters for the request — not everything.`;

export async function runExploreAgent(
  files: Array<{ path: string; content: string }>,
  userRequest: string,
  opts?: { provider?: AIProvider },
): Promise<string> {
  const decision = resolveAgentModel("explorer", opts?.provider ?? "glm");
  const { client, model } = decision;

  const fileList = files.map(f => f.path).join("\n");
  const initialMessage = `User request: ${userRequest}

Available files:
${fileList}

Read the most relevant files and return a concise summary of the codebase patterns relevant to this request.`;

  const fileMap = new Map(files.map(f => [f.path, f.content]));

  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List project files, optionally filtered by a substring or extension.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Optional substring to filter paths" },
            limit: { type: "number", description: "Maximum paths to return" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "grep",
        description: "Search project files for a literal or regex pattern. Returns matching paths and snippets.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Text or regex pattern to search" },
            include: { type: "string", description: "Optional path substring or extension filter" },
            max_results: { type: "number", description: "Maximum matching lines to return" },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the content of a file to understand the existing codebase.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to read" },
          },
          required: ["path"],
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    list_files: async (args) => {
      const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
      const limit = Math.min(Math.max(Number(args.limit) || 200, 1), 500);
      const paths = Array.from(fileMap.keys())
        .filter((p) => !query || p.toLowerCase().includes(query))
        .slice(0, limit);
      return paths.length > 0 ? paths.join("\n") : "(no matching files)";
    },
    grep: async (args) => {
      const rawPattern = String(args.pattern ?? "");
      if (!rawPattern) return "Error: pattern is required";
      const include = typeof args.include === "string" ? args.include.toLowerCase() : "";
      const maxResults = Math.min(Math.max(Number(args.max_results) || 50, 1), 120);
      let regex: RegExp;
      try {
        regex = new RegExp(rawPattern, "i");
      } catch {
        regex = new RegExp(rawPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      }
      const results: string[] = [];
      for (const [path, content] of fileMap) {
        if (include && !path.toLowerCase().includes(include)) continue;
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (!regex.test(lines[i])) continue;
          results.push(`${path}:${i + 1}: ${lines[i].trim().slice(0, 180)}`);
          if (results.length >= maxResults) return results.join("\n");
        }
      }
      return results.length > 0 ? results.join("\n") : "(no matches)";
    },
    read_file: async (args) => {
      const path = args.path as string;
      const content = fileMap.get(path);
      if (content === undefined) {
        return `File not found: ${path}. Available: ${Array.from(fileMap.keys()).join(", ")}`;
      }
      return `File: ${path}\n\n${content}`;
    },
  };

  try {
    const result = await runAgentLoop(
      EXPLORE_SYSTEM_PROMPT,
      [{ role: "user", content: initialMessage }],
      schemas,
      handlers,
      () => {},  // no SSE emission — we only want the final text
      {
        maxIterations: 5,
          client,
          model,
          disableThinking: true,
          phase: "research",
        },
      );
    return result.finalText.trim();
  } catch {
    // If explore fails, return empty — caller skips injection
    return "";
  }
}
