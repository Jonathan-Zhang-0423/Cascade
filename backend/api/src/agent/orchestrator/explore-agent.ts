import { runAgentLoop } from "../loop/agent-loop";
import { resolveAgentModel, type AIProvider } from "../providers/agent-model-router";
import { buildAgentToolkit } from "../tools/toolkit";
import type { BuildSessionState } from "./build-orchestrator";

const EXPLORE_SYSTEM_PROMPT = `You are a fast codebase scanner. Your job is to quickly understand the most relevant parts of an existing project for a given user request.

Use list_files, grep, read_many_files, read_file_range, file_info, and LSP/AST read-only tools to inspect only the most relevant files. Then return a concise summary using exactly these headings:

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

  const explorerSession: BuildSessionState = {
    id: `explore-${Date.now()}`,
    aborted: false,
    files: new Map(files.map(f => [f.path, f.content])),
    plan: { steps: [] },
    userRequest,
    userLang: "English",
    provider: opts?.provider,
    events: [],
    nextEventId: 1,
    done: false,
    sseWriters: new Set(),
    parts: [],
    status: { type: "busy", agent: "explorer" },
  };
  const toolkit = buildAgentToolkit("explorer", { session: explorerSession });

  try {
    const result = await runAgentLoop(
      `${EXPLORE_SYSTEM_PROMPT}\n\n${toolkit.toolManifest}`,
      [{ role: "user", content: initialMessage }],
      toolkit.schemas,
      toolkit.handlers,
      () => {},  // no SSE emission — we only want the final text
      {
        maxIterations: 5,
          client,
          model,
          disableThinking: true,
          phase: "research",
          toolPolicies: toolkit.policies,
          runtimePolicy: {
            role: "explorer",
            provider: decision.provider,
            model,
            maxIterations: 5,
            thinkingMode: "disabled",
            routingMode: decision.routingMode,
            thinkingProfile: "disabled",
            toolPolicies: toolkit.policies,
          },
        },
      );
    return result.finalText.trim();
  } catch {
    // If explore fails, return empty — caller skips injection
    return "";
  }
}
