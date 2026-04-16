---
title: Fix Build Mode state race condition
---
# Fix Build Mode State Race Condition

## What & Why
When the user clicks "Start Building" on a plan card, the Build Mode thinking stream and status indicators fail to appear because of a state race condition between Plan Mode chat (`handleManagerSend`) and Build Mode (`handleExecutePlan`). The Plan Mode cleanup unconditionally clears `isManagerResponding`, which stomps on the Build session's busy state before the server's first `step_starting` event arrives. Result: the user waits minutes seeing nothing, even though the server is actively working.

## Done looks like
- Clicking "Start Building" immediately shows the pulsing "Agent is thinking..." indicator — no gap, no flicker
- The thinking stream and narration appear smoothly once the AI provider starts responding (5-20s)
- No double build-session execution from manual click + auto-execute firing simultaneously
- Both streaming validation tests still pass (build-session-streaming 4/4, plan-mode-streaming 5/5)

## Out of scope
- Changing the AI provider latency (5-20s first-token wait is inherent)
- Redesigning the overall state management architecture
- Adding new UI components

## Tasks
1. **Set executingTaskIndex immediately** — In `handleExecutePlan`, set `setExecutingTaskIndex(0)` right after the plan null-check and before the fetch, so `isExecuting` is true from the very start, independent of `isManagerResponding`.

2. **Guard Plan Mode cleanup against active build sessions** — In `handleManagerSend`'s `finally` block, check whether a build session is in progress (via `buildSessionIdRef.current`) before clearing `isManagerResponding`. If a build is active, skip the clear.

3. **Prevent double execution** — Add a guard at the top of `handleExecutePlan` that returns early if `buildSessionIdRef.current` is already set (a build session is already running). This prevents the auto-execute effect and manual click from both firing.

4. **Remove redundant isManagerResponding usage from build path** — Since `isExecuting` is now set immediately, `handleExecutePlan` no longer needs `setManagerResponding(true)` to maintain the busy state. Remove it, keeping the two modes cleanly separated: `isManagerResponding` for Plan Mode only, `isExecuting` for Build Mode only.

5. **Run both streaming validation tests** to confirm no regressions.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:2165-2543`
- `client/src/components/ide/chat-panel.tsx:2651-3075`
- `client/src/components/ide/chat-panel.tsx:3136-3155`
- `client/src/components/ide/chat-panel.tsx:3224-3350`
- `client/src/stores/ide-store.ts`