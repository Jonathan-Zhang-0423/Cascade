# Fix: Build Mode Message Send Blocked

## What & Why
In Build Mode, when a `managerPlan` exists and execution hasn't started yet, pressing Send unconditionally discards the user's typed message and triggers plan execution. The user cannot send any conversational message — they're stuck, because any text they type gets silently cleared and the build starts instead.

Root cause in `handleCurrentSend` (chat-panel.tsx ~line 2457):
```js
if (chatMode === "build" && managerPlan && !isExecuting) {
  setInput("");           // message discarded
  handleExecutePlan();    // build starts, typed message is gone
  return;
}
```

## Done looks like
- In Build Mode with a plan ready, typing a message and pressing Send sends it as a chat message (not discarded)
- With an EMPTY input, pressing Send (or clicking the send button when input is blank) still triggers plan execution as before (the "start building" affordance)
- The placeholder text continues to read "start building" when no text is typed, but the textarea is fully functional for chat when the user types
- The sent message appears in the chat and gets a reply; the build doesn't start unintentionally

## Out of scope
- Changing the Plan Mode send behavior
- Redesigning the mode-toggle UI

## Tasks
1. **Fix `handleCurrentSend` guard condition** — Change the "execute plan on send" branch so it only fires when the input is empty (i.e., the user pressed Send with nothing typed, which is the "start building" gesture). When the input has text in Build Mode, route the message through the existing chat send path (`handleVibeSend`) instead of discarding it and starting the build.

2. **Verify stop-button / busy-state resets** — Confirm that `setExecutingTaskIndex(null)`, `setAiResponding(false)`, and `setManagerResponding(false)` are all called on every exit path (success, error, abort) of `handleExecutePlan` so that `isBusy` never gets permanently stuck and the Send button is always recoverable without a page refresh.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:2044-2046,2142-2358,2362-2436,2448-2467,2501,2644-2663`
