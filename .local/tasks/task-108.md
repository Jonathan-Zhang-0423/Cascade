---
title: Live LLM Output Monitor Popup
---
# Live LLM Output Monitor Popup

## What & Why

Add a floating popup window that displays all LLM output in real time, giving users visibility into what every AI agent (Manager, Editor, Verifier, Communicator) is producing as it streams. Currently, LLM tokens are only visible inline within the chat panel and partially in action logs. A dedicated monitor window lets users see the raw stream — thinking tokens, narration tokens, action logs, and errors — across all active SSE connections, like a developer console for AI activity.

## Done looks like

- A button in the IDE toolbar (or tools dock) opens a floating popup/dialog window
- The popup shows a scrolling, auto-updating log of all LLM output as it arrives in real time
- Each entry is color-coded and labeled by type: thinking (dimmed/italic), narration (normal), action log (highlighted), errors (red), communicator tokens (distinct color)
- Each entry shows which agent/endpoint produced it (Manager, Editor, Verifier, Communicator, Vibe Chat)
- The popup can be opened and closed without interrupting any active AI session
- A clear button resets the log
- The log auto-scrolls to the bottom as new entries arrive, but pauses auto-scroll if the user scrolls up to review history
- The popup is non-modal (does not block interaction with the rest of the IDE)

## Out of scope

- Filtering by agent type or token type (can be added later)
- Exporting or saving the log to a file
- Modifying or replaying LLM requests from the monitor

## Tasks

1. **Create a global LLM event bus** — Add a lightweight pub/sub store (or extend ide-store) that all SSE stream handlers can publish events to. Each event includes: timestamp, source (manager/editor/verifier/communicator/vibe-chat), type (thinking_token, narration_token, action_log, error, etc.), and content string.

2. **Instrument all SSE stream readers** — In the chat panel's stream processing loops for manager-chat, build-session, communicator-chat, and vibe-chat, publish each received SSE event to the global event bus alongside existing processing logic.

3. **Build the LLM Monitor popup component** — A non-modal dialog/panel that subscribes to the event bus and renders entries in a virtualized scrolling list. Each entry is styled by type with a timestamp and source label. Include auto-scroll behavior that pauses when the user scrolls up.

4. **Add toggle button to IDE** — Add a button (e.g., in the tools dock or navbar) to open/close the monitor popup. Track open/closed state in the IDE store.

5. **Clear button and entry count** — Add a clear button inside the popup header and show the current entry count badge.

## Relevant files

- `client/src/components/ide/chat-panel.tsx:2229-2501,2793-3106`
- `client/src/stores/ide-store.ts`
- `client/src/components/ide/navbar.tsx`
- `client/src/components/ide/tools-dock.tsx`
- `client/src/components/ui/dialog.tsx`
- `server/routes.ts:440-728`
- `server/build-orchestrator.ts:204-343`