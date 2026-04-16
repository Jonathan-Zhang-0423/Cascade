---
title: Fix SSE buffering — nginx X-Accel-Buffering header
---
# Fix SSE Buffering — Add X-Accel-Buffering Header

## What & Why

**Every streaming endpoint in the app delivers responses all-at-once instead of live.**
The server logs prove it: every `/api/manager-chat` call shows a single
`200 in 16225ms` / `200 in 48154ms` log line at completion — if streaming were
working, tokens would flow continuously over that time window.

**Root cause: Replit's nginx reverse proxy buffers every SSE response.**
Replit puts an nginx proxy in front of all Node.js processes. By default nginx
buffers proxied responses in its own 16 KB buffer, releasing data to the client
only when the buffer fills or the connection closes. Since AI tokens are 1–3 bytes
each, the buffer never fills mid-response; nginx holds everything until the AI call
finishes, then delivers the entire response in one shot.

**The nginx fix header `X-Accel-Buffering: no` is missing from every SSE endpoint.**
When this header is present nginx disables buffering for that response and passes
each `res.write()` chunk straight through to the client in real time.

**Additionally, Node.js's TCP Nagle algorithm is not disabled.**
Nagle coalesces small TCP segments. For SSE tokens (1–3 bytes), this can add
up to 200 ms of artificial latency per batch. `socket.setNoDelay(true)` disables it.

## Done looks like

- Chat messages in plan mode (manager chat) appear word-by-word in real time,
  starting within 1–2 seconds of sending
- Build mode narrations stream live during each build phase (build starting, step
  starting, step completed, etc.)
- The vibe chat assistant also streams live
- No responses ever batch-appear at the end after a long silence

## Out of scope

- Changes to AI model, prompt, or orchestration logic
- UI changes

## Tasks

1. **Add `X-Accel-Buffering: no` and `socket.setNoDelay(true)` to all four SSE
   endpoints** — In `server/routes.ts`, immediately after each `res.flushHeaders()`
   call, add `res.setHeader("X-Accel-Buffering", "no")` (must be set before
   flushHeaders, or use a socket-level approach) and
   `res.socket?.setNoDelay(true)`. The four affected endpoints are:
   `/api/build-session`, `/api/manager-chat`, `/api/communicator-chat`,
   `/api/chat`. The header must appear in the `setHeader` block before
   `res.flushHeaders()` — setting it after the headers are flushed has no effect.

## Relevant files

- `server/routes.ts:335-338` — /api/build-session SSE headers
- `server/routes.ts:404-407` — /api/manager-chat SSE headers
- `server/routes.ts:597-600` — /api/communicator-chat SSE headers
- `server/routes.ts:812-815` — /api/chat SSE headers