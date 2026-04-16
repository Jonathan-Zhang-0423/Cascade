---
title: Fix Build Mode execution bugs (ghost loading + failed step handling)
---
# Fix Build Mode Execution Bugs

## What & Why
Two separate bugs in the Build Mode agent execution loop make the system unreliable:

**Bug 1 — Ghost loading on old plan cards**: When executing the active plan, all previous plan cards from earlier tasks also flicker and show their steps as "running". This is because `taskStatuses` (a single global object keyed only by step number like `"1"`, `"2"`, `"3"`) is passed unconditionally to every `ManagerMessageBubble` in the merged timeline. Any prior plan card that has a step `"1"` will render it as `running` whenever the current plan's step 1 is active.

**Bug 2 — Failed steps silently skipped, verifier never triggered**: When the Editor Agent fails on a step (`executeSubTask` returns `false`), the step is marked `"failed"` but the loop immediately continues to the next step (no break). After the loop, if any step failed, the code does `if (!allBuilt) { return; }` — silently exiting without calling the verifier, without notifying the manager, and with no recovery path. The fix-cycle system is never invoked for build failures, only for post-build quality issues.

## Done looks like
- Old plan cards always show their steps in a neutral/complete state and are never affected by the currently executing plan's step statuses
- When any build step fails: the loop stops at that failure point (no wasted subsequent steps on a broken foundation), and the verifier is still called so the manager can generate a targeted fix plan via the normal fix-cycle flow
- Fix cycles trigger correctly after step failures, just as they do after holistic review failures

## Out of scope
- Changing the verifier agent prompt or fix-cycle logic itself
- Changing how `executeSubTask` determines success (that's a separate concern)
- Changing the max fix cycle count or any other execution policy

## Tasks

1. **Fix ghost loading on old plan cards** — In the merged timeline render in `ChatPanel`, change `taskStatuses={taskStatuses}` to `taskStatuses={isLastPlan ? taskStatuses : {}}`. Only the last (active) plan card should receive the live status map; all previous plan cards should receive an empty object so their steps always render as neutral.

2. **Fix failed steps not triggering the verifier** — In `handleExecutePlan`, after the main build loop: (a) when `!allBuilt` due to failures (not an abort), do NOT silently return — instead fall through to `performHolisticReview` so the verifier can assess what's broken. (b) optionally break out of the build loop when a step fails so subsequent steps don't run on a broken foundation (except in cases where steps are independent — a simple approach is to break on failure). This ensures the fix-cycle system activates for build failures the same way it does for holistic review failures.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:2288-2308` — merged timeline render, `taskStatuses` prop (Bug 1)
- `client/src/components/ide/chat-panel.tsx:1894-1951` — main build loop + `if (!allBuilt) return` (Bug 2)
- `client/src/components/ide/chat-panel.tsx:1959-2060` — holistic review + fix-cycle loop (reference)