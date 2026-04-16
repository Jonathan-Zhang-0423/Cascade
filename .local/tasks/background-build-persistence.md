# Background Build Persistence — Keep Building When Client Disconnects

## What & Why
Currently when the user closes the browser tab, switches away from the project, or loses network connection, the SSE connection drops and the server immediately sets `session.aborted = true`, causing the build agent to stop work. All progress in the current agent loop iteration is lost.

The user wants the build to continue running on the server even when they're not watching, and be able to reconnect and see the results when they come back — just like how Replit's agent continues working.

## Done Looks Like
- User clicks "Build Now", build starts streaming as before
- User closes the tab or switches away — build continues on the server
- User returns — UI reconnects, replays missed events, and shows current state
- Explicit "Stop" button still aborts the build (DELETE endpoint)
- If the build finishes while the user is away, the completed results (files, status) are shown on reconnect

## Out of Scope
- Persisting builds across server restarts (in-memory only is fine)
- Manager/plan mode streaming persistence (only build sessions)
- Multi-user / multi-device support

## Architecture

### Server Changes (server/routes.ts)

1. **Event buffer on session**: Add `events: Array<Record<string, unknown>>` to `BuildSessionState`. Each event gets an auto-incrementing `eventId`.

2. **Decouple SSE from build execution**: The `emit()` function writes to the buffer always. If an SSE response is connected, it also writes to the response. The build runs as a detached promise (not awaited by the HTTP handler).

3. **Don't abort on connection close**: Remove `res.on("close", () => { session.aborted = true; })`. Connection close only detaches the SSE writer from the session.

4. **New reconnect endpoint**: `GET /api/build-session/:sessionId/stream?lastEventId=N` — sends all buffered events after `lastEventId`, then switches to live SSE streaming for new events.

5. **New status endpoint**: `GET /api/build-session/:sessionId/status` — returns `{ active: boolean, eventCount: number, done: boolean }` so the client can check if a build is running without opening a stream.

6. **Session tracking**: Add `projectId` to `BuildSessionState` so the client can look up active sessions by project. Add `GET /api/build-session/active/:projectId` to find the active session for a project.

7. **Cleanup**: Keep the 30-minute expiry. After the build finishes (`done` event), keep the session for 5 minutes for reconnection, then clean up.

### Client Changes (client/src/components/ide/chat-panel.tsx + client/src/stores/ide-store.ts)

1. **Persist sessionId**: Store `activeBuildSessionId` in the IDE store (persisted to localStorage) so it survives page refreshes.

2. **Reconnect on mount**: When the ChatPanel mounts (or projectId changes), check `GET /api/build-session/active/:projectId`. If a build is active, reconnect via `GET /api/build-session/:sessionId/stream?lastEventId=0` to replay all events.

3. **Event replay**: The existing SSE event handler already processes events sequentially. Replayed events go through the same handler, rebuilding UI state (files, step statuses, action log, phases).

4. **Connection recovery**: If the SSE stream drops unexpectedly, auto-retry with the last received `eventId` to resume from where it left off.

## Tasks

### T1: Server — Event buffer and detached build execution
- Add `events` array and `eventId` counter to `BuildSessionState`
- Add `projectId` to `BuildSessionState`
- Modify `emit()` to always push to buffer with incrementing `eventId`
- Run `runBuildSession` as detached promise; initial POST returns immediately after setup
- Remove `res.on("close", () => { session.aborted = true; })` — connection close only detaches the writer
- Add `done` flag to session, set when build completes
- Keep session in memory for 5 min after completion for reconnection
- Files: `server/routes.ts`, `server/build-orchestrator.ts`

### T2: Server — Reconnect and status endpoints
- `GET /api/build-session/:sessionId/status` → `{ active, eventCount, done }`
- `GET /api/build-session/active/:projectId` → `{ sessionId, active, eventCount }` or 404
- `GET /api/build-session/:sessionId/stream?lastEventId=N` → replays buffered events after N, then switches to live SSE
- Support multiple simultaneous SSE connections per session (e.g., multiple tabs)
- Files: `server/routes.ts`

### T3: Client — Persist session ID and reconnect on mount
- Add `activeBuildSessionId` to IDE store (persisted)
- On ChatPanel mount / projectId change, call `/api/build-session/active/:projectId`
- If active build found, connect to stream endpoint with `lastEventId=0`
- Replay events through existing handler to rebuild UI state (files, step statuses, action log, phases)
- Set `isAiResponding`, `buildPhase`, etc. during replay
- Clear `activeBuildSessionId` when build completes or is stopped
- Files: `client/src/components/ide/chat-panel.tsx`, `client/src/stores/ide-store.ts`

### T4: Client — Auto-reconnect on stream drop
- If SSE stream drops unexpectedly (not user-initiated stop), auto-retry after 2s
- Track `lastReceivedEventId` to resume from correct position
- Show a brief "Reconnecting..." indicator if stream drops and rebuilds
- Max 5 retry attempts before showing error
- Files: `client/src/components/ide/chat-panel.tsx`

## Relevant Files
- `server/routes.ts` (build-session endpoint, lines 380-460)
- `server/build-orchestrator.ts` (BuildSessionState, runBuildSession)
- `client/src/components/ide/chat-panel.tsx` (handleExecutePlan, SSE handler, handleStopExecution)
- `client/src/stores/ide-store.ts` (IDE state persistence)

## Dependencies
- T2 depends on T1 (needs event buffer)
- T3 depends on T2 (needs reconnect endpoint)
- T4 depends on T3 (needs reconnect logic)
- T1 and T2 could be done together as server work
- T3 and T4 could be done together as client work
