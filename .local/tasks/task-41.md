---
title: Server-Side Build Orchestration
---
# Task 41: Server-Side Build Orchestration

## What & Why
Currently the entire build loop lives in the browser (`handleExecutePlan` in `chat-panel.tsx`). The client calls the Editor, Verifier, fix-plan planner, and Communicator in sequence, decides when to loop, and applies code to the file system — all in one 2000-line React callback. The problem: a single network hiccup, tab-background throttle, or browser memory pressure can silently stall or kill a build mid-cycle. There is no recovery mechanism. The server has no idea a build is in progress.

Moving the orchestration to the server means: the loop runs to completion regardless of client-side interruptions. The client becomes a passive display, receiving a stream of events and applying them to UI state.

## Done looks like
- `POST /api/build-session` starts a full build on the server and immediately returns an SSE stream
- Server runs: `plan steps → Editor → (code applied) → Verifier → (if fail) fix-plan → fix steps → re-verify` — up to 3 fix cycles
- All SSE events (step_starting, editor_token, code_applied, step_completed, reviewing, review_passed, bugs_found, fixing, communicator_token, all_complete, build_error, needs_input) are received by the client in real time
- Client applies code blocks to the in-memory file system as they arrive (same as before)
- Client updates task statuses, review phase, and chat messages from the events
- The Stop button closes the SSE connection; server detects the close and exits the loop
- `DELETE /api/build-session/:sessionId` is an alternative abort signal
- In-memory session state (files, step progress) is maintained by the server per sessionId and cleaned up on completion or after 30 minutes
- The `handleExecutePlan`, `executeSubTask`, `performHolisticReview`, `requestFixPlan` functions in the client are removed and replaced with a single SSE listener hook

## Out of scope
- Persistent session storage (database-backed build sessions)
- Multi-user concurrency handling beyond in-memory Map isolation
- Reconnect/resume after client disconnect (deferred to a future task)
- Plan card redesign (Task 39) and dual-tone prompts (Task 40)

## Architecture — SSE Protocol

### Request
```
POST /api/build-session
Content-Type: application/json

{
  "sessionId": "uuid-v4",
  "plan": { "summary": "...", "steps": [...] },
  "userRequest": "Build me a Snake game",
  "userLang": "English",
  "files": [{ "path": "/project/index.html", "content": "..." }]
}
```

### SSE Event Types (each line: `data: <JSON>\n\n`)
```
{ type: "step_starting",      stepNumber, stepTitle, totalSteps }
{ type: "editor_token",       token }                    // streaming Editor output
{ type: "code_applied",       filePath, code }           // complete code block extracted
{ type: "step_completed",     stepNumber }
{ type: "communicator_token", token }                    // streaming Communicator narration
{ type: "communicator_done" }
{ type: "reviewing" }
{ type: "review_passed",      summary, requirementMatchPercent }
{ type: "bugs_found",         bugCount, reviewSummary, fixCycle, maxFixCycles }
{ type: "fixing",             fixCycle }
{ type: "all_complete",       changedFiles, summary }
{ type: "needs_input",        items }
{ type: "build_error",        message }
{ type: "done" }               // stream ends
```

### Abort
- Client closes the EventSource connection → server's `res.on("close")` fires → sets `session.aborted = true`
- `DELETE /api/build-session/:sessionId` also sets `session.aborted = true`
- Server checks `session.aborted` at the top of every step iteration

## Changes required

### 1. New file: `server/build-orchestrator.ts`
Contains `runBuildSession(session, sseEmit, doubaoClient)`:
- Accepts: session (plan, files, userRequest, userLang, abortSignal), emitter callback, Doubao client
- Runs the full build loop (replaces `handleExecutePlan` logic):
  - For each step: call Editor API with streaming, emit `editor_token` for each chunk, extract code blocks from streamed text, emit `code_applied` for each complete block, update server-side file state, emit `step_completed`
  - After all steps: call Verifier API, emit `reviewing` → `review_passed` or `bugs_found`
  - If fail: call Manager Fix Plan API, run fix steps via Editor, re-verify
  - After pass: compute changed files (diff initial files vs final files), emit `all_complete`
  - For each Communicator event: call Communicator API with streaming, emit `communicator_token` per chunk, emit `communicator_done`
