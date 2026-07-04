// AIGC Agent — runs inside the existing SSE stream infrastructure.
// Handles poster generation and video recording with multi-turn conversation support.

import { runAgentLoop } from "../loop/agent-loop";
import { getAIClient } from "../providers/kimi-client";
import { buildAigcTools, type AigcToolContext } from "./aigc-tools";

export const AIGC_AGENT_SYSTEM_PROMPT = `You are a visual creative assistant inside Cascade AI. You create promotional posters and demo videos for the user's App by CALLING TOOLS.

## CRITICAL RULE — NO NARRATION BEFORE TOOLS
Your VERY FIRST response to ANY request MUST be a tool call. Do NOT output any text, thinking, or narration before calling a tool. If you output text instead of calling a tool, you have failed.

- Poster request → FIRST response MUST be a capture_screenshot tool call.
- Video request → FIRST response MUST be a record_demo_video tool call.
- After the tool returns, you MAY output at most ONE short sentence, then call the next tool or finish_aigc.

## Tools
- capture_screenshot: Screenshot the user's App. ALWAYS the first call for poster requests.
- request_style: Ask the user to choose/enter a poster style. Call this RIGHT AFTER capture_screenshot returns. It BLOCKS until the user submits a style, then returns the style string.
- generate_poster: Generate an AI-styled poster using the App screenshot as reference image plus a style prompt. Call this immediately after request_style returns, using the returned style string as the prompt.
- record_demo_video: Record a real demo video. First call for video requests.
- finish_aigc: Signal completion. Call after the media is generated.

## Workflow (poster)
1. Call capture_screenshot  ← your first response, no text before this
2. Call request_style  ← blocks until the user submits a style; returns the style string
3. Call generate_poster with the style string returned by request_style as the prompt
4. Call finish_aigc

## Workflow (video)
1. Call record_demo_video  ← your first response, no text before this
2. Call finish_aigc

## Style refinement (follow-up)
- "change style / make it darker / try anime" → call generate_poster again with updated prompt (screenshot already cached). Do NOT re-capture unless explicitly asked.

## Hard rules
- NEVER describe what the poster/video looks like in text — call the tool, let the UI show it.
- NEVER output more than ONE short sentence of narration between tool calls.
- For a poster request you MUST call capture_screenshot → request_style → generate_poster → finish_aigc, in that order. Skipping request_style or generate_poster, or calling finish_aigc before generate_poster, is FORBIDDEN and will be rejected.
- If you are about to output text but have not yet called a tool this turn, STOP and call a tool instead.`;


export interface AigcSession {
  id: string;
  projectId: string;
  userId?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  events: Array<Record<string, unknown>>;
  nextEventId: number;
  done: boolean;
  /** True while runAigcAgent is executing — guards against concurrent /message. */
  running: boolean;
  /** Resolver for the in-flight request_style tool — set when the agent is
   *  blocked waiting for the user's style input, resolved by POST /style. */
  styleResolver?: (style: string) => void;
  /** User's session cookie header — injected into the screenshot browser. */
  cookie?: string;
  sseWriters: Set<(line: string) => void>;
}

export const aigcSessions = new Map<string, AigcSession>();

// Clean up when map grows too large. Never evict a session whose agent is still
// running — evicting it would 404 the client's /stream reconnect on a live gen.
setInterval(() => {
  if (aigcSessions.size > 100) {
    const idle = [...aigcSessions.entries()].filter(([, s]) => !s.running);
    const toDelete = idle.slice(0, 50);
    for (const [k] of toDelete) aigcSessions.delete(k);
  }
}, 60_000 * 10);

function emitToSession(session: AigcSession, event: Record<string, unknown>) {
  const eventId = session.nextEventId++;
  const line = `id:${eventId}\ndata:${JSON.stringify(event)}\n\n`;
  console.log(`[aigc emit] session=${session.id.slice(0, 8)} event=${event.type}${event.dataUrl ? ` (dataUrl ${String(event.dataUrl).length} chars)` : ""} writers=${session.sseWriters.size}`);
  session.events.push({ eventId, ...event });
  // Bound per-session memory: events hold full base64 data URLs (screenshots
  // ~100-300KB, posters ~1-2MB). Keep a replay window of the last 50 events.
  if (session.events.length > 50) {
    session.events.splice(0, session.events.length - 50);
  }
  for (const writer of session.sseWriters) {
    try { writer(line); } catch {}
  }
}

