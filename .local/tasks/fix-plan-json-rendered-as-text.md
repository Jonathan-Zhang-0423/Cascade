# Fix: Plan JSON Rendered as Plain Text

## What & Why
In Plan mode, the agent occasionally streams its plan response as raw JSON tokens (e.g. `{"overview":"...","whatAndWhy":"..."}`) rather than as a structured `plan_ready` SSE event. The chat panel accumulates these tokens into a string and then displays them verbatim — the user sees raw JSON in the chat bubble instead of a readable plan card.

## Done looks like
- When the agent response in Plan mode is a valid JSON plan object, it is rendered as a proper plan card (with overview, what & why, etc.) — never as raw JSON text
- When the response is plain conversational text, it continues to render normally as before
- No visible change to any other message type or mode

## Out of scope
- Changes to the server-side streaming format or SSE event types
- Build mode chat rendering
- Task #27 (code fence rendering)

## Tasks
1. **Detect JSON plan in accumulated content** — In the `manager_done` handler (and the `manager_token` live-streaming path), after assembling the final `canonical` string, attempt to parse it as JSON. If it is a valid plan object (has an `overview` or `whatAndWhy` field), treat it the same way as a `plan_ready` event: call `setManagerPlan` and `addManagerMessage` with the parsed plan instead of storing the raw JSON as `content`.

2. **Fallback text extraction** — If the JSON is a plan but `setManagerPlan` / plan card rendering is not suitable at that point (e.g. no steps array), extract the `overview` field (or whichever prose field is present) and display that as the message text so the user sees something readable rather than raw JSON.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:1960-1980`
- `client/src/components/ide/chat-panel.tsx:1834-1862`
