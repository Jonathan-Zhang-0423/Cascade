---
title: Fix AI agent streaming state lost on page reload
---
# AI Agent Streaming State Persistence

## What & Why
When the app preview reloads (due to Vite HMR reconnection, network hiccup, or server restart), the AI agent's in-progress thinking/narration stream is lost. The page goes white momentarily, and when it recovers, the agent's ongoing work disappears from the chat panel. This happens because streaming state (accumulated tokens, thinking text, narration progress) lives only in React component refs and is never persisted. The manager-chat planning stream also lacks reconnection support, unlike the build-session stream which has exponential backoff retry logic.

## Done looks like
- During AI agent planning (manager-chat) or building (build-session), if the page reloads or the connection drops, the agent's accumulated thinking/narration text is preserved and restored when the page recovers
- Manager-chat SSE stream reconnects automatically after a disconnect (similar to the existing build-session reconnection with exponential backoff)
- No more white screen flash causing loss of in-progress agent work
- The user can continue seeing the agent's progress after any transient connection issue

## Out of scope
- Changing the Vite HMR behavior or preventing all server restarts
- Offline-first or service worker caching
- Build-session reconnection improvements (already has retry logic)

## Tasks
1. **Persist in-flight streaming state** — Save accumulated thinking/narration tokens to the IDE store (which is already localStorage-persisted) during active SSE streams, so page reloads restore the last known streaming state.

2. **Add manager-chat reconnection** — Implement SSE reconnect with exponential backoff for the `/api/manager-chat` endpoint, matching the existing pattern used by build-session streaming. Track the last received event so the server can resume from the correct point.

3. **Server-side resume support for manager-chat** — Add a `lastEventId` parameter to the manager-chat SSE endpoint so reconnecting clients can receive events from where they left off (or at minimum, get a state snapshot of the current agent progress).

4. **Graceful page reload handling** — On Vite HMR reconnection or page visibility change, check for any active streaming session and restore the UI state (thinking indicator, accumulated text) rather than showing a blank/reset chat panel.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:2940-3440`
- `client/src/components/ide/chat-panel.tsx:4360-4400`
- `client/src/stores/ide-store.ts:430-465`
- `server/routes.ts:447-500`