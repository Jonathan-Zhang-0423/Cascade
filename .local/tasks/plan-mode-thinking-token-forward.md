# Forward Thinking Tokens in Plan Mode

## What & Why
In plan mode, the manager-chat SSE route uses a custom `emitRawToken` callback that only forwards `narration_token` events to the browser — `thinking_token` events are silently dropped. This means the agent's internal reasoning (from `delta.reasoning_content` on the LLM stream) is never shown to the user during plan mode, even though build mode already surfaces it correctly.

## Done looks like
- When the manager agent emits reasoning/thinking content during plan mode, it appears in the chat panel in real time, matching the same collapsible thinking block already shown in build mode.
- No change to the existing narration or plan-card flow.

## Out of scope
- Changing the thinking UI component (already exists and works in build mode).
- Any changes to build mode streaming.

## Tasks
1. **Forward `thinking_token` in the manager-chat emit callback** — Update `emitRawToken` in the `/api/manager-chat` route to also pass through `thinking_token` events (in addition to `narration_token` → `raw_token`), so they reach the SSE stream.
2. **Capture `thinking_token` in the plan mode frontend handler** — In `chat-panel.tsx`, update the `handleManagerSend` stream reader to listen for `thinking_token` events and accumulate/render them into the current manager message's `thinking` field, using the same pattern as the build mode handler.

## Relevant files
- `server/routes.ts:466-544`
- `client/src/components/ide/chat-panel.tsx:1706-1813`
- `server/agent-loop.ts:87-101`
