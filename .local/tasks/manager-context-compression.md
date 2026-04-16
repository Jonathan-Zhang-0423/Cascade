# Manager Chat Context Compression

## What & Why
The Manager Agent conversation currently uses a naive 50-message limit stored in localStorage. When this cap is hit, old messages are simply discarded — which means the Manager forgets the user's original intent, early decisions, and clarifications from long planning sessions.

This task implements **server-side context compression** modeled on the s06 pattern from learn-claude-code. When the Manager's conversation history grows large (exceeding a token threshold), the server summarizes the older portion of the conversation using a lightweight LLM call and substitutes it with a compact summary. Nothing is truly lost — the semantic meaning is preserved while token count stays manageable.

## Done looks like
- Long planning sessions (15+ message exchanges) no longer lose early context
- When the Manager conversation exceeds ~25,000 estimated tokens, the server automatically compresses older messages into a summary before the next LLM call
- The Manager can still reference decisions and constraints from early in the conversation after compression
- Compression is invisible to the user — the conversation continues naturally
- The 50-message client-side cap in `ide-store.ts` is removed or raised significantly (100+), since the server now manages context health

## Out of scope
- Compression for the build session (Editor/Verifier) — those are short-lived by design
- Compression for Mentor Agent calls
- Displaying compression events in the UI

## Tasks
1. **Build the compression utility** — Create `server/context-compressor.ts` with a `compressMessages(messages)` function. It should estimate token count (character-based approximation is fine), and if above threshold, call the Doubao client with a "summarize this conversation" prompt to produce a concise summary. Return the compressed message array: the summary as a single user message followed by an assistant acknowledgment, plus the most recent N messages kept verbatim.

2. **Wire into the Manager chat route** — In `/api/manager-chat` in `server/routes.ts`, call `compressMessages()` on the incoming history before constructing the LLM payload. This ensures every Manager call operates within a healthy context window regardless of how long the session has been going.

3. **Raise the client-side message limit** — In `client/src/stores/ide-store.ts`, raise or remove the 50-message cap on `managerMessages`, since the server is now responsible for token management.

## Relevant files
- `server/routes.ts`
- `server/doubao-client.ts`
- `client/src/stores/ide-store.ts`
