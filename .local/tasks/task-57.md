---
title: Fix cross-project message leak + word-by-word streaming
---
---
title: Fix cross-project message leak + word-by-word streaming in plan & build mode
---

# Three bugs, one file: client/src/components/ide/chat-panel.tsx

## Bug 1 — Cross-project message contamination

**Root cause:** When the user switches projects while an SSE response is in flight,
the ongoing `while(true)` read loop doesn't know the project changed. Every
`setState` call it makes writes into the store that is now loaded with a different
project, injecting AI messages from project A into project B.

**Fix:** At the top of each SSE while-loop iteration, before processing the chunk,
bail out if the project has changed:

```typescript
// manager-chat loop (~line 1762), build-session loop (~line 2209)
if (useIDEStore.getState().projectId !== projectId) break;
```

`projectId` is the local variable captured at the start of the handler function
(from `useIDEStore.getState().projectId` or from the component closure). This is
a one-liner in two places.

---

## Bug 2 — Plan mode streaming appears in large chunks, not word-by-word

**Root cause:** Task #55 added a `Date.now() - lastYieldMs >= 16` rate-limited
yield. But when TCP delivers 100 tokens in one packet, all 100 are processed
synchronously in <1ms of CPU time. `Date.now()` barely changes, so the condition
passes only once per packet — one React render for all 100 tokens.

**Fix:** Remove `lastYieldMs` entirely. After every token that produces new
displayable characters, suspend immediately with no rate limit:

```typescript
// Replace the gated yield block with just:
await new Promise<void>(r => setTimeout(r, 0));
```

Apply in these places inside `handleManagerSend`:
1. `raw_token` handler — inside `if (newChars) { ... }` after the setState
2. `manager_token` handler — after its setState block
3. `communicator_token` handler (manager-chat) — after its setState block

Also apply to `handleVibeSend`'s `/api/chat` SSE loop (line ~2108):
```typescript
// after: updateLastAssistantMessage(...)
await new Promise<void>(r => setTimeout(r, 0));
```

Delete the now-unused `let lastYieldMs = 0;` variable.

---

## Bug 3 — Build mode communicator narration not streaming

**Root cause:** The build-session SSE loop's `communicator_token` handler
(~line 2270) calls `setState` in a tight for-loop with no yield. Same
TCP-coalescing problem as Bug 2.

**Fix:** Add the same immediate yield after the communicator setState in
`handleExecutePlan`'s build-session SSE loop:

```typescript
} else if (type === "communicator_token") {
  commAccumulated += ev.token;
  // ... existing setState logic ...
  await new Promise<void>(r => setTimeout(r, 0));   // ← add this
}
```

---

## Files to change

- `client/src/components/ide/chat-panel.tsx` only
  - ~line 1762: add projectId guard in manager-chat while-loop
  - ~line 1763 (lastYieldMs): delete the variable
  - ~line 1851: replace gated yield with unconditional yield in raw_token handler
  - ~line 1885: replace gated yield with unconditional yield in manager_token handler
  - ~line 1955: replace gated yield with unconditional yield in communicator_token (manager)
  - ~line 2108: add yield in handleVibeSend SSE for-loop
  - ~line 2209: add projectId guard in build-session while-loop
  - ~line 2280: add yield in communicator_token handler inside build-session loop

## Done looks like

- Switching projects mid-response immediately stops the old project's messages from
  appearing in the new project
- In plan mode: conversational stage 1/2 responses stream word-by-word as the AI
  generates each token — visibly letter-by-letter / word-by-word
- Communicator narration after a plan also streams word-by-word
- In build mode: communicator narration between build steps streams word-by-word
- Vibe chat (build mode direct chat) also streams word-by-word
- Validation test `tests/plan-mode-streaming.ts` still passes