# Fix Manager Chat Streaming Display

## What & Why
Manager agent responses are completely invisible in the chat UI. The server
streams plain-text tokens via `raw_token` SSE events, but the frontend handler
for `raw_token` tries to extract content by matching the regex `"content"\s*:\s*"`
inside the accumulated token string — a pattern left over from an older format
where raw OpenAI API response chunks (JSON objects) were forwarded wholesale.
Since the server now sends plain text, the pattern never matches, `rawContentStart`
stays at -1, and no text is ever written to the screen. The typing bubble appears
and then silently disappears after the full response completes. This affects every
conversational Stage 1 / Stage 2 manager reply (i.e. every exchange that is not
a final plan submission).

## Done looks like
- When the user sends a message in Plan Mode, the manager's reply streams in
  progressively, character by character, while the AI is still generating.
- The typing bubble transitions immediately into live text on the first token,
  matching how the Build Mode Vibe chat already works.
- The `manager_done` fallback correctly shows the full text even in edge cases
  where the live stream is interrupted.
- Both streaming validation tests continue to pass.

## Out of scope
- Changes to the server-side SSE format or the agent loop.
- Reducing actual network latency to the Beijing AI endpoint (that is inherent).
- The Build Mode or Vibe chat flows (they already work correctly).

## Tasks
1. **Fix the `raw_token` handler** — Rewrite the broken JSON-extraction logic so
   it treats `ev.token` as plain text directly, accumulating into `managerAccumulated`
   and updating the streaming message exactly as the working `manager_token` handler
   already does. The `rawAccumulated` / `rawContentStart` / `rawContentDone` state
   vars and their JSON-parsing branches can be removed.

2. **Fix the `manager_done` fallback** — Update the fallback block (currently guarded
   by `messageInserted && rawAccumulated`) so that if live streaming somehow produced
   no visible text, it uses `managerAccumulated` to show the final complete response
   and removes the typing bubble before doing so.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:1780-2045`
