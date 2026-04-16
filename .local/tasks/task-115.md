# Show Manager Live Activity Log (Replit Agent Style)

## What & Why
During manager mode streaming, the user currently only sees a static "规划中..." indicator. This gives no feedback about what the agent is actually doing. Like Replit agent, we should show a live activity panel with the agent's thinking process and actions — the same ActionLogLive component already used in build mode, populated with manager streaming events.

Reference: The attached screenshot shows Replit agent's output style — narration text at the top, then a list of activity entries: file opens (book icon), thinking blocks (brain icon with duration), and terminal commands (terminal icon), all in a collapsible "Show less/more" section.

## Done looks like
- During manager streaming, users see a live ActionLogLive panel below the chat messages showing:
  - ThinkingStream (brain icon + streaming thinking text) from `thinking_token` events
  - Narration text from `raw_token`/`manager_token` events (the model's output text)
  - Action log entries from `action_log` events (e.g., the submit_plan tool call)
- When `plan_preparing` fires, the live panel switches to a "Preparing plan…" spinner
- When communicator narration starts, the preparing spinner clears
- When the plan card appears or manager_done fires, the live panel is fully cleared
- Text-only replies (no submit_plan) still work via the existing manager_done fallback
- Stop button and error paths properly clear all live state

## Out of scope
- Build mode streaming changes (already working correctly)
- Changes to the communicator narration streaming (already working)
- Changes to ActionLogLive or ThinkingStream component internals (reuse as-is)

## Tasks
1. **Server: Re-enable action_log forwarding for manager** — In the manager chat route's `emitRawToken` callback, forward `action_log` events from the agent loop to the SSE stream (alongside the existing `narration_token` and `thinking_token` forwarding).

2. **Client: Add manager live state variables** — Add 3 state variables (`mgrLiveThinkingText`, `mgrLiveNarrationText`, `mgrLiveActionLog`) to track live manager activity. Keep the existing `mgrPreparingPlan` state.

3. **Client: Update SSE handlers to populate live state** — `thinking_token` should accumulate AND update `mgrLiveThinkingText`. `raw_token`/`manager_token` should accumulate AND update `mgrLiveNarrationText`. `action_log` should append to `mgrLiveActionLog`. `plan_preparing` should clear thinking/narration and set preparing flag. `communicator_narration_starting` should clear preparing flag. `plan_ready` and `manager_done` should clear all live state.

4. **Client: Render ActionLogLive during manager streaming** — When `isManagerResponding` is true and there is live content, show the existing `ActionLogLive` component in a bordered panel. When preparing plan, show the spinner instead. Fall back to "规划中..." TypingIndicator only when no live content is available yet.

5. **Client: Clean up live state on all exit paths** — Clear all manager live state on `plan_ready`, `manager_done`, the finally block, and the stop handler.

## Relevant files
- `server/routes.ts:544-553`
- `client/src/components/ide/chat-panel.tsx:132-211`
- `client/src/components/ide/chat-panel.tsx:2030-2040`
- `client/src/components/ide/chat-panel.tsx:2288-2300`
- `client/src/components/ide/chat-panel.tsx:2297-2340`
- `client/src/components/ide/chat-panel.tsx:2384-2430`
- `client/src/components/ide/chat-panel.tsx:2502-2511`
- `client/src/components/ide/chat-panel.tsx:3220-3230`
- `client/src/components/ide/chat-panel.tsx:3422-3436`
