---
title: Integrate build results into message timeline
---
# Integrate build results into message timeline

## What & Why

After a build completes, the `ActionLogCollapsed` and `BuildCompletionCard` are rendered outside the message timeline (after all messages, lines 3355-3366). This means they permanently sit at the very bottom — any new messages the user sends or receives appear ABOVE them, making them invisible. The user expects new messages to appear below the build results, flowing naturally in chronological order.

The fix: when the build completes, convert the completed action log and build completion card into special manager messages that become part of the chronological timeline. Then new messages appear below them naturally.

## Done looks like

- After a build completes, the action log summary and completion card appear in the chat at the correct chronological position (where the build finished).
- When the user sends a new message or receives a new AI response, it appears below the build results.
- The visual appearance of the action log and completion card remains the same.
- Live action log (`ActionLogLive`) still renders at the bottom during active builds.

## Out of scope

- Changing the visual design of action log or completion card.
- Adding dismiss/close buttons.

## Tasks

1. Add new manager message roles/types: add a `buildResult` field to the manager message type that can hold `{ actionLog: ActionLogEntry[], completionData: { changedFiles, userLang, summary } }`.
2. When the build completes (in the `finally` block of `handleExecutePlan`, around line ~3087), instead of setting `setCompletedActionLog(finalLog)`, create a manager message with `buildResult` containing the action log and completion data. Clear `completedActionLog` and `buildCompletionData` state.
3. In the message rendering loop (the merged list around line ~3266), when encountering a manager message with `buildResult`, render `ActionLogCollapsed` and `BuildCompletionCard` inline instead of the normal message bubble.
4. Remove the standalone `completedActionLog` and `buildCompletionData` rendering blocks at lines 3355-3366 since they're now part of the message timeline.
5. Keep the live `ActionLogLive` rendering at the bottom (line 3350) — it's only shown during active builds and should stay there.
6. Handle the `buildCompletionData.summary` which arrives asynchronously via the communicator — the build-result message should update when the summary arrives.

## Relevant files

- `client/src/components/ide/chat-panel.tsx:2003-2004`
- `client/src/components/ide/chat-panel.tsx:3087-3098`
- `client/src/components/ide/chat-panel.tsx:3266-3343`
- `client/src/components/ide/chat-panel.tsx:3350-3366`
- `client/src/components/ide/chat-panel.tsx:2908-2970`