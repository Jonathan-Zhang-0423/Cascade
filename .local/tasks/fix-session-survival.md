# Fix Plan/Build Session Survival on Navigation

## What & Why
When a user navigates away from a project (to dashboard or another project) while a plan or build session is running, the server continues processing correctly — but the results are often lost when the user returns. Three root causes:

1. **Session pruning too aggressive**: Done sessions are deleted after only 5 minutes (server `setInterval` cleanup at `routes.ts:372`). If the user navigates away and returns after >5 min, the session events (including `plan_ready` with the completed plan) are gone. The client gets 404 on reconnect and the plan/build results are lost.

2. **Reconnect sets `isManagerResponding=true` synchronously, then does async checks**: The reconnect effect at `useManagerStream.ts:879-883` immediately sets `setManagerResponding(true)` when a snapshot exists, before verifying the session still exists. This blocks user interaction during the entire async status check round-trip.

3. **Completed plan/build results not persisted independently of session**: The plan result only exists inside the session's event buffer. Once the session is pruned, the plan is unrecoverable — even though the server successfully generated it. Similarly for build results: while file changes survive (written to DB), the plan card state, task statuses, and build completion data are lost.

## Done looks like
- User navigates away during planning → comes back 30 minutes later → plan is restored and visible in the chat
- User navigates away during build → comes back → build progress is shown, file changes are reflected, completion summary appears
- No "stuck" states after navigation — user can always type and send messages
- Server retains done sessions for at least 30 minutes instead of 5
- Completed plans are persisted to the project record in the database so they survive even after session pruning

## Out of scope
- Changing the SSE streaming protocol
- Adding WebSocket support
- Modifying the AI agent loop itself

## Tasks
1. **Increase done session retention to 30 minutes** — Change `doneRetention` from `5 * 60 * 1000` to `30 * 60 * 1000` for both `managerChatSessions` and `buildSessions` in the server cleanup interval. This gives users much more time to return.

2. **Persist completed plan to project record** — When `plan_ready` is emitted server-side, save the plan JSON to the project record in the database (add a `lastPlan` column or similar). On client reconnect, if the session is pruned, check the project record for a saved plan and restore it.

3. **Persist completed build results to project record** — When `all_complete` is emitted server-side, save the build completion data (changed files list, summary) to the project record. On client reconnect after session pruning, restore the build completion state from the DB.

4. **Use a separate `isReconnecting` flag instead of blocking `isManagerResponding` during reconnect** — The reconnect effect should set a dedicated `isMgrReconnecting` state (already exists as `isReconnecting` in build stream but not in manager stream). Don't set `isManagerResponding=true` during the status check phase. Only set it after confirming the session is actively streaming. This prevents blocking user sends during reconnect.

5. **Restore plan from localStorage on reconnect failure** — When reconnect fails (session pruned), check if `managerPlan` was already saved in the project's localStorage state (it IS saved during `persistState`). If it exists, restore it to the store and show the plan card. Currently `loadProject` at line 676 does derive `managerPlan` from `managerMessages`, but this should also handle the case where the plan was received while the user was away (written to localStorage by the `plan_ready` handler at lines 350-382 in `useManagerStream.ts`).

6. **Handle build file sync on return** — When reconnecting to a completed build session, after replaying events, trigger a fresh `fetchFilesFromServer` to ensure the IDE's file tree matches the server state. This catches any file changes applied by the build agent while the user was away.

## Relevant files
- `server/routes.ts:372-395`
- `server/routes.ts:685-928`
- `server/routes.ts:520-561`
- `client/src/components/ide/chat/hooks/useManagerStream.ts:860-1001`
- `client/src/components/ide/chat/hooks/useBuildStream.ts:1361-1478`
- `client/src/stores/ide-store.ts:640-720`
- `shared/schema.ts`
