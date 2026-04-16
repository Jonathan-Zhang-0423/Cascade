# Build Mode Real-Time Output & Status Fixes

## What & Why

During a build session users see no real-time feedback:
1. The Stop button stays invisible until the *first* step's `step_starting` SSE event arrives (which can be 10–30+ seconds after clicking Execute with Kimi's thinking mode).
2. The status indicator ("Agent is thinking…") never appears because it requires `isExecuting && buildPhase` and `isExecuting` (`executingTaskIndex !== null`) is only set inside the SSE loop when `step_starting` fires.
3. With Kimi K2.5, Kimi's reasoning content streams into a `message.thinking` field that renders as a **collapsed** "(thinking…)" toggle — collapsed by default (`useState(false)`) — so the user sees only the bare step header and nothing else for potentially several minutes until Kimi calls its first tool.
4. The `request_review` tool emits no narration token, so the transition from "building" to "reviewing" phase is silent.

## Done looks like

- Clicking Execute immediately shows the red Stop button and the pulsing status indicator ("Agent is thinking…"), with no lag.
- When using Kimi K2.5, Kimi's reasoning text streams **visibly** into the chat in real time (thinking block expanded by default).
- Users can track the current step, files being written, and all tool actions as they happen.
- Stopping a build before the first `step_starting` event correctly cancels the session.
- The transition to "Agent is verifying…" is accompanied by a narration token in chat.

## Out of scope

- Adding new tools to the builder agent
- Changing the step header format
- Changing how the plan card renders

## Tasks

1. **Set busy state immediately on Execute** — At the very start of `handleExecutePlan` (before the `await fetch()`), call `setManagerResponding(true)` and `setBuildPhase("thinking")`. Change the status indicator condition from `isExecuting && buildPhase` to `(isBusy || isExecuting) && buildPhase`. Also update `handleStopExecution` to call `setManagerResponding(false)` so stopping before `step_starting` fully cleans up state.

2. **Expand the thinking block by default** — In `NarrationBubble`, change `const [thinkingOpen, setThinkingOpen] = useState(false)` to `useState(true)` so Kimi's reasoning text is visible immediately as it streams. Add a visual cue (e.g. a short "Thinking:" label prefix) to make it clear this is AI reasoning, not final output.

3. **Add narration token for `request_review` tool** — In `agent-tools.ts`, emit `{ type: "narration_token", token: "\nReviewing completed work…" }` inside the `request_review` handler before emitting the `reviewing` event. This fulfills rule 3 (tools being used) and gives the user a clear signal the review phase is starting.

## Relevant files

- `client/src/components/ide/chat-panel.tsx:2216-2290` (handleExecutePlan start)
- `client/src/components/ide/chat-panel.tsx:2513-2526` (handleStopExecution)
- `client/src/components/ide/chat-panel.tsx:1505-1534` (NarrationBubble)
- `client/src/components/ide/chat-panel.tsx:2759-2772` (status indicator condition)
- `server/agent-tools.ts:161-164` (request_review handler)
