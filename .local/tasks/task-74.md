---
title: Build Mode: live narration per tool call
---
# Build Mode Live Narration in Chat

## What & Why

During a Build Mode execution, the user sees task-step status indicators (running/done) updating in the plan card, but the chat panel shows almost nothing while the agent is actively working. The root cause has two layers:

1. **Tool calls emit no narration**: The editor AI narrates briefly ("I'll implement step 1 now.") before its first tool call, generating a handful of `narration_token` events. After that, the actual work — `read_file`, `write_file`, `mark_step_complete` — happens silently with zero tokens emitted. During file reads and writes (the bulk of build time), the chat is completely empty.

2. **Client-side display path confirmed correct**: `narration_token` events are accumulated in a RAF-driven buffer and flushed to `managerMessages` as a rolling `source: "communicator"` message. The store and render code are wired correctly; messages simply never arrive for most of the build.

The user expects to see something like:
- "Reading /project/game.js…"
- "Applying changes to /project/game.js…"
- "Step 1 complete: Added berserk toggle."

## Done looks like

- While the agent is reading a file, a live message appears in the chat: "Reading `/project/game.js`…"
- While the agent is writing a file, a message appears: "Writing `/project/game.js`…"
- When a step completes, a brief completion note appears.
- All messages update progressively (same chat bubble per step, accumulating).
- The existing brief AI preamble (already working) continues to appear before these tool-level messages.

## Out of scope

- Redesigning the chat layout or the TaskPlanCard.
- Narration for the verifier/fixer agent tool calls (separate agent loop, lower priority).
- Streaming narration character-by-character from tool handlers (one-shot string emit is sufficient).

## Tasks

1. **Emit narration tokens from tool handlers** — In `buildBuilderTools` and `buildFixerTools` (and their shared tool handler code), add `emit({ type: "narration_token", token: "..." })` calls at the start of `read_file`, `write_file`, and `mark_step_complete` handlers. The text should be short and descriptive (e.g., "Reading /project/game.js…", "Writing /project/game.js…", "Step 1 complete."). Use the same `emit` argument that tool handlers already receive.

2. **Verify end-to-end display** — Confirm that the new narration tokens reach the chat panel and accumulate correctly in the rolling narration bubble. Check that `resetNarration()` is not called in a way that drops in-flight tool narration. If needed, adjust the RAF flush timing so tool narration is not lost between steps.

## Relevant files

- `server/agent-tools.ts:26-163`
- `server/agent-loop.ts:76-101`
- `server/build-orchestrator.ts:160-321`
- `client/src/components/ide/chat-panel.tsx:2143-2255`