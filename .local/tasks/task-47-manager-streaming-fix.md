# Task #47 — Fix visible streaming: lite model + typing indicator

## Root Cause

`/api/manager-chat` uses `DOUBAO_MODEL` (`doubao-seed-2-0-code-preview-260215`), a reasoning model.
These models spend their time in a chain-of-thought phase. During this phase, **zero delta tokens
are emitted as `delta.content`** — the full JSON output only arrives in the last ~1 second of a
13-second call. Result: all `manager_token` events fire in rapid succession, looking identical
to the old "pop in all at once" behavior.

## Fix 1 — Use lite model for Manager Mode 1 (conversational)

In `server/routes.ts`, inside `/api/manager-chat`, detect which path the AI will take and use
the right model:

**Problem**: We don't know if the response will be Mode 1 or Mode 2 until the JSON is complete.
**Solution**: Always use `DOUBAO_LITE_MODEL` for the Manager streaming call, since:
- Lite model is designed for fast, conversational tasks
- Mode 1 (conversational) is the common case that benefits most from speed
- Mode 2 (plans) can still produce good results with the lite model — it's used in other
  agents and produces quality output

Change in `/api/manager-chat`:
```typescript
// Before:
model: DOUBAO_MODEL,

// After:
model: DOUBAO_LITE_MODEL,
```

Also use DOUBAO_LITE_MODEL for the inline Communicator call (already fast, stays lite).

## Fix 2 — Typing indicator bubble

In `client/src/components/ide/chat-panel.tsx`, show a "typing" bubble immediately when
`setManagerResponding(true)` is called, before any `manager_token` arrives:

In `handleManagerSend`, right before the `fetch` call:
```typescript
// Add typing indicator immediately
addManagerMessage({ role: "assistant", content: "", source: "communicator", typing: true });
let typingInserted = true;
```

Then on first `manager_token`:
- Instead of `addManagerMessage(...)` for first token, **replace** the typing bubble in place:
```typescript
if (!messageInserted) {
  // Replace the typing bubble with real content
  const msgs = useIDEStore.getState().managerMessages;
  const last = msgs[msgs.length - 1];
  if (last?.role === "assistant" && (last as any).typing) {
    useIDEStore.setState({
      managerMessages: [...msgs.slice(0, -1), { ...last, content: display, typing: false }],
    });
  } else {
    addManagerMessage({ role: "assistant", content: display, source: "communicator" });
  }
  messageInserted = true;
}
```

On `plan_ready` (plan flow): the typing bubble gets replaced by the plan card — remove the
typing bubble before adding the plan card message:
```typescript
// Remove typing bubble if present before adding plan card
const msgs = useIDEStore.getState().managerMessages;
const last = msgs[msgs.length - 1];
if (last?.role === "assistant" && (last as any).typing) {
  useIDEStore.setState({ managerMessages: msgs.slice(0, -1) });
}
// Then add plan card
addManagerMessage({ role: "assistant", content: "", plan });
```

### ChatMessage type — add `typing?: boolean` field

In `client/src/stores/ide-store.ts`, update `ChatMessage`:
```typescript
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  source?: "communicator";
  plan?: any;
  typing?: boolean;  // <-- add this
};
```

### Render typing indicator in the chat bubble

In the assistant message rendering in `chat-panel.tsx`, when `msg.typing === true`, show
an animated three-dot indicator:
```tsx
{msg.typing ? (
  <div className="flex gap-1 items-center py-1">
    <span className="w-2 h-2 bg-current rounded-full animate-bounce [animation-delay:-0.3s]" />
    <span className="w-2 h-2 bg-current rounded-full animate-bounce [animation-delay:-0.15s]" />
    <span className="w-2 h-2 bg-current rounded-full animate-bounce" />
  </div>
) : (
  // existing content rendering
)}
```

## Files Changed

- `server/routes.ts` — change `DOUBAO_MODEL` → `DOUBAO_LITE_MODEL` in `/api/manager-chat`
- `client/src/stores/ide-store.ts` — add `typing?: boolean` to `ChatMessage` type
- `client/src/components/ide/chat-panel.tsx`:
  - Add typing bubble in `handleManagerSend` before fetch
  - Replace typing bubble on first `manager_token`
  - Remove typing bubble on `plan_ready`
  - Render animated dots when `msg.typing === true`

## Done looks like

- User sends message → typing bubble appears **instantly** (three bouncing dots)
- Within 1-3 seconds, text starts streaming into the bubble word-by-word
- For plan: typing bubble disappears, plan card renders, then narration streams below
- Response times drop from 13s → 3-5s for conversational messages