export async function runAigcAgent(
  session: AigcSession,
  userMessage: string,
): Promise<void> {
  const emit = (event: Record<string, unknown>) => emitToSession(session, event);

  // Mark running so concurrent /message POSTs are rejected (F8) and so the
  // cleanup eviction skips this session (F10). Cleared in the finally below.
  session.running = true;
  session.messages.push({ role: "user", content: userMessage });
  emit({ type: "user_message", content: userMessage });

  const toolCtx: AigcToolContext = {
    projectId: session.projectId,
    sessionId: session.id,
    userId: session.userId,
    emit,
    requestStyle: () => new Promise<string>((resolve) => {
      // Resolve is invoked by POST /api/aigc/session/:id/style. Clear any
      // previous resolver (shouldn't happen) before registering.
      session.styleResolver = resolve;
    }),
    cookie: session.cookie,
  };
  const { schemas, handlers } = buildAigcTools(toolCtx);
  // Use a tool-capable model (kimi) — getFastClient() returns MiniMax which
  // narrates without emitting tool_calls, so the agent never captures a
  // screenshot or generates a poster.
  const { client, model } = getAIClient("kimi");

  let assistantText = "";

  const sseEmit = (event: Record<string, unknown>) => {
    if (event.type === "text_chunk") {
      assistantText += (event.chunk as string) ?? "";
    }
    emit(event);
  };

  // Terminal-state guarantee: the client MUST always receive exactly one
  // terminal event (aigc_done on success, aigc_error otherwise) and session.done
  // must flip to true. Previously a throw skipped aigc_done entirely → the SSE
  // client hung forever in the "generating" spinner; and a tool that kept
  // failing would exhaust maxIterations then emit aigc_done (fake success).
  try {
    const result = await runAgentLoop(
      AIGC_AGENT_SYSTEM_PROMPT,
      session.messages.map((m) => ({ role: m.role, content: m.content })),
      schemas,
      handlers,
      sseEmit,
      {
        client,
        model,
        maxIterations: 8,
        exitTools: ["finish_aigc"],
        forceToolChoice: true,
        // kimi-k2.5 rejects tool_choice:"required" when thinking is enabled
        // ("400 tool_choice 'required' is incompatible with thinking enabled").
        // The AIGC flow is deterministic (screenshot → poster → finish), so
        // thinking adds no value — disable it to allow forced tool calls.
        disableThinking: true,
      },
    );

    if (assistantText) {
      session.messages.push({ role: "assistant", content: assistantText });
    }

    if (result.exitTool === "finish_aigc") {
      emit({ type: "aigc_done" });
    } else {
      // Iterations exhausted without finish_aigc — typically a tool kept
      // failing (screenshot/poster error) and the LLM retried to the cap.
      // Surface as error instead of fake success with no media.
      emit({
        type: "aigc_error",
        message: "生成未能完成（达到最大尝试次数且未产出结果），请重试。",
      });
    }
  } catch (err) {
    // Any unexpected throw (LLM 5xx, concurrency queue timeout, network) must
    // still emit a terminal event — otherwise the SSE client hangs forever.
    console.error("[aigc-agent] runAigcAgent failed:", err instanceof Error ? err.message : err);
    if (assistantText) {
      session.messages.push({ role: "assistant", content: assistantText });
    }
    emit({
      type: "aigc_error",
      message: err instanceof Error ? err.message : "生成过程中发生未知错误",
    });
  } finally {
    session.done = true;
    session.running = false;
    // If the agent exits while still waiting for a style submission, release
    // the blocked resolver so the /style route doesn't dangle.
    if (session.styleResolver) {
      try { session.styleResolver(""); } catch {}
      session.styleResolver = undefined;
    }
  }
}
