---
title: Fix Plan Mode context loss on follow-up messages
---
# Fix Plan Mode context loss on subsequent messages

## What & Why

When the user sends a second message in Plan Mode (e.g. "Please Create" after the manager already produced a plan), the manager AI responds as if it has never seen the conversation before — it loses all of its own prior conversational context.

**Root cause:** In `handleManagerSend`, the Plan Mode manager's own text responses are stored in `managerMessages` with `source: "communicator"`. The filter that builds the message history for each API call (line 1728 in chat-panel.tsx) excludes every assistant message where `source === "communicator"`:

```
.filter((m) => !m.typing && (m.role === "user" || m.plan || (m.role === "assistant" && m.source !== "communicator")))
```

This filter was written to strip out build-mode narration bubbles (added by `handleExecutePlan`) so they don't pollute the Plan Mode AI's context. But because the manager's OWN conversational responses use the same `source: "communicator"` tag, they are also stripped out. The API then receives only user messages and plan JSON — no assistant conversational context — so the AI starts fresh on every turn.

## Done looks like

- When the user sends a follow-up message in Plan Mode ("Please Create", "Make it smaller", "Add a login page"), the Plan Mode manager remembers the entire prior conversation and responds in context.
- Build-mode narration bubbles (added during `handleExecutePlan`) continue to be excluded from the Plan Mode AI payload as before.
- No visual change to the UI — messages display identically to before.

## Out of scope

- Changing what the Build Mode (Vibe) agent sees — it has a separate `chatMessages` array that is unaffected.
- Changing the UI rendering of any message types.

## Tasks

1. **Add `"manager"` as a source tag** — In `ide-store.ts`, extend the `source` union type on `ChatMessage` from `"communicator" | "manager_raw"` to `"communicator" | "manager_raw" | "manager"`.

2. **Tag manager conversational responses correctly** — In `handleManagerSend` (chat-panel.tsx), change the four places where the manager's own streaming text is stored with `source: "communicator"` to use `source: "manager"` instead. These are the message inserts/updates triggered by `raw_token` and `manager_token` SSE events. Leave all `communicator_token` event handlers and error message handlers unchanged (they stay as `source: "communicator"`).

## Relevant files

- `client/src/stores/ide-store.ts:1-50`
- `client/src/components/ide/chat-panel.tsx:1727-1732`
- `client/src/components/ide/chat-panel.tsx:1843-1860`
- `client/src/components/ide/chat-panel.tsx:1873-1900`