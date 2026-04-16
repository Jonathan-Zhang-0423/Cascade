---
title: Fix streaming invisibility — yield between SSE token renders
---
---
title: Fix streaming invisibility — yield between SSE token updates so React renders
---

# Fix streaming invisibility in manager-chat and communicator SSE loop

## Root Cause (confirmed by reading chat-panel.tsx lines 1760-1850)

The SSE reading loop in `sendManagerMessage` calls `reader.read()` which returns a
**chunk** of bytes. That chunk may contain dozens of `raw_token` or `communicator_token`
SSE events coalesced into a single TCP packet. The inner `for (const line of lines)`
loop processes them all **synchronously**, calling `useIDEStore.setState()` repeatedly.
React 18 (automatic batching) merges all those setState calls into **one render** that
happens only after the synchronous block finishes.

Result: 100 tokens → 100 state updates → **1 render at the end**. Text appears all at
once instead of streaming progressively.

## Solution — frame-rate-limited yield inside the for loop

In `client/src/components/ide/chat-panel.tsx`, inside the SSE `for (const line of
lines)` loop (around line 1768), add a **frame-rate-limited yield** after each update
that actually changes the displayed content:

```typescript
// At the top of sendManagerMessage, before the while loop:
let lastYieldMs = 0;

// Inside the for loop, after any setState that changes displayed content:
const now = Date.now();
if (now - lastYieldMs >= 16) {          // yield at most once per ~60fps frame
  lastYieldMs = now;
  await new Promise<void>(r => setTimeout(r, 0));
}
```

Apply the yield in **two places**:
1. **`raw_token` handler** — after the `useIDEStore.setState({ managerMessages: updated })`
   call that updates the streaming message bubble (the block under `if (newChars)`)
2. **`communicator_token` handler** — after the setState call that updates the
   communicator narration bubble

The 16ms threshold caps render overhead at 60fps. When many tokens arrive in one TCP
packet, the for loop now suspends and lets React render after each ~16ms batch of
tokens. The user sees smooth progressive text.

## Files to change

- `client/src/components/ide/chat-panel.tsx`
  - Add `let lastYieldMs = 0;` before the `while (true)` loop (~line 1760)
  - In the `raw_token` handler: add yield after the `newChars` setState (~line 1810-1830)
  - In the `communicator_token` handler: add yield after its setState (~line 1855-1880)

## Done looks like

- User sends a message in plan mode
- Typing indicator appears immediately
- When AI reaches the content field in its JSON (~5-10s), text starts appearing
  **word-by-word** visibly rather than all at once
- Communicator narration text also streams word-by-word after the plan appears
- No regression: plan cards, typing bubbles, final cleanup all work as before
- The validation test (`tests/plan-mode-streaming.ts`) still passes