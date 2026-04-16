# Fix Streaming Live Display — Event Queue + Rendering Pipeline

## What & Why

The live streaming display (brain icon + thinking text, narration, action log) has three user-facing bugs:
1. **Plan mode**: Thinking stream appears briefly ("flashes") then vanishes when narration/plan_ready events arrive
2. **New project creation**: Same flash-then-vanish behavior
3. **Build mode**: Thinking process and live action log never display at all

**Root cause**: Replit's reverse proxy buffers SSE responses. Events arrive in large chunks instead of token-by-token. The current code processes all events in a tight loop — even though per-token `setTimeout(0)` yields exist, transition events (`plan_ready`, `manager_done`, `step_completed`) immediately clear the live display state (`setMgrLiveThinkingText("")`). When 200+ events arrive in one burst, the entire think→narrate→clear cycle completes in <500ms. The user sees a brief flash at best.

For build mode specifically, a secondary bug exists: `isExecuting` (gated by `executingTaskIndex !== null`) is only set inside a `if (isCurrentProjectNow)` check in `step_starting`. If there is any stale closure or projectId mismatch (especially after Task #117's reconnection refactor), `isExecuting` stays false and the entire build `ActionLogLive` panel is hidden.

## Done looks like

- In plan mode: Brain icon with "THINKING" label appears and thinking text streams visibly for the full duration of the AI's thinking phase (multiple seconds). When narration starts, thinking collapses and narration text streams visibly.
- In build mode: Step progress, thinking text, narration text, and action log entries (file_write, tool_call, etc.) appear live and persist while the build runs. The user can see the agent working in real time.
- All three modes (new project, plan mode, build mode) show continuous live feedback — no flashing, no blank periods.

## Out of scope

- Server-side SSE changes (server already sends events correctly — verified by streaming tests)
- `React.memo` / virtualization optimizations (separate task)
- File decomposition of chat-panel.tsx (separate task)

## Tasks

1. **Create a client-side SSE event queue** in `chat-panel.tsx`: Instead of processing events immediately inside the `reader.read()` loop, push parsed events into an array queue. A separate `processQueue()` function drains events at a throttled rate (~20–30ms per event via `requestAnimationFrame` or `setTimeout`). This ensures thinking text is visible for a human-readable duration even when 200 events arrive in one chunk.

2. **Apply the event queue to the manager SSE handler** (`handleManagerSend`): Replace the current inline event processing loop with queue-based consumption. The queue drains events for `thinking_token`, `raw_token`, `plan_preparing`, `plan_ready`, `communicator_narration_starting`, `communicator_token`, and `manager_done` at a controlled pace. Transition events (`plan_ready`, `manager_done`) should drain immediately (no artificial delay) but only AFTER all preceding tokens have been rendered.

3. **Apply the event queue to the build SSE handler** (`handleExecutePlan` + `connectToBuildStream`): Same queue pattern for build events. `step_starting`, `thinking_token`, `narration_token`, `action_log`, `step_completed`, and `all_complete` are queued and drained at a controlled pace.

4. **Fix build mode `isExecuting` gating**: Ensure `setExecutingTaskIndex` is called reliably in `step_starting` regardless of projectId closure timing. Use `useIDEStore.getState().projectId` at event-processing time (not closure capture time) for the `isCurrentProject` check, and add a fallback: if `step_starting` fires and we have a valid `buildSessionIdRef.current`, set `isExecuting` even if the projectId check is ambiguous.

5. **Preserve thinking text across transitions**: When `plan_ready` fires, store the accumulated thinking text in the plan message (already done via `thinking: managerThinkingAccumulated`) but do NOT clear `mgrLiveThinkingText` until AFTER the plan card has rendered (i.e., add a `requestAnimationFrame` delay before clearing). Similarly for build mode: when `narration_token` starts, fade thinking via the existing 400ms timer rather than clearing instantly.

6. **Verify and clean up**: Remove any remaining debug console.log statements. Run both streaming tests (`plan-mode-streaming`, `build-session-streaming`). Manually verify live display in the app preview.

## Relevant files

- `client/src/components/ide/chat-panel.tsx:2861-3400` (manager SSE handler — `handleManagerSend`)
- `client/src/components/ide/chat-panel.tsx:3564-3620` (build session start — `handleExecutePlan`)
- `client/src/components/ide/chat-panel.tsx:4403-4950` (build SSE reconnection — `connectToBuildStream`)
- `client/src/components/ide/chat-panel.tsx:327-373` (ActionLogLive component)
- `client/src/components/ide/chat-panel.tsx:265-290` (ThinkingStream component)
- `client/src/components/ide/chat-panel.tsx:5450-5492` (rendering conditions for live display)
- `server/routes.ts:640-730` (manager-chat SSE event emission — read-only reference)
- `server/build-orchestrator.ts:200-235` (build event emission — read-only reference)
