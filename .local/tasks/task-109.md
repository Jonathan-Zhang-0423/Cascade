---
title: Post-Build Chat Panel Cleanup
---
# Post-Build Chat Panel Cleanup

## What & Why
After a build session finishes, two UI issues persist at the bottom of the chat panel:
1. The **Actions log** (collapsed action entries) and **Build Completion Card** (summary + changed files) are rendered as the last message in the chat, stuck at the very bottom near the input area. Users expect these to appear inline with the plan/task messages they belong to, not floating at the end.
2. A yellow **"Waiting"** status indicator remains visible after the build is fully complete, suggesting a stale task status that isn't being cleared when execution finishes.

## Done looks like
- After a build completes, the Actions log and Build Completion Card appear directly beneath the last step narration message in the plan card, not at the very bottom of the chat
- No stale "Waiting" or "pending" indicators remain visible after the build has fully completed — all task statuses reflect their final state (done/failed)
- The build phase indicator ("Agent is thinking/working/verifying/fixing...") fully disappears after completion

## Out of scope
- Changes to the live ActionLogLive component during active builds
- Changes to the LLM Monitor popup
- Redesigning the plan card layout

## Tasks
1. **Attach build result to the plan card** — Instead of adding the buildResult as a standalone new manager message at the end of the array, embed it within or directly adjacent to the plan card's message, so it renders inline with the task context.
2. **Clear stale task statuses** — Ensure that when a build completes (in the finally block of handleExecutePlan), all task statuses in the plan card that are still "pending" or "running" are updated to their correct final state ("done" or "failed"), so no yellow "Waiting" circles persist.
3. **Verify buildPhase and live state cleanup** — Confirm that buildPhase, liveActionLog, liveThinkingText, and liveNarrationText are all fully cleared in every exit path (success, error, abort) so no stale indicators remain.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:2730-3202`
- `client/src/components/ide/chat-panel.tsx:3422-3471`
- `client/src/components/ide/chat-panel.tsx:1260-1300`
- `client/src/components/ide/chat-panel.tsx:3474-3486`