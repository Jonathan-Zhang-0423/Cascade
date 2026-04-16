---
title: Fix manager-chat streaming — emit tokens immediately + correct e2e test
---

# Fix Manager-Chat Streaming

## Root Cause (confirmed by reading routes.ts lines 430-492)

The previous nginx fix (Task #53, X-Accel-Buffering) is correct but was never actually
verified on the right endpoint. The e2e test opened an *existing* project in Build
mode, so "hi" went to `/api/chat` (simple direct streaming) — NOT `/api/manager-chat`
(plan mode). The test reported success on the wrong endpoint.

The **real problem** is server-side JSON accumulation in the manager-chat loop:

```
token arrives
  → add to accumulated string
  → check if "type":"message" is in accumulated       ← waits for this
    → if yes, check if "content":" is in accumulated  ← AND this
      → ONLY THEN start emitting manager_token events
```

The AI generates JSON as:
  `{"type": "message", "project_name": "...", "content": "actual text starts here"}`

So NO tokens reach the frontend until the AI has generated the entire preamble
`{"type":"message","project_name":"My Project","content":"` — which can take 3–8+
seconds of silence from the user's perspective.

Additionally: there are no SSE heartbeat comments, so nginx/load balancers may
treat the idle connection as stalled and reset it.

## Solution

### 1. Server: emit raw tokens immediately + heartbeat (server/routes.ts)

Change the manager-chat `for await` loop to:
- Emit **every** token immediately as `{ type: "raw_token", token }` from the first
  token — no pattern detection required
- Keep the existing JSON accumulation so we can still parse the complete response
  at the end
- Emit an SSE heartbeat comment (`data: :\n\n`) every 5 seconds during the stream
  to keep the connection alive

After the loop ends (full JSON accumulated):
- Parse JSON as usual
- If message: emit `{ type: "manager_done", project_name }` — the content was
  already sent as raw_token events
- If plan: emit `{ type: "plan_ready", plan }`, then communicator stream, then
  `{ type: "manager_done" }`

Also add `(res as any).flush?.()` after every `res.write()` (belt-and-suspenders
for any compression middleware we can't see).

### 2. Frontend: handle raw_token in plan mode (client/src/components/ide/chat-panel.tsx)

Add a handler for `raw_token` events in the manager-chat SSE loop:
- On first `raw_token`: find the typing bubble and convert it to a streaming
  message bubble (exactly like the current `manager_token` handler on first token)
- On subsequent `raw_token`: extract the visible content from the raw JSON stream
  using a lightweight on-the-fly extractor. Specifically:
  - Try to detect `"content":"` in accumulated raw text; if found, display only
    the text after that marker (same as current server-side logic, but now on
    the frontend)
  - Until `"content":"` is detected, keep showing the animated typing indicator
    (no raw JSON shown to user)
- On `plan_ready`: clear/hide any raw streaming text, show plan card (existing logic)
- On `manager_done` (message response): extract the clean content from the fully
  accumulated raw_text using `parseAIJson`, then replace the message bubble content
  with the clean extracted text

This way:
- User sees the typing animation immediately (first raw_token arrives within 1-2s)
- Once AI reaches the "content" field (within 3-5s), actual content starts streaming
- Dramatic improvement over current 8-14+ seconds of total silence

### 3. Fix the emit helper to call flush

In ALL four SSE endpoints, change the `emit` helper to:
```typescript
const emit = (data: Record<string, unknown>) => {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as any).flush?.();
  } catch {}
};
```
And any `res.write("data: [DONE]\n\n")` calls should also call `(res as any).flush?.()`.

### 4. Fix the e2e test to specifically test plan mode

The test must:
1. Create or open a project that has NO existing files (so it opens in Plan mode)
2. Send a message in the plan mode chat input
3. Verify the typing bubble appears within 2 seconds of sending
4. Verify content starts streaming within 5 seconds (actual text characters appearing)
5. Verify the complete response arrives within 60 seconds

## Files to change

- `server/routes.ts` — manager-chat loop + emit flush in all 4 SSE endpoints
- `client/src/components/ide/chat-panel.tsx` — add raw_token handler (~line 1772)

## Done looks like

- User sends a message in plan mode
- Typing indicator appears within 1-2 seconds
- Text starts appearing within 5 seconds
- Remaining text streams word-by-word to completion
- E2E test specifically tests /api/manager-chat and PASSES with progressive streaming
