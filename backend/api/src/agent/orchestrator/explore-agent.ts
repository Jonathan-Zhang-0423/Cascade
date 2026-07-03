import { runAgentLoop, type ToolHandler, type ToolSchema } from "../loop/agent-loop";
import { getFastClient } from "../providers/kimi-client";

const EXPLORE_SYSTEM_PROMPT = `You are a fast codebase scanner. Your job is to quickly understand the most relevant parts of an existing project for a given user request.

Read the files most relevant to the user's request using read_file. Then return a concise summary (max 500 words) covering:
- Key patterns and architectural decisions you observed
- Existing components, functions, or modules directly relevant to the request
- Conventions the builder should follow (naming, file structure, imports)
- Anything that would help the planner write steps that fit the existing codebase

Be brief and specific. Focus on what matters for the request — not everything.`;

export async function runExploreAgent(
  files: Array<{ path: string; content: string }>,
  userRequest: string,
): Promise<string> {
  const { client, model } = getFastClient();

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
        phase: "manager",
      },
    );
    return result.finalText.trim();
  } catch {
    // If explore fails, return empty — caller skips injection
    return "";
  }
}
