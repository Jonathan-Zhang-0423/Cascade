# Fix Manager Agent Thinking/Output Gap & Thinking Text Loss

## What & Why

When the manager agent generates a plan via `submit_plan` tool call, users see only the "Reasoning..." thinking text during streaming, followed by a dead gap where nothing is displayed, and then the plan card appears. This creates confusion because:

1. **No content feedback during tool call streaming**: The plan JSON is generated via `delta.tool_calls` in the agent loop, which emits NO `raw_token` events — so the client has nothing to display between thinking and the plan card.
2. **Dead gap after thinking**: After thinking tokens stop, the typing bubble stalls with the pulsing dot. The server is processing the tool call + making a second LLM call (communicator narration) — no feedback to the user.
3. **Thinking text permanently lost**: When `plan_ready` fires, `removeTypingBubble()` deletes the typing bubble (which holds the accumulated `thinking` field). The new plan card message `{ role: "assistant", content: "", plan }` does NOT carry over the thinking. Same issue in `manager_done` JSON plan path.

## Done looks like

- After reasoning completes and the plan is being prepared, users see a clear visual transition (e.g., "Preparing plan..." with a different indicator) instead of stale "Reasoning..." text.
- The plan card message preserves the manager's thinking text so users can see the AI's reasoning by clicking a collapsible "(Thinking)" toggle on the plan card.
- Communicator narration messages also preserve any thinking text that was accumulated on the typing bubble they replace.

## Out of scope

- Changes to the manager prompt or AI model behavior.
- Changes to the agent-loop tool call streaming architecture.
- Changes to the build-session (non-manager) streaming.

## Tasks

1. **Server: Emit `plan_preparing` event** — In `server/routes.ts`, after the `runAgentLoop` call returns with `exitTool === "submit_plan"` and before the communicator LLM call starts, emit `{ type: "plan_preparing" }` so the client knows thinking is done and plan processing has begun.

2. **Client: Handle `plan_preparing` event** — In `chat-panel.tsx` handleManagerSend SSE loop, handle the `plan_preparing` event by updating the typing bubble's display state. Either change a flag on the message or use a local state variable to trigger a "Preparing plan..." indicator instead of "Reasoning...".

3. **Client: Preserve thinking on plan card messages** — In both `plan_ready` and `manager_done` (JSON plan path) handlers, before removing the typing bubble or streaming message, capture its `thinking` field and pass it to the new plan card message: `addManagerMessage({ role: "assistant", content: "", plan, thinking: managerThinkingAccumulated })`.

4. **Client: Preserve thinking on communicator messages** — Verify that when `communicator_token` repurposes the typing bubble via `{ ...target, ... }`, the `thinking` field is carried over (current code already spreads `target`, so this should work — confirm and add a test).

5. **NarrationBubble & TaskPlanCard: Render thinking toggle** — Ensure the `TaskPlanCard` component (which renders plan messages) can display a collapsible "(Thinking)" toggle when the message has a `thinking` field, similar to what `NarrationBubble` already does. Add the thinking toggle UI at the top of the plan card.

## Relevant files

- `server/routes.ts:530-629`
- `server/agent-loop.ts:95-169`
- `client/src/components/ide/chat-panel.tsx:1920-1976`
- `client/src/components/ide/chat-panel.tsx:2300-2525`
- `client/src/components/ide/chat-panel.tsx:2356-2403`
