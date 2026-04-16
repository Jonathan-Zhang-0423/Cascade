# Fix Manager Mode Output to Match Agent-Style Live Activity

## What & Why
The manager mode output should behave like a real coding agent — showing live thinking text, tool call actions, and narration in a structured activity log, just like build mode already does with `ActionLogLive`. Currently, manager mode dumps raw CoT text into a plain text bubble that ends abruptly, and shows a redundant "Reasoning…" label alongside the existing "规划中..." indicator.

## Done looks like
- During manager streaming, users see an `ActionLogLive`-style panel showing:
  - Live `ThinkingStream` when thinking tokens arrive (the existing build-mode component)
  - Narration text for `raw_token` content
  - Action log entries for tool calls (e.g., `submit_plan`)
- The "Reasoning…" pulsing dot label in `NarrationBubble` is removed (the `ThinkingStream` in the live panel handles this)
- After the agent finishes, the communicator narration streams in, then the plan card appears cleanly
- When the manager responds with plain text (no `submit_plan`), the text still shows correctly

## Out of scope
- Adding new tools to the manager agent (currently only has `submit_plan`)
- Changing build mode streaming behavior
- Changing the "规划中..." bottom indicator

## Tasks
1. **Server: Forward `action_log` events from manager agent loop** — Update `emitRawToken` in `server/routes.ts` to also forward `action_log` type events (they are already emitted by `runAgentLoop` at line 186 but dropped by the filter at line 544-549). Add `action_log` as a new event type in `KNOWN_MGR_EVENT_TYPES`.

2. **Client: Show ActionLogLive during manager streaming** — During the manager SSE stream, accumulate thinking text (`thinking_token`), narration text (`raw_token`), and action log entries (`action_log`) into state, and render them using the existing `ActionLogLive` component (or a similar panel) in the manager message area. Replace the current approach of creating a visible text bubble from `raw_token` events. Keep the text accumulation in `managerAccumulated` for the `manager_done` fallback path, but don't create separate NarrationBubble text messages during streaming.

3. **Client: Clean transition from live panel to plan card** — When `plan_preparing` fires, transition the live panel to show "Preparing plan…" state. When `plan_ready` fires, remove the live panel and render the plan card. When `manager_done` fires without a plan, convert the accumulated text into a final NarrationBubble message.

4. **Remove "Reasoning…" label from NarrationBubble** — Remove the live thinking display (pulsing dot + "Reasoning…" + thinking text block) from `NarrationBubble` for typing messages. The `ThinkingStream` in the `ActionLogLive` panel handles this now. Keep the `ThinkingToggle` for completed (non-typing) messages.

## Relevant files
- `server/routes.ts:544-550`
- `client/src/components/ide/chat-panel.tsx:15-22`
- `client/src/components/ide/chat-panel.tsx:88-211`
- `client/src/components/ide/chat-panel.tsx:1949-1998`
- `client/src/components/ide/chat-panel.tsx:2067-2069`
- `client/src/components/ide/chat-panel.tsx:2325-2414`
- `client/src/components/ide/chat-panel.tsx:2488-2560`
- `client/src/components/ide/chat-panel.tsx:3546-3553`
