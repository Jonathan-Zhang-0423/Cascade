# Build continues across project switches

## What & Why
When the user switches to a different project while a build is in progress, then switches back, the build has stopped. The root cause: the SSE event loop in `handleExecutePlan` (Build Mode) and `handleSendMessage` (Plan Mode) both guard their stream with `if (store.projectId !== projectId) { reader.cancel(); break; }`. This fires the moment the user navigates away, cancelling the SSE connection and causing the server to abort the session — so there is nothing to return to.

Since wouter reuses the same `IDEPage` component instance for all `/project/:id` routes, `ChatPanel` never unmounts between project switches. Its refs (`buildReaderRef`, `buildSessionIdRef`) survive the switch. This means we can keep the SSE reader alive and simply suppress Zustand state mutations while the user is on a different project, then resume them automatically when they switch back.

## Done looks like
- User starts a build on Project A, switches to Project B, switches back to Project A — the build is still running and completes normally
- While on Project B, no files, messages, or task-status updates from Project A's build leak into Project B's UI
- Same behaviour for Plan Mode (the communicator planning stream also survives project switches)
- Both streaming validation tests still pass after the change

## Out of scope
- Reconnecting to a build session that was cancelled before this fix (existing aborted sessions are not recoverable)
- Showing a "build continued while you were away" notification (nice-to-have, not required)
- Any changes to the server-side build orchestrator

## Tasks

1. **Remove the stream-cancellation guard in Build Mode.** In `handleExecutePlan`, delete the `reader.cancel(); break;` check at the top of the while loop. Instead, compute `const isCurrentProject = useIDEStore.getState().projectId === projectId` inside the for-loop after each event is parsed. Always run pure local bookkeeping (`finalizeEditor()`, `resetNarration()`, accumulator `+=` assignments) regardless of which project is active. After bookkeeping, add `if (!isCurrentProject) continue;` to skip all Zustand state mutations (file writes via `applyCodeBlock`, narration message updates, `updateTaskStatus`, `setExecutingTaskIndex`, `setReviewPhase`, `setHolisticReview`, `setFixCycle`, `setPendingConfirmation`, `addManagerMessage`, `build_error` messages). The `done` event must always set `streamDone = true` and break from the for-loop so the while loop terminates correctly, but should only call `addManagerMessage` / `setReviewPhase` when on the current project.

2. **Remove the stream-cancellation guard in Plan Mode.** In `handleSendMessage`, delete the `controller.abort(); break;` check at the top of the while loop. Apply the same `isCurrentProject` pattern inside the for-loop: accumulate `rawAccumulated`, `managerAccumulated`, `commAccumulated` always; skip all Zustand mutations (`useIDEStore.setState`, `addManagerMessage`, `renameProject`, `clearManagerPlan`, `setManagerPlan`, `updateTaskStatus`, `removeTypingBubble`, `setManagerResponding`) when not on the current project. The post-loop cleanup at lines 2041–2066 already guards itself with `if (useIDEStore.getState().projectId === projectId && ...)` so those blocks need no changes.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:1782-1795,2244-2270,2265-2390`
