// AIGC Agent — runs inside the existing SSE stream infrastructure.
// Handles poster generation and video recording with multi-turn conversation support.

import { runAgentLoop } from "../loop/agent-loop";
import { getFastClient } from "../providers/kimi-client";
import { buildAigcTools, type AigcToolContext } from "./aigc-tools";

export const AIGC_AGENT_SYSTEM_PROMPT = `You are a visual creative assistant inside Cascade AI. Your job is to help users create promotional materials for their Apps — styled posters and real demo videos.

## Your capabilities
- capture_screenshot: Take a real screenshot of the user's App (always do this first for posters)
- generate_poster: Use the screenshot + user's style prompt to create an AI-styled promotional poster
- record_demo_video: Record a real demo video of the App running with actual user interactions
- finish_aigc: Signal completion

## Workflow

### For poster requests:
1. Call capture_screenshot to get the real App screenshot
2. Interpret the user's style preference (e.g. "cyberpunk", "minimalist", "warm and cozy")
3. Call generate_poster with a detailed prompt combining the App's purpose and the user's aesthetic
4. Call finish_aigc

### For video requests:
1. Call record_demo_video (the interaction script is already prepared)
2. Call finish_aigc

### For style refinement (follow-up messages):
- If the user says "change the style", "make it darker", "try anime style" etc., call generate_poster again with updated prompt (the screenshot is already cached)
- Do NOT re-capture the screenshot unless the user explicitly asks

## Rules
- ALWAYS capture_screenshot before generate_poster on the first request
- NEVER fabricate or describe what the poster/video looks like in text — just call the tools and let the UI show the result
- Keep narration to ONE short sentence max (Chinese if user wrote in Chinese)
- The App screenshot is the ground truth — do not describe the App differently from what you see
- For video: the recording captures REAL App interactions — tell the user this is genuine, not simulated`;

export interface AigcSession {
  id: string;
  projectId: string;
  userId?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  events: Array<Record<string, unknown>>;
  nextEventId: number;
  done: boolean;
  sseWriters: Set<(line: string) => void>;
}

export const aigcSessions = new Map<string, AigcSession>();

// Clean up when map grows too large
setInterval(() => {
  if (aigcSessions.size > 100) {
    const oldest = [...aigcSessions.keys()].slice(0, 50);
    oldest.forEach((k) => aigcSessions.delete(k));
  }
}, 60_000 * 10);

function emitToSession(session: AigcSession, event: Record<string, unknown>) {
  const eventId = session.nextEventId++;
  const line = `id:${eventId}\ndata:${JSON.stringify(event)}\n\n`;
  session.events.push({ eventId, ...event });
  for (const writer of session.sseWriters) {
    try { writer(line); } catch {}
  }
}

export async function runAigcAgent(
  session: AigcSession,
  userMessage: string,
): Promise<void> {
  const emit = (event: Record<string, unknown>) => emitToSession(session, event);

  session.messages.push({ role: "user", content: userMessage });
  emit({ type: "user_message", content: userMessage });

  const toolCtx: AigcToolContext = {
    projectId: session.projectId,
    sessionId: session.id,
    emit,
  };
  const { schemas, handlers } = buildAigcTools(toolCtx);
  const { client, model } = getFastClient();

  let assistantText = "";

  const sseEmit = (event: Record<string, unknown>) => {
    if (event.type === "text_chunk") {
      assistantText += (event.chunk as string) ?? "";
    }
    emit(event);
  };

  await runAgentLoop(
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
      phase: "aigc",
    },
  );

  if (assistantText) {
    session.messages.push({ role: "assistant", content: assistantText });
  }

  emit({ type: "aigc_done" });
}
