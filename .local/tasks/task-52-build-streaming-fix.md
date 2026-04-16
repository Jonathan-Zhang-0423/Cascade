# Fix Live Streaming During Build Execution

## What & Why

When the user clicks "立即构建" (Build Now), the agent messages are not streamed live — they either appear all at once at the end, or appear garbled/partial. There are two compounding bugs causing this.

**Bug 1 (primary) — Concurrent communicator narrations in the orchestrator:**
In `server/build-orchestrator.ts`, every `callCommunicatorNarration` call is fire-and-forget (`callCommunicatorNarration(...).catch(() => {})`). This means the "build starting", "step N starting", and "step N complete" narrations all run **concurrently** with each other and with the editor. Their SSE tokens interleave in the single shared response stream.

On the frontend there is only ONE `commAccumulated` string and ONE `commInserted` flag. When two communicator streams interleave:
- Tokens from stream A and stream B both increment `commAccumulated` in an unpredictable order
- When stream A emits `communicator_done`, `finalizeComm()` resets `commInserted = false` AND `commAccumulated = ""` — wiping the in-flight state for stream B
- Stream B's subsequent tokens then create a NEW message starting from empty content
- The "update last message" logic picks the wrong message element

**Bug 2 (secondary) — Fragile "last message" targeting:**
The `communicator_token` update handler in `handleExecutePlan` always mutates `msgs[msgs.length - 1]`. This is only correct if no other message-creating event ever lands between two tokens of the same communicator stream. With concurrent streams, this assumption breaks. The fix is to track the message by stable index rather than "last element".

## Done looks like

- Clicking "立即构建" immediately starts streaming the communicator agent's narration in the chat panel, token by token, while the build runs
- Each phase (build starting → step N starting → step N complete → build complete → reviewing → review passed) produces a distinct, fully-streamed chat message
- No messages appear garbled or starting mid-sentence
- No messages batch-appear only at the end

## Out of scope

- Visual redesign of the build chat messages
- Changes to the editor token display (editor tokens are intentionally invisible)
- Changes to how the plan card or task status list renders

## Tasks

1. **Sequentialize all communicator narrations in the orchestrator** — In `server/build-orchestrator.ts`, replace every fire-and-forget `callCommunicatorNarration(...).catch(() => {})` with `await callCommunicatorNarration(...)` wrapped in try/catch. Apply to: `build_starting`, `step_starting` (before calling the editor), `step_completed` (after editor resolves), `build_complete`, `reviewing`, `review_passed`, `bugs_found`, `needs_input`, `fixing`, and `all_complete`. The narration for `step_starting` should come **before** `callEditor` begins, so the user sees the announcement before code starts streaming. The narration for `step_completed` comes **after** `callEditor` resolves.

2. **Fix communicator message index tracking in the frontend** — In the `handleExecutePlan` callback in `client/src/components/ide/chat-panel.tsx`, replace the `commInserted: boolean` pattern with `commMsgIndex: number` (initialized to -1). When the first `communicator_token` arrives: add a new message, then capture `useIDEStore.getState().managerMessages.length - 1` as `commMsgIndex`. For subsequent tokens: update the message AT `commMsgIndex` instead of `msgs[msgs.length - 1]`. On `communicator_done`: reset `commMsgIndex = -1` and `commAccumulated = ""`.

## Relevant files

- `server/build-orchestrator.ts`
- `client/src/components/ide/chat-panel.tsx:2014-2230`