- Code-block extraction logic is ported from `parseCodeBlocks` in the client

### 2. `server/routes.ts`
Add:
```ts
// In-memory session store
const buildSessions = new Map<string, BuildSessionState>();

// Start build session
app.post("/api/build-session", async (req, res) => {
  const { sessionId, plan, userRequest, userLang, files } = req.body;
  const session: BuildSessionState = { id: sessionId, aborted: false, files: new Map(...), plan, userRequest, userLang };
  buildSessions.set(sessionId, session);
  
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const emit = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  
  res.on("close", () => { session.aborted = true; });
  
  await runBuildSession(session, emit, doubaoClient);
  buildSessions.delete(sessionId);
  res.end();
});

// Abort build session
app.delete("/api/build-session/:sessionId", (req, res) => {
  const s = buildSessions.get(req.params.sessionId);
  if (s) s.aborted = true;
  res.json({ ok: true });
});
```

### 3. `client/src/components/ide/chat-panel.tsx`
**Remove:**
- `executeSubTask` callback (≈150 lines)
- `performHolisticReview` callback
- `requestFixPlan` callback
- `handleExecutePlan` callback (≈250 lines)
- `executionAbortRef` (replaced by EventSource close)

**Add:**
- `handleExecutePlan` now:
  1. Gathers current files, plan, userRequest, userLang
  2. Generates a `sessionId` (crypto.randomUUID())
  3. Sends `POST /api/build-session` — but since SSE requires EventSource or fetch-based stream reading, uses `fetch` with `response.body` ReadableStream reader
  4. Reads the stream line-by-line, parses `data: {...}` events
  5. Dispatches each event to state updates:
     - `step_starting` → `updateTaskStatus(stepNumber, "running")`
     - `editor_token` → append to streaming message in chat
     - `code_applied` → `applyCodeBlock({ filePath, code })` + `refreshPreview()`
     - `step_completed` → `updateTaskStatus(stepNumber, "done")`
     - `communicator_token` → stream into assistant chat message
     - `communicator_done` → finalize message
     - `reviewing` → `setReviewPhase("reviewing")`
     - `review_passed` → `setReviewPhase("review_passed")`
     - `bugs_found` → `setReviewPhase("review_failed")`
     - `fixing` → `setReviewPhase("fixing")`
     - `needs_input` → `setPendingConfirmation`
     - `all_complete` → `setReviewPhase("review_passed")`, finalize
     - `build_error` → show error message, reset state
     - `done` → cleanup
- `handleStopExecution` now:
  1. Calls `fetch("DELETE /api/build-session/:sessionId")`
  2. Aborts the fetch reader (closes stream)
  3. Resets UI state as before

**Keep unchanged:**
- `applyCodeBlock` (still called from the new event handler)
- `callCommunicator` (still used for `plan_created` in `handleManagerSend`)
- `TaskPlanCard`, `StepItem`, `ReviewStatusBadge` components
- `handleManagerSend` (planning is still client-side)
- `handleContinueExecution` (updated to call new `handleExecutePlan`)

## Relevant files
- `server/build-orchestrator.ts` — NEW, the build loop
- `server/routes.ts` — new endpoints
- `client/src/components/ide/chat-panel.tsx` — replace client loop with SSE listener
- `client/src/stores/ide-store.ts` — no schema changes needed; same state shape
- `server/manager-prompt.ts` — `buildManagerFixPlanMessage` used by orchestrator
- `server/communicator-prompt.ts` — `buildCommunicatorMessage` used by orchestrator

## Dependency
- Task 40 should be merged first so `changedFiles` is available for `all_complete` computation in the orchestrator (though Task 41 can compute the diff itself if Task 40 is delayed).