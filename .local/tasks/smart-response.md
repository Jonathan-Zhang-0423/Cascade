# Smart Response Button in Chat Panel

## What & Why
Add a "Smart Response" button to the chat input footer. When clicked, the AI reads the full conversation and the last Communicator/assistant message, then generates and populates the textarea with its best guess at what the user would naturally say next. The user can read, edit, and send — or just hit Send immediately. This lowers the barrier for beginner users who aren't sure how to respond to the AI's questions in Plan and Build modes.

## Done looks like
- A "Smart Response" button (sparkles icon + label) appears in the chat input footer, to the right of the Build/Plan mode dropdown
- The button is only enabled when: (a) there is at least one assistant message visible in the current mode, and (b) no AI response is currently streaming
- Clicking it shows a loading spinner on the button while the request is in-flight
- On success, the textarea is populated with the AI-generated suggestion and the cursor is focused inside the textarea so the user can immediately edit or send
- On error (network failure, API error), a brief toast or the button returns to normal state with no change to the textarea
- The button works in both Build mode (using `chatMessages`) and Plan mode (using `managerMessages`) — always based on the last visible assistant message in whichever mode is active
- The generated suggestion is a concise, natural, beginner-friendly reply that directly addresses what the Communicator asked — not a generic placeholder

## Out of scope
- Automatically sending the suggestion (user must always press Send manually)
- Multiple suggestion variants to choose from (one suggestion per click)
- Persisting suggestions between sessions

## Tasks

1. **Add `/api/smart-response` backend route** — Create a new non-streaming POST endpoint in `server/routes.ts`. It accepts `{ messages: [{role, content}][], mode: "build" | "manager" }` (the visible conversation history). It calls `DOUBAO_LITE_MODEL` with a system prompt instructing the AI to generate a short, natural, beginner-appropriate reply to the last assistant message in the conversation. Returns `{ suggestion: string }`.

2. **Add Smart Response UI and handler to the chat panel** — In `client/src/components/ide/chat-panel.tsx`:
   - Add a `smartResponseLoading: boolean` state.
   - Write a `handleSmartResponse()` async function: reads the correct message history based on `chatMode` (either `chatMessages` or `managerMessages`), POSTs to `/api/smart-response`, and on success sets the `input` state to the returned suggestion and focuses the textarea.
   - Add the "Smart Response" button in the input footer row (between the mode dropdown and the hint text). Use the `Sparkles` icon (already imported) with the label "Smart Response". Disable when `smartResponseLoading` is true or no assistant messages exist or the AI is streaming. Show a `Loader2` spinner on the button while loading.

## Relevant files
- `server/routes.ts:452-615`
- `client/src/components/ide/chat-panel.tsx:1-10,2230-2327`
