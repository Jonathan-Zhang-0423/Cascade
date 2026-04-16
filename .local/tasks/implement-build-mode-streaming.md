# Implement Build Mode Streaming Chat (Vibe Agent)

## What & Why
Build Mode direct chat (chatMode === "build", no plan) was designed to use the Vibe Agent with real-time token-by-token streaming. The full pipeline already exists but was never wired together:

- `addChatMessage` → exists in store, only ever called for user messages in confirmation flow
- `updateLastAssistantMessage` → defined in store, imported in chat-panel, but **never called**
- `setAiResponding(true)` → **never called** anywhere — only `false` is set
- `/api/chat` → SSE streaming endpoint that works perfectly, but **never called from the frontend**
- TypingIndicator at line 2197 → only shows when `isAiResponding && last chatMessage is empty` — currently never fires

Currently `handleCurrentSend` routes Build Mode (no plan) through `handleManagerSend` → `/api/manager-chat` (Manager agent, blocking JSON, no streaming). This is wrong — build mode chat should use the Vibe Agent.

Additionally: `/api/chat` uses `EDITOR_AGENT_SYSTEM_PROMPT` but per replit.md, Build Mode should use `VIBE_AGENT_SYSTEM_PROMPT`.

## Done looks like
- User types in Build Mode (chat toggle NOT in plan mode) and sends a message → response appears token by token in real time, stored in `chatMessages`
- TypingIndicator shows while streaming (`isAiResponding === true` + empty last assistant message)
- After streaming completes, a checkpoint is created
- Stop button aborts the stream mid-flight
- Plan Mode (chatMode === "manager") is completely unchanged — still uses Manager agent / `managerMessages`
- `/api/chat` uses Vibe Agent prompt
- `[[PROJECT_NAME:...]]` marker in Vibe response is detected and triggers project rename (same as before for plan mode)

## Out of scope
- Streaming the Manager agent's responses (Plan Mode stays non-streaming)
- Any changes to the build execution flow or communicator

## Tasks

### 1. Fix `/api/chat` to use Vibe Agent prompt
**File:** `server/routes.ts`
- Import `VIBE_AGENT_SYSTEM_PROMPT` from `./vibe-prompt`
- Replace `EDITOR_AGENT_SYSTEM_PROMPT` with `VIBE_AGENT_SYSTEM_PROMPT` in the `/api/chat` route
- Also import/use `buildEditorContextMessage` → replace with a file context builder suitable for vibe chat (the existing `buildEditorContextMessage` is fine)

### 2. Implement `handleVibeSend` in chat-panel
**File:** `client/src/components/ide/chat-panel.tsx`

Add a new async `handleVibeSend` callback:
1. Guard: if `isAiResponding || isManagerResponding || !trimmed` → return
2. `addChatMessage({ role: "user", content: trimmed })`
3. `addChatMessage({ role: "assistant", content: "" })` — empty placeholder triggers TypingIndicator
4. `setInput("")`
5. `setAiResponding(true)`
6. Detect project name from first user message (check if there's no prior user chatMessage) and call `renameProject` if `[[PROJECT_NAME:...]]` found in the response stream (same regex as handleManagerSend uses: `PROJECT_NAME_REGEX`)
7. Fetch `/api/chat` SSE:
   - Decode each `data: {"content":"..."}` token
   - `accumulated += token`
   - `updateLastAssistantMessage(accumulated)` on each token
   - Handle `[DONE]`
8. Strip `[[PROJECT_NAME:...]]` from the final accumulated content via `stripProjectNameMarker`
9. `updateLastAssistantMessage(stripped)` — finalize
10. `createCheckpoint("AI response")`
11. `setAiResponding(false)` in finally block
12. Store the abort controller in `abortRef.current` (same pattern as existing code) so the stop button works

### 3. Route Build Mode through `handleVibeSend`
**File:** `client/src/components/ide/chat-panel.tsx`

In `handleCurrentSend`, change the fallthrough logic:
```
if (chatMode === "build" && managerPlan && !isExecuting) { → execute plan }
if (chatMode === "build") { handleVibeSend(); return; }  // ← NEW
handleManagerSend();  // only for chatMode === "manager" now
```

Also update `handleStop` to abort the vibe stream (it already calls `abortRef.current?.abort()` so this should work automatically).

### 4. Add `handleVibeSend` to dependency arrays
- Add `handleVibeSend` to `handleCurrentSend`'s `useCallback` deps
- Add `handleVibeSend` to `handleStop`'s `useCallback` deps if needed

## Relevant files
- `server/routes.ts:343-405` — `/api/chat` endpoint
- `server/vibe-prompt.ts` — VIBE_AGENT_SYSTEM_PROMPT to use
- `client/src/components/ide/chat-panel.tsx:1488-1491` — imported but unused functions
- `client/src/components/ide/chat-panel.tsx:2080-2095` — handleCurrentSend routing
- `client/src/components/ide/chat-panel.tsx:2197-2199` — TypingIndicator that needs isAiResponding to fire
- `client/src/stores/ide-store.ts:796-808` — updateLastAssistantMessage implementation
