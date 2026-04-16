---
title: Fix Build Mode Communicator not streaming live
---
# Build Mode Communicator Streaming Fix

## What & Why

During plan execution in Build Mode, the Communicator Agent narration is invisible to users even though tokens are technically being sent and processed. Three distinct root causes were confirmed through code investigation:

**Root Cause 1 — No typing bubble before first token**: The Doubao API has 5–18 seconds of latency before the first token arrives. During that window the build-session SSE is open but silent. Unlike Plan Mode (which shows a typing bubble while waiting), Build Mode shows nothing at all. The user assumes the Communicator is broken.

**Root Cause 2 — Silent API failures**: `callCommunicatorNarration` in `server/build-orchestrator.ts` (lines 84–107) wraps every Doubao API call in a bare `try/catch` with no logging. When the API fails (rate-limit, context-overflow, network error), the catch block emits only `communicator_done` and discards the error entirely. The client receives no tokens, adds no message, and shows no indication that a narration was attempted or failed.

**Root Cause 3 — Communicator messages are visually lost**: Narration messages are added to `managerMessages` as plain, unstyled text *below* the large TaskPlanCard. Users watching the step-status list in the plan card never look below it. Each narration window is brief (1–3 s) followed by 60–120 s of editor silence, so the text appears and disappears before most users notice.

(The per-token yield from Task #57 is in place and technically correct — token delivery is not the problem.)

## Done looks like

- A typing bubble (three animated dots) appears in the chat panel as soon as the build-session SSE opens, before the first communicator token arrives.
- The typing bubble transitions smoothly into the streaming text as tokens arrive, word-by-word, exactly as in Plan Mode.
- When `callCommunicatorNarration` catches an error, the error is logged server-side AND the client receives a `communicator_error` SSE event, which displays a brief inline error note in the chat panel instead of silence.
- Communicator messages during build execution are visually distinct — they carry a small "agent" icon or label so users understand who is speaking.
- A server-side probe test (`tests/build-session-streaming.ts`) verifies that at least one `communicator_token` event arrives within 25 s of opening a build-session SSE.

## Out of scope

- Redesigning the TaskPlanCard layout or moving narration inline with step rows.
- Changing the Doubao model, retry logic, or max_tokens limits.
- Changing how the editor or verifier agents stream (editor_token, etc.).

## Tasks

1. **Add typing bubble for communicator narration in build mode** — Before the first `communicator_token` arrives, insert a typing-bubble placeholder message into `managerMessages` (same pattern as `handleManagerSend`'s typing bubble). Replace it with real content when the first token arrives; remove it if a `communicator_error` event arrives instead. This eliminates the silent gap between "Execute" click and first narration word.

2. **Expose communicator failures as a visible SSE event** — In `callCommunicatorNarration`, log the caught error to the console and emit a `communicator_error` event (with a brief `message` field) instead of a silent `communicator_done`. In the client's build-session SSE handler, handle `communicator_error` by removing the typing bubble and (if in a visible context) displaying a brief inline "Communicator unavailable" note. This makes silent failures observable.

3. **Add visual identity to communicator messages** — Give communicator messages in `ManagerMessageBubble` a small robot/agent icon or "Agent" label prefix so they stand out from plain text in the message list. Users need to instantly recognise narration as distinct from user/manager messages.

4. **Write build-session communicator streaming test** — Create `tests/build-session-streaming.ts` (mirroring `tests/plan-mode-streaming.ts`) that opens a real build-session SSE against a test project and asserts: at least one `communicator_token` arrives within 25 s; at least 3 tokens received total; `done` event received within 120 s. Register it as a validation command.

## Relevant files

- `server/build-orchestrator.ts:84-107`
- `client/src/components/ide/chat-panel.tsx:2130-2275`
- `client/src/components/ide/chat-panel.tsx:1403-1487`
- `client/src/components/ide/chat-panel.tsx:1716-1724`
- `tests/plan-mode-streaming.ts`