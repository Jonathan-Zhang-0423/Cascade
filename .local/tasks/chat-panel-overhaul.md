# Chat Panel UI/UX Overhaul — Replit Agent Patterns

## What & Why
The chat panel (`chat-panel.tsx`) is a 3,680-line monolith that mixes SSE streaming logic, reconnection handling, event parsing, and UI rendering into a single component. This overhaul refactors the architecture into composable hooks and modules, removes redundant code (the same SSE parsing pattern is duplicated 4+ times), and enhances the UI to match Replit Agent's streaming action-indicator patterns — grouped tool call rows with stacked icons, prominent build-phase indicators, smoother streaming transitions, and better collapsible sections.

## Done looks like
- The chat panel renders all the same features it does today (plan mode, build mode, streaming, checkpoints, etc.) but the code is split into focused modules instead of one 3,680-line file
- During plan mode: thinking stream, narration text, and action logs stream live with clear icons; plan cards appear with collapsible sections (What & Why, Done Looks Like, Tasks, etc.)
- During build mode: each action the agent takes (file write, file read, terminal command, step progress, thinking) appears as a compact action row with a distinct icon, streaming live. Related consecutive tool calls of the same type are grouped into a single collapsible row with a count badge (e.g., "3 files written" with stacked file icons). A prominent build-phase pill/badge at the top of the stream area shows the current phase (Thinking → Working → Verifying → Fixing) with appropriate icons and colors
- Long assistant messages are truncated with a "Show more" button
- Collapsed action log entries for completed messages show grouped icon stacks instead of listing every entry individually
- All existing functionality (reconnection, checkpoints, plan execution, review phases, confirmation flow, smart response, provider switching, i18n) continues to work
- No regressions — the refactor is structural, not behavioral

## Out of scope
- Backend/server changes (agent-loop, build-orchestrator, routes, prompts)
- Adding new action types that the backend doesn't already emit (the backend already emits `file_write`, `file_read`, `tool_call`, `thinking`, `step`, `narration`)
- Kanban-style task board view (a separate feature)
- Parallel task execution UI (a separate feature)
- Changes to the IDE store shape (keep the existing interfaces)

## Tasks
1. **Extract SSE streaming into a reusable hook** — Create a `useSSEStream` (or similar) hook that encapsulates the fetch → ReadableStream → TextDecoder → line splitting → JSON parsing → event dispatch pattern. This eliminates the 4+ duplicated SSE parsing blocks in chat-panel.tsx. The hook should accept an event handler map and return controls (abort, reconnect status).

2. **Extract manager/plan mode logic into a dedicated hook** — Move the `handleManagerSend`, manager SSE event handling, communicator calls, plan preparation state, and manager reconnection logic out of the main component into a `useManagerStream` hook. It should consume the SSE hook from step 1.

3. **Extract build mode logic into a dedicated hook** — Move `handleExecutePlan`, build session SSE event handling, build phase tracking, action log accumulation, heartbeat watchdog, and build reconnection logic into a `useBuildStream` hook. It should consume the SSE hook from step 1.

4. **Slim down ChatPanel to a thin orchestrator** — The main `ChatPanel` component should only wire together the hooks from steps 2-3, handle keyboard events, render the mode toggle, and compose the message list + input area. Target: under 400 lines.

5. **Enhance action log with grouped tool calls and richer icons** — Update `ActionLogLive` and `ActionLogCollapsed` to group consecutive entries of the same type into a single collapsible row with a count badge and stacked icons (e.g., "Wrote 3 files" with a single expand). Add a `terminal_command` icon variant (distinct from generic `tool_call`). Ensure file-write entries link to the diff/code preview on expand.

6. **Add a prominent build-phase indicator** — Create a `BuildPhaseIndicator` component that displays a pill/badge at the top of the live streaming area showing the current phase: Thinking (brain + pulse), Working (hammer + spin), Verifying (shield + pulse), Fixing (wrench + spin). Transition smoothly between phases with a subtle animation.

7. **Add "Show more" truncation for long messages** — In `MessageBubble` and `NarrationBubble`, if the text content exceeds ~15 lines or ~600 characters, truncate with a "Show more" / "Show less" toggle. Keep code blocks always visible.

8. **Clean up dead code and redundancies** — Remove any unused imports, dead branches, or vestiges of the old Vibe Agent flow (references exist in the code comments). Consolidate any remaining duplicated patterns. Ensure `chat-types.ts` is the single source of truth for all event type sets and mappings.

## Relevant files
- `client/src/components/ide/chat-panel.tsx`
- `client/src/components/ide/chat/action-log.tsx`
- `client/src/components/ide/chat/plan-components.tsx`
- `client/src/components/ide/chat/message-components.tsx`
- `client/src/components/ide/chat/chat-types.ts`
- `client/src/components/ide/chat/chat-utils.tsx`
- `client/src/components/ide/chat/error-boundary.tsx`
- `client/src/stores/ide-store.ts:1-120`
- `server/build-orchestrator.ts`
- `server/routes.ts`
