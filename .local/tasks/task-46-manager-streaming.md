# Task #46 — Full Streaming: Manager → SSE in Both Modes

## What & Why

Today `/api/manager-chat` uses `stream: false` — the user waits in silence (just a spinner) until
the entire Manager JSON is ready, then the response appears all at once. This is slow and ugly.

The goal: make ALL chat feel live and responsive in both Plan Mode and Build Mode by streaming the
Manager's content tokens directly to the user as they arrive. No extra Communicator round-trip for
conversational responses (Option A) — the Manager's Mode 1 prompt is already beginner-friendly.

Also clean up two dead-code items:
- `server/vibe-prompt.ts` — exported but imported nowhere, safe to delete.
- `/api/chat` route — always used `EDITOR_AGENT_SYSTEM_PROMPT`, never called from the frontend.

---

## New End-to-End Flow

### Conversational message (`"type": "message"`)
```
User sends message
  → POST /api/manager-chat (SSE, stream: true)
  → Server state machine detects "type":"message" in accumulating JSON
  → Starts emitting content characters as { type: "manager_token", token } SSE events
  → Client shows word-by-word streaming bubble (same pattern as communicator_token today)
  → Stream ends → server parses full JSON, emits { type: "manager_done", project_name? }
  → Client finalizes bubble, strips [[PROJECT_NAME:...]] marker, renames project if needed
```

### Plan response (`"type": "plan"`)
```
User sends message
  → POST /api/manager-chat (SSE, stream: true)
  → Server detects "type":"plan" — accumulates silently (no manager_token events)
  → Stream ends → server parses full JSON
  → Server emits { type: "plan_ready", plan, project_name? }
  → Server then calls Communicator internally (same COMMUNICATOR_AGENT_SYSTEM_PROMPT)
  → Streams Communicator tokens as { type: "communicator_token", token }
  → Server emits { type: "manager_done" }
  → Client: on plan_ready → renders plan card; on communicator_token → updates narration bubble
```

---

## Server Changes — `/api/manager-chat` (routes.ts)

### Replace the current blocking implementation:

1. **Set SSE headers** (same pattern as `/api/communicator-chat`):
   ```
   res.setHeader("Content-Type", "text/event-stream")
   res.setHeader("Cache-Control", "no-cache")
   res.setHeader("Connection", "keep-alive")
   res.flushHeaders()
   ```

2. **Call Doubao with `stream: true`**

3. **Token state machine** — runs as tokens arrive:
   - Accumulate raw text in `accumulated`
   - `contentMode = false` initially
   - Once `/"type"\s*:\s*"message"/.test(accumulated)` AND `/"content"\s*:\s*"/.test(accumulated)`:
     - Set `contentMode = true`, record `contentStart` = index right after the opening `"`
   - While `contentMode`, walk forward from `lastEmitted` through the raw content string,
     handling escape sequences correctly (`\\` → emit next char, `"` unescaped → end of string)
   - Emit new characters: `res.write('data: ' + JSON.stringify({ type: "manager_token", token: newChars }) + '\n\n')`
   - Stop when closing `"` is found (set `contentMode = false`, mark content extraction complete)

4. **On stream end**, parse full JSON with existing `parseAIJson`:
   - **If message type**:
     - Emit `data: { type: "manager_done", project_name } \n\n`
   - **If plan type**:
     - Emit `data: { type: "plan_ready", plan, project_name } \n\n`
     - Build `CommunicatorEvent` for `plan_created` (same fields as today)
     - Call Communicator with `stream: true` (same Doubao call as `/api/communicator-chat`)
     - Forward each token: `res.write('data: ' + JSON.stringify({ type: "communicator_token", token }) + '\n\n')`
     - Emit `data: { type: "manager_done" } \n\n`
   - **Parse failure / error**:
     - Emit `data: { type: "manager_error" } \n\n`

5. **End**: `res.write("data: [DONE]\n\n"); res.end()`

6. **Error handling**: if headers not sent yet → `res.status(500).json(...)`, otherwise emit error event + end

---

## Client Changes — `handleManagerSend` (chat-panel.tsx)

### Replace `await response.json()` with SSE reader:

**Current flow (to replace):**
```typescript
const data = await response.json();
// branches on data.message / data.plan
```

