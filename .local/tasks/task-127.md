---
title: Fix build reconnect blank output
---
# Fix Build Reconnect Blank Output

## What & Why
When a user switches to a project with an active build session, or when the page reloads and the client reconnects to a running build, the thinking and narration panels show nothing — just a "Reconnecting to build..." indicator with no visible content. The root cause is that the `connectToBuildStream` function in the chat panel only updates the build phase for replayed thinking/narration token events but does NOT call `setLiveThinkingText` or `setLiveNarrationText`. The server correctly replays all buffered events (including thinking and narration tokens marked with `replay: true`), but the client discards the content of these replayed tokens. This makes builds appear completely stuck/blank upon reconnection.

## Done looks like
- When a user switches to a project with an active build, the thinking and narration text from replayed events appears immediately in the UI — not blank
- When the page reloads during a build, the restored snapshot text is shown instantly, and then replayed tokens update the live display progressively
- New live tokens arriving after replay continue updating the display normally
- The action log and build phase indicators also reflect the replayed state accurately

## Out of scope
- Changing the server-side event buffering or replay logic (server already works correctly)
- Manager-chat reconnection (separate code path, already handles this differently)
- Optimizing replay speed for very large event counts

## Tasks
1. **Update replay event handling for thinking/narration tokens** — In the `connectToBuildStream` replay event processing block, accumulate replayed `thinking_token` text into `thinkingAccumulated` and replayed `narration_token` text into `commAccumulated`, then call `setLiveThinkingText` and `setLiveNarrationText` with the accumulated values so the UI reflects the replayed content.

2. **Ensure snapshot-seeded accumulators merge correctly with replay** — When the accumulators are pre-seeded from a stored snapshot (which happens on page reload), make sure replayed tokens from beyond the snapshot's `lastEventId` append correctly rather than duplicating or overwriting.

3. **Clear the "Reconnecting" indicator once replay completes and live events begin** — Verify that `isReconnecting` is set to false at the right point so the user sees the normal build indicator instead of the reconnecting state once live streaming resumes.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:4683-5400`
- `server/routes.ts:420-460`