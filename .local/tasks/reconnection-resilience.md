# Resilient Build Stream Reconnection

## What & Why
The build stream (SSE connection between browser and server) drops periodically due to proxy timeouts. The current reconnection mechanism has several problems that cause the user to see "Reconnecting to build..." with no visible output, even though the build is actively running server-side with hundreds of buffered events.

Root causes identified:
1. **Fixed retry timing** — Retries use a flat 2-second delay with only 5 attempts. On repeated drops, all retries are exhausted in ~10 seconds.
2. **Replay doesn't restore UI state** — When reconnecting, replay events for `step_starting` don't call `setBuildPhase("thinking")`, so the status indicator (thinking/working/verifying) doesn't re-appear. Token events (`thinking_token`, `narration_token`, `editor_token`) are skipped during replay entirely, so the UI shows nothing until a brand-new live event arrives.
3. **No session-alive preflight** — The client blindly reconnects to the stream endpoint without first verifying the session is still active, wasting retries on dead sessions.
4. **No client-side heartbeat detection** — The server sends heartbeat comments every 2 seconds, but the client never monitors them. If the connection goes stale (no data + no heartbeats), the client waits until the OS-level TCP timeout fires, which can take 30-60 seconds of silence before reconnecting.
5. **Duplicate reconnection logic** — There are two nearly identical catch/finally blocks for handling stream errors: one in the initial POST handler and one in `connectToBuildStream`. These should share the same retry strategy.

## Done looks like
- When the connection drops mid-build, the user sees the "Reconnecting" indicator briefly, then the live output resumes smoothly within a few seconds.
- After reconnection, the status indicator (thinking/working/verifying) correctly reflects the current build phase.
- If no events or heartbeats arrive for 10+ seconds on an open connection, the client proactively reconnects instead of waiting for a TCP timeout.
- The retry strategy uses exponential backoff (1s → 2s → 4s → 8s → ...) with up to 10 retries, surviving longer outage windows.
- Dead sessions are detected quickly: a preflight check to `/api/build-session/:id/status` prevents wasting retries on sessions that have already completed or been cleaned up.

## Out of scope
- Changing the SSE protocol or switching to WebSockets
- Server-side keep-alive or proxy tuning (already optimized with X-Accel-Buffering: no)
- Changes to event buffering or replay on the server side

## Tasks
1. **Exponential backoff with more retries** — Replace the flat 2s × 5 retry strategy with exponential backoff (starting at 1s, capped at 16s) and increase max retries to 10. Apply to both the initial POST stream handler and `connectToBuildStream`. Reset retry counter on successful reconnection (already done).

2. **Restore UI state during replay** — During replay event processing, set `setBuildPhase` appropriately: `step_starting` → "thinking", detect the last phase-relevant event in the replay batch to set the correct final phase (working/verifying/fixing). After replay_boundary, ensure the status indicator reflects the current state.

3. **Session-alive preflight** — Before each reconnect attempt, call `/api/build-session/:id/status`. If the session is done or not found, skip reconnection, clean up state, and show the final build result. If active, proceed with the stream reconnect.

4. **Client-side heartbeat watchdog** — Add a timer that resets on every received chunk (data or heartbeat). If 15 seconds pass with no data, abort the current reader and trigger reconnect. This catches stale connections that TCP hasn't killed yet.

5. **Extract shared retry logic** — Deduplicate the retry/catch/finally patterns between the initial POST handler and `connectToBuildStream` into a shared helper or at minimum align the two implementations so they use the same backoff parameters, preflight checks, and heartbeat watchdog.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:4326-4465`
- `client/src/components/ide/chat-panel.tsx:4493-5137`
- `client/src/components/ide/chat-panel.tsx:4678-4774`
- `client/src/components/ide/chat-panel.tsx:5045-5118`
- `client/src/components/ide/chat-panel.tsx:5141-5209`
- `server/routes.ts:385-438`
- `server/routes.ts:566-573`
