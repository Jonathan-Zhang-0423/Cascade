---
title: Fix manager-chat (planning) session reconnection on project return
---
# Fix manager-chat (planning) session reconnection on project return

## What & Why
When the user leaves a project while planning is in progress and returns later, the planning appears to have "stopped abruptly" — the user sees a blank state instead of the completed (or still-running) plan. This happens because the client-side reconnection logic in `useManagerStream.ts` discards completed sessions: it only reconnects when `data?.active === true`, but throws away everything when the session has completed (`active: false`). The user never sees the plan that was generated while they were away.

A secondary gap: if the saved session ID returns 404 (expired from server memory), there's no fallback to `GET /api/manager-chat/active/:projectId` — unlike the build reconnection which was fixed in Task #134.

## Done looks like
- User starts a planning session, navigates away, and returns to find the completed plan displayed (or the still-running planning session resumed)
- If the saved session ID has expired from server memory, the client falls back to checking the active-project endpoint before giving up
- No regressions in the normal planning flow or build session reconnection

## Out of scope
- Server-side changes (the server already buffers events and has the correct active/:projectId endpoint)
- Build session reconnection (already fixed in Task #134)
- Changing thinking budget, model selection, or SSE architecture

## Tasks

1. **Fix completed-session handling in reconnect useEffect** — In `useManagerStream.ts` reconnection useEffect (~line 894), when `data?.active === false` but `data?.done === true`, connect to the stream endpoint to replay buffered events (including `plan_ready`, `manager_done`) instead of clearing the snapshot and resetting UI. Only clear/reset when the session is truly gone (404).

2. **Add 404 fallback to active/:projectId** — When the saved session status fetch returns 404/null (session expired from server memory), fall through to `GET /api/manager-chat/active/${projectId}` before giving up. If that returns a session (active or done), reconnect to it. Same pattern used for build sessions in Task #134.

3. **Handle done session replay in connectToMgrStream** — Verify that `connectToMgrStream` correctly processes the full event replay from a completed session. The stream endpoint replays all buffered events from `lastEventId: -1`, including `plan_ready` and `manager_done`. Ensure the `onEvent` handler in `parseSseStream` properly handles these events during replay (sets the plan, shows the result, marks `managerResponding: false`).

## Relevant files
- `client/src/components/ide/chat/hooks/useManagerStream.ts:859-969`
- `client/src/components/ide/chat/hooks/useManagerStream.ts:667-756`
- `server/routes.ts:611-638`
- `server/routes.ts:641-660`