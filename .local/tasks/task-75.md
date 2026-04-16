---
title: Fix Build Mode live narration streaming
---
# Fix Build Mode Live Streaming

## What & Why
Build Mode narration messages all appear at once after the build finishes instead of streaming in real-time as each step executes. Root cause is two bugs:

1. **Server — missing heartbeat**: `/api/build-session` has no heartbeat interval. During 10–30 second gaps while the AI processes tool calls, no data is sent. The reverse proxy buffers the pending SSE events and flushes everything at once when the build finishes. `/api/manager-chat` (Plan Mode) already has a working 5-second heartbeat that keeps data flowing through the proxy continuously.

2. **Client — RAF can't run during synchronous processing**: When all buffered SSE events arrive in one `reader.read()` chunk, the `for` loop processes every event synchronously. `requestAnimationFrame` (RAF) never gets to fire during the loop — it only fires between `reader.read()` suspensions. React 18 batches all the Zustand state updates and renders them all at once at the very end. Plan Mode works because after every token update it does `await new Promise<void>(r => setTimeout(r, 0))` — an event-loop yield that lets React render each token before the next one is processed.

## Done looks like
- During a build, narration text for each step appears word-by-word in the chat panel as the AI writes it — identical to how Plan Mode already streams AI text live.
- Each step gets its own narration message that fills in progressively.
- No change in Plan Mode behavior (it already works correctly and should not be touched).

## Out of scope
- WebSocket migration
- Other SSE endpoints not related to build-session
- Any UI styling changes

## Tasks
1. **Add server-side heartbeat to `/api/build-session`** — Mirror the `setInterval` heartbeat from `/api/manager-chat`: every 2 seconds emit `: heartbeat\n\n` on the response socket. Clear the interval in the finally block. This keeps data flowing through the proxy during long AI processing gaps.

2. **Replace RAF narration with direct-update + yield in the client** — In `handleExecutePlan`, remove `narrationDirty`, `rafId`, `narrationRafLoop`, `startNarrationRAF`, and `stopNarrationRAF`. Simplify `flushNarrationToStore` to do a direct Zustand write without a dirty flag. For every `narration_token` event in the SSE for-loop, call `flushNarrationToStore()` immediately then `await new Promise<void>(r => setTimeout(r, 0))` — the same event-loop yield that Plan Mode already uses after every token. Update the `step_completed`, `step_failed`, `step_cancelled`, `reviewing`, and `done` handlers to call `flushNarrationToStore()` directly instead of `stopNarrationRAF()`. Update the finally block the same way.

## Relevant files
- `server/routes.ts:373-442`
- `server/routes.ts:452-614`
- `client/src/components/ide/chat-panel.tsx:2143-2380`