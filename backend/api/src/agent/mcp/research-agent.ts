import { runAgentLoop, type ToolSchema, type ToolHandlers } from "../loop/agent-loop";
import { buildMcpTools } from "./mcp-tools";
import type { McpManager } from "./mcp-client";
import type { SseEmit } from "../orchestrator/build-orchestrator";
import { getFastClient } from "../providers/kimi-client";

const RESEARCH_TIMEOUT = 60_000;
const RESEARCH_MAX_ITERATIONS = 8;

const RESEARCH_SYSTEM_PROMPT = `You are a research specialist. Your job is to find accurate, current information from the web to answer a specific question.

## Workflow
1. Use your search tools (mcp_web_search, mcp_brave_search, or similar) to find relevant results.
2. If search results contain promising URLs and you have a fetch/read tool available, use it to read the full page content.
3. Synthesize your findings into a clear, concise answer (max 1000 words).
4. Focus on facts, code examples, version numbers, and actionable details — skip filler and marketing text.

## Rules
- Be specific and factual. Cite sources when possible (include URLs).
- If you find conflicting information, note the discrepancy.
- If you cannot find the answer, say so clearly — do NOT fabricate information.
- Return ONLY the research findings as plain text. No preamble like "I found that..." or "Here are my findings:".
- Prefer official documentation over blog posts. Prefer recent results over old ones.`;

/**
 * Run a focused research sub-agent that uses MCP tools to gather external
 * information from the web. Returns the research findings as a string.
 *
 * Pattern mirrors explore-agent.ts: an independent runAgentLoop call with
 * scoped tools and limited iterations.
 */
export async function runResearchAgent(
  query: string,
  mcpManager: McpManager,
  emit: SseEmit,
): Promise<string> {
  // Build tool set: only MCP tools (no file ops, no shell)
  const noopEmit: SseEmit = () => {};
  const { schemas, handlers } = buildMcpTools(mcpManager, noopEmit);

  if (schemas.length === 0) {
    return "(No research tools available — MCP servers have no tools)";
  }

  const { client, model } = getFastClient();

  const initialMessage = `Research the following question and return a clear, factual answer:

${query}

Use your search tools to find current, accurate information. Synthesize the results concisely.`;

  try {
    const result = await Promise.race([
      runAgentLoop(
        RESEARCH_SYSTEM_PROMPT,
        [{ role: "user", content: initialMessage }],
        schemas,
        handlers,
        emit,
        {
          maxIterations: RESEARCH_MAX_ITERATIONS,
          client,
          model,
          disableThinking: true, // Research doesn't need extended thinking — speed matters
          phase: "research",
        },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), RESEARCH_TIMEOUT),
      ),
    ]);

    return result.finalText.trim() || "(Research completed but returned no text)";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "timeout") {
      console.warn(`[ResearchAgent] Timed out after ${RESEARCH_TIMEOUT}ms for query: ${query.slice(0, 80)}`);
      return "(Research timed out — proceeding without external info)";
    }
    console.warn(`[ResearchAgent] Failed for query "${query.slice(0, 80)}":`, message);
    return `(Research failed: ${message})`;
  }
}

/**
 * Sanitize raw research output before returning it to the main agent.
 * Strips think tags, URLs, markdown noise, and caps total length.
 * This is the hard backend filter — no prompt reliance.
 */
export function sanitizeResearchResult(raw: string | null | undefined): string {
  if (!raw) return "";
  let text = raw
    // Strip <think>...</think> blocks (some models leak these)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    // Strip orphan <think> or </think> tags
    .replace(/<\/?think>/gi, "")
    // Strip URLs (agent doesn't need them for code generation)
    .replace(/https?:\/\/[^\s)]+/g, "")
    // Strip markdown headers (##, ###, etc.) — keep the text content
    .replace(/^#{1,6}\s+/gm, "")
    // Strip bullet/list markers that look like section headers
    .replace(/^[•\-\*]\s*\*\*[^*]+\*\*\s*/gm, "- ")
    // Collapse bold markers
    .replace(/\*\*/g, "")
    // Collapse excessive newlines
    .replace(/\n{3,}/g, "\n\n")
    // Trim
    .trim();

  // Hard cap: 2000 chars — enough for factual data, not enough for a wall of text
  if (text.length > 2000) {
    text = text.slice(0, 2000) + "\n...(truncated)";
  }
  return text;
}
