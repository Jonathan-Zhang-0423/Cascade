# Build Agent Status Indicator

## What & Why
During a build session users have no real-time feedback about what the AI agent is doing inside the build loop. Add a compact status strip just above the chat input that shows the current build phase, so users can see at a glance whether the agent is thinking, writing code, verifying, or fixing bugs.

The send→stop button swap already works (it turns into a red square whenever a build is running), so no changes are needed there.

## Done looks like
- While a build is running, a small animated indicator appears just above the rounded input box that reads one of:
  - "Agent is thinking..." (when a new step starts / LLM is generating)
  - "Agent is working..." (when narration tokens or code writes are streaming in)
  - "Agent is verifying..." (when the verifier agent is running)
  - "Agent is fixing..." (when bugs were found and the fixer is running)
- The indicator disappears the moment the build ends (done, aborted, or error).
- Doubao and Kimi builds both trigger the indicator correctly.
- The stop button (already present) continues to work unchanged.

## Out of scope
- Any backend changes.
- Changes to the stop button logic (already works).
- Any UI outside the chat panel input area.

## Tasks
1. **Track build phase state** — Add a `buildPhase` local state (`"thinking" | "working" | "verifying" | "fixing" | null`) inside the main `ChatPanel` component. Wire it to the existing SSE event handler: `step_starting` → `"thinking"`, `narration_token` / `code_applied` → `"working"`, `reviewing` → `"verifying"`, `bugs_found` → `"fixing"`, `done` / abort cleanup → `null`.

2. **Render status strip** — Just above the existing rounded input container, render a small strip (only when `isExecuting && buildPhase !== null`) showing a pulsing dot and the phase label. Hide it completely when the build is idle.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:2230-2320` — SSE event handler (where phase transitions should be set)
- `client/src/components/ide/chat-panel.tsx:2374-2448` — stop/abort logic (for cleanup of phase on abort)
- `client/src/components/ide/chat-panel.tsx:2610-2728` — input box and send/stop button area (where the strip should be inserted above)
