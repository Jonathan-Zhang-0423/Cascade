---
title: Fix agent session persistence on project exit
---
# Fix Agent Session Persistence on Project Exit

## What & Why
When a user exits a project (navigates back to dashboard or switches projects) while the AI agent is actively running (planning or building), the session is disrupted. There are multiple bugs:

1. **Build session killed on exit**: The `useBuildStream` cleanup sends a `DELETE /api/build-session/:id` on unmount, which sets `session.aborted = true` on the server — killing the build even though it should continue in the background. The user loses all work in progress.
2. **Manager session not persisted before abort**: The `useManagerStream` cleanup nulls out `mgrSessionIdRef` before the streaming snapshot can be flushed to localStorage, so on re-entry the reconnection logic can't find the session.
3. **Editor stream has no cleanup**: `useEditorStream` has no `useEffect` cleanup — the AbortController is never called on unmount, leaving orphaned fetch connections.
4. **UI state stuck after failed reconnection**: If the server session expired before the user returns, `isManagerResponding` or `isAiResponding` can remain `true` indefinitely because the cleanup on unmount doesn't reset these store values.
5. **No text fallback on return**: When reconnecting to a manager session that already completed, if the final `manager_done` event's plan couldn't be parsed, the accumulated text response is lost.

## Done looks like
- User starts the agent (e.g. "帮我搭建一个计算器"), exits the project, returns — the agent work continues seamlessly
- Build sessions continue server-side when user exits; UI reconnects and replays missed events on return
- Manager sessions are reconnectable after project exit; session ID and snapshot are saved before cleanup
- No stuck "responding" states after returning to a project with an expired session
- Editor stream connections are properly closed on project exit

## Out of scope
- Changing the server-side session retention time (currently 5min done / 30min max)
- Adding persistent server-side storage for sessions (they remain in-memory)
- Mobile-specific session handling

## Tasks
1. **Fix build session cleanup** — Remove the DELETE call from the `useBuildStream` unmount cleanup so build sessions continue server-side. Only send DELETE when the user explicitly stops the build (via the stop button). Preserve the session ID in localStorage before clearing refs.

2. **Fix manager session cleanup** — In `useManagerStream` unmount cleanup, flush the current streaming snapshot to localStorage synchronously and preserve the session ID before aborting. Don't null out `mgrSessionIdRef` until after saving.

3. **Add editor stream cleanup** — Add a `useEffect` cleanup to `useEditorStream` (or wire it into ChatPanel's unmount) that aborts the active `AbortController` and resets `isAiResponding` if the editor stream was active.

4. **Fix UI state reset on reconnection failure** — When the reconnection `useEffect` in both `useManagerStream` and `useBuildStream` detects a dead/expired session, ensure `isManagerResponding`, `isAiResponding`, and `executingTaskIndex` are all reset to idle state. Also clear stale streaming snapshots.

5. **Verify reconnection flow end-to-end** — Test the full cycle: start agent → exit project → return → verify UI resumes or shows completion state correctly.

## Relevant files
- `client/src/components/ide/chat/hooks/useManagerStream.ts:62-79`
- `client/src/components/ide/chat/hooks/useManagerStream.ts:827-937`
- `client/src/components/ide/chat/hooks/useBuildStream.ts:57-87`
- `client/src/components/ide/chat/hooks/useBuildStream.ts:1347-1410`
- `client/src/components/ide/chat/hooks/useEditorStream.ts`
- `client/src/components/ide/chat-panel.tsx:179-185`
- `client/src/stores/ide-store.ts`
- `client/src/pages/ide.tsx:37-46`
- `server/routes.ts:603-608`