**New flow:**
```typescript
const reader = response.body?.getReader();
// ... SSE decode loop (same pattern as callCommunicatorCore) ...

// State:
let managerAccumulated = "";   // raw content tokens for the message bubble
let messageInserted = false;   // has the streaming bubble been added yet?
let commAccumulated = "";      // communicator narration after plan_created
let commInserted = false;

// Per SSE event:
if (type === "manager_token") {
  managerAccumulated += ev.token;
  const display = stripProjectNameMarker(managerAccumulated); // strip [[PROJECT_NAME:...]] live
  if (!messageInserted) {
    addManagerMessage({ role: "assistant", content: display, source: "communicator" });
    messageInserted = true;
  } else {
    // update last manager message in place (same setState pattern used in callCommunicatorCore)
    useIDEStore.setState({ managerMessages: [...msgs.slice(0,-1), { ...last, content: display }] });
  }
} else if (type === "plan_ready") {
  // extract project_name and rename if present
  // clear old plan, set new plan (same as data.plan branch today)
  // normalize steps, updateTaskStatus
  // setManagerPlan(ev.plan) — plan card will render
  addManagerMessage({ role: "assistant", content: "", plan: displayPlan }); // plan card message
  commInserted = false; // reset for communicator narration
} else if (type === "communicator_token") {
  // narration after plan — same as callCommunicatorCore pattern
  commAccumulated += ev.token;
  // update the streaming message above the plan card OR add a new message
} else if (type === "manager_done") {
  // extract project_name from ev.project_name if present
  setManagerResponding(false);
} else if (type === "manager_error") {
  addManagerMessage({ role: "assistant", content: tr(lang, "chat.errorConnect"), source: "communicator" });
  setManagerResponding(false);
}
```

**Key details:**
- Keep `autoExecutePlanRef.current = true` logic for Build Mode (when plan arrives, auto-start build)
- Keep `callCommunicator` for plan_created narration? No — the server now handles Communicator
  streaming inline in the SSE response. Remove the separate `callCommunicator` call from the client
  for the plan_created case. Client just handles `communicator_token` events from the stream.
- Project rename: detect from `plan_ready.project_name` or `manager_done.project_name`
- `[[PROJECT_NAME:...]]` in streamed content: strip via `stripProjectNameMarker` on every update
- The `parsePlanLocalization` / localized plan display logic: move to the `plan_ready` handler
  (replaces the current block after `callCommunicator` resolves)
- Communicator narration from server is already in the user's language (same system prompt,
  same `userLanguage` field passed to `buildCommunicatorMessage`) — no client-side localization
  parsing needed for the tokens themselves

**Remove:**
- The separate `await callCommunicator({ event: "plan_created", ... })` call
- The `parsePlanLocalization` client-side localization pass (server returns already-localized narration)
- All the existing `const data = await response.json()` block and its branches

**Keep unchanged:**
- Everything in `handleExecutePlan` — build execution streaming is untouched
- `callCommunicatorCore` / `callCommunicator` — still used for build events (step_starting, etc.)
- `handleContinueExecution` — unchanged
- `handleCurrentSend` — unchanged (still routes to `handleManagerSend` for both modes)

---

## Communicator prompt update (communicator-prompt.ts)

The Communicator is now called on the server for `plan_created` only. No new event types needed for
Option A (Manager speaks directly for conversational messages).

However, the `userLanguage` field must be passed when calling Communicator from within the Manager
endpoint. Use `detectLanguage` on the last user message (same as client does today).

**Move `detectLanguage` helper to shared location OR duplicate in server:**
- Currently `detectLanguage` is in `chat-panel.tsx` (client-only)
- The server needs to detect the user's language to pass to `buildCommunicatorMessage`
- Add a simple `detectUserLanguage(messages)` helper in `routes.ts` that checks the last user
  message for CJK characters (same logic as the client-side `detectLanguage`)

---

## Cleanup

1. **Delete `server/vibe-prompt.ts`** — no imports anywhere
2. **Delete `/api/chat` route** in `routes.ts` — never called from frontend
3. **Remove unused import** of `EDITOR_AGENT_SYSTEM_PROMPT` in `routes.ts` if it's only used in the
   deleted `/api/chat` route and `runEditorNonStreaming` helper (check if `runEditorNonStreaming` is
   still used after cleanup — it's used for the AB test endpoint, so keep the import)
4. **Remove `updateLastAssistantMessage`, `setAiResponding`, `addChatMessage`** from the destructured
   store fields in `ChatPanel` if they become fully unused after this change. Verify first.

---

## Files Changed

- `server/routes.ts` — rewrite `/api/manager-chat`, add `detectUserLanguage` helper, remove `/api/chat`
- `server/vibe-prompt.ts` — DELETE
- `client/src/components/ide/chat-panel.tsx` — rewrite `handleManagerSend` SSE consumption,
  remove client-side `callCommunicator` call for `plan_created`

## Files Unchanged

- `server/build-orchestrator.ts`
- `server/communicator-prompt.ts`
- `server/manager-prompt.ts`
- `server/editor-prompt.ts`
- `client/src/stores/ide-store.ts`
- All other chat panel functions

---

## Done looks like

- User types a message in Plan Mode → text appears word-by-word in the chat bubble instantly
- User types a request that generates a plan → nothing streams (plan is building internally),
  then plan card appears all at once, then Communicator narration streams below it
- Build Mode direct chat (no plan active) → same word-by-word streaming as Plan Mode
- No regression in build execution (step events, code apply, etc.)
- `vibe-prompt.ts` is gone, `/api/chat` route is gone
- `setManagerResponding(false)` is always called in finally block, no stuck spinner
