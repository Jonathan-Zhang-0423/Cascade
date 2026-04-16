---
title: Fix live thinking stream display in Build Mode
---
# Fix Live Thinking Stream in Build Mode

## What & Why

During Build Mode, the AI's thinking process (reasoning tokens from Kimi K2.5, Doubao, MiniMax, GLM) is not visually streaming in the chat panel. The server correctly emits `thinking_token` SSE events (confirmed by server logs showing `[agent-loop] first thinking_token from kimi-k2.5`), but the `ThinkingStream` component never becomes visible to the user.

Root cause analysis identified two issues:
1. **Premature clearing**: When the first `narration_token` arrives (line ~2865), it immediately calls `setLiveThinkingText("")`, which clears the thinking display. If thinking and narration tokens arrive in the same SSE chunk, React never gets a chance to render the thinking state.
2. **No minimum display duration**: Even when thinking tokens stream for 10-20 seconds, the transition from thinking → narration is instantaneous — the thinking text disappears without any visual acknowledgment.

## Done looks like

- During Build Mode, when the AI is reasoning, a live "Thinking" panel (gray italic text with Brain icon) streams in real-time in the action log area.
- The thinking text remains visible for at least 300-500ms after the last thinking token, ensuring smooth visual transitions even when narration tokens follow immediately.
- Between agent loop iterations (iteration 1 → iteration 2), thinking from each iteration is properly displayed live then collapsed.
- The `ThinkingStream` component auto-scrolls as new thinking tokens arrive.
- Existing plan-mode thinking behavior is unchanged.

## Out of scope

- Changing the ThinkingStream or CollapsedThinking component visual design.
- Modifying server-side thinking token emission logic.
- Changing how thinking is stored in manager messages.

## Tasks

1. Add a minimum display duration for `liveThinkingText` — when `narration_token` arrives, delay clearing `liveThinkingText` by ~400ms so the thinking text remains visible briefly before transitioning. Use a ref-based timer pattern to avoid stale closures.
2. In the `narration_token` handler (line ~2865), instead of immediately calling `setLiveThinkingText("")`, set a "thinking fade" timer. If new thinking tokens arrive (next iteration), cancel the timer and keep showing thinking.
3. In the `action_log` handler (line ~2853), when collapsing thinking into a `CollapsedThinking` entry, also use the delayed clear to avoid visual flicker.
4. Ensure the `step_starting` handler still immediately clears thinking (it's starting a new step, so instant clearing is correct).
5. Add a `console.log` breadcrumb in the `thinking_token` handler (dev-only) to aid future debugging: log the first thinking token received per step so we can confirm client-side receipt in browser console.
6. Verify with both streaming tests (`build-session-streaming` and `plan-mode-streaming`) that the changes don't break existing behavior.

## Relevant files

- `client/src/components/ide/chat-panel.tsx:2839-2870`
- `client/src/components/ide/chat-panel.tsx:90-113`
- `client/src/components/ide/chat-panel.tsx:141-169`
- `client/src/components/ide/chat-panel.tsx:3326-3330`
- `server/agent-loop.ts:107-135`
- `server/build-orchestrator.ts:189-203`