---
title: Fix manager-chat stream results lost when user is on another project
---
# Fix manager-chat stream results lost when user is on another project

## What & Why
When users switch between projects while the AI agent is actively responding, the manager-chat stream continues running in the background (by design — concurrent project work is supported). However, there are two bugs in how the completed stream results are handled when the user returns:

### Bug 1: Plan results lost ("AI thinking abort")
In `chat-panel.tsx` line 3261, the `manager_done` event handler has:
```javascript
if (!isCurrentProject) continue;
```
This skips the ENTIRE handler when the user is viewing another project. As a result:
- The plan is never parsed or saved to `managerMessages`
- `mgrSessionIdRef.current` is never cleared
- The streaming snapshot is never cleared
- `localStorage` session key is never removed

When the user switches back, the reconnection `useEffect` (line 5665) checks `if (mgrSessionIdRef.current) return` — and since the ref was never cleared, it **returns early without trying to reconnect or recover**. The plan is permanently lost.

### Bug 2: Duplicate conversation history  
Related to the state persistence timing during rapid project switches. When `loadProject(newId)` calls `persistState(current)` before loading the new project, the `managerMessages` array is saved at its current point. If the background stream then modifies the Zustand store (e.g. adding narration tokens before `isCurrentProject` blocks them), and the user switches back before the stream completes, `loadProject` restores the old persisted state, but the stream may have already partially mutated state. The `mgrSessionIdRef` being stale also means the reconnection path doesn't fire, leaving orphaned messages.

## Root Cause
The `manager_done` handler and several other event handlers (`plan_preparing`, `plan_ready`, `communicator_narration_starting`, `manager_error`) use `if (!isCurrentProject) continue` to skip ALL processing. This is correct for UI-only updates (live thinking/narration text), but WRONG for state persistence operations (saving the plan, clearing session refs, cleaning up snapshots).

## Done looks like
- When `manager_done` fires while the user is on another project, the plan is still parsed and saved to the correct project's persisted state (localStorage), and session refs/snapshots are cleaned up
- When the user switches back to the project, they see the completed plan in the conversation history
- No duplicate messages appear in the conversation
- Concurrent streams for different projects work independently without interfering with each other
- UI-only state (live thinking text, narration animations) still correctly only updates when the project is active

## Tasks

### T1: Fix `manager_done` to save results regardless of active project
Remove `if (!isCurrentProject) continue` from `manager_done`. Split the handler into two parts:
- **Always execute**: Parse the plan from `managerAccumulated`, save it to the project's persisted localStorage state, clear `mgrSessionIdRef.current`, clear streaming snapshot, remove localStorage session key, clear `mgrReconnectRetryRef`
- **Only if current project**: UI updates like `removeTypingBubble()`, `addManagerMessage()`, `setMgrPreparingPlan(false)`, live text clearing, `renameProject()`, `setManagerResponding(false)`

For the "not current project" case: persist the plan + messages directly to localStorage for the target `projectId` so when the user switches back, `loadProject` restores the complete state.

### T2: Fix other event handlers that incorrectly skip on `!isCurrentProject`
Review `plan_preparing`, `plan_ready`, `communicator_narration_starting`, `manager_error`, and `communicator_error` handlers. For each:
- `manager_error`: Should clear `mgrSessionIdRef`, snapshot, and localStorage session even when not current project
- `plan_preparing`, `plan_ready`, `communicator_narration_starting`: These are UI-only, `continue` is correct
- `communicator_error`: Currently only does UI update when current, which is fine

### T3: Fix reconnection useEffect to handle completed-but-not-saved sessions
In the reconnection `useEffect` (line 5663), handle the case where `mgrSessionIdRef.current` is set but the stream already completed:
- If `mgrSessionIdRef.current` is set, check whether the session is still active via the status API instead of returning early
- If the session is done, clear `mgrSessionIdRef.current` and load the persisted results

### T4: Add message deduplication guard
When `manager_done` saves the plan message (either to live state or persisted state), check if a plan message with the same content already exists in `managerMessages` to prevent duplicates. Use a simple check: skip `addManagerMessage` if the last assistant message already has the same `plan` object.

## Relevant files
- `client/src/components/ide/chat-panel.tsx` — lines 3260-3436 (manager_done + manager_error handlers), lines 5663-5755 (reconnection useEffect)
- `client/src/stores/ide-store.ts` — lines 639-754 (loadProject), persistState/getPersistedState functions