# Fix Kimi K2.5 Live Thinking Display

## What & Why
Kimi K2.5 is selected as the AI provider during builds, but no grey "thinking" text ever appears in the NarrationBubble while the agent is working. The status bar shows "Agent is thinking…" and the pulsing blue dot is visible, but the reasoning content never streams into the chat.

Root cause confirmed: `agent-loop.ts` only sends the `thinking` activation parameter for Doubao models. Kimi K2.5 defaults to "fast mode" when no thinking parameter is provided, which means it never emits `delta.reasoning_content`. Without `reasoning_content`, no `thinking_token` SSE events are fired, so `flushThinkingToStore()` never has anything to write and `message.thinking` stays undefined forever.

The entire client-side display pipeline (NarrationBubble → flushThinkingToStore → SSE handler) is correct and works for any model that actually emits `reasoning_content`. The fix is entirely in the server-side agent-loop parameter.

## Done looks like
- During a Kimi K2.5 build, grey italic reasoning text streams into the step bubble in real time, directly below the pulsing "Thinking…" label.
- After the step finishes, the bubble collapses to a "(Thinking)" toggle that expands to show the full reasoning.
- Doubao behaviour is unchanged.
- No budget_tokens cap is imposed on Kimi (pass `budget_tokens: 0` or omit it to let the model self-regulate, since Kimi's token budget semantics differ from Doubao).

## Out of scope
- Changing the NarrationBubble rendering logic (already correct).
- Changing the client-side SSE handler (already correct).
- Altering Doubao thinking configuration (leave as-is).

## Tasks
1. **Enable Kimi thinking param** — In `agent-loop.ts`, extend the `thinkingParam` logic to also send `{ thinking: { type: "enabled" } }` when the active model contains "kimi". Keep Doubao's `budget_tokens: 8192` unchanged; for Kimi omit `budget_tokens` (pass only `type: "enabled"`) since Moonshot's API ignores or rejects unknown budget constraints.

2. **Add a brief console.log on the server** — Emit a one-line server log (e.g. `[agent-loop] thinking_token emitted, len=N`) on the first thinking_token per step so future debugging can confirm the chain end-to-end. Remove or gate it behind a debug flag after confirming.

## Relevant files
- `server/agent-loop.ts:60-100`
