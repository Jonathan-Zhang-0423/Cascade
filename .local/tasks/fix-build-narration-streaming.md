# Fix Build-Session Narration & Thinking Streaming

## What & Why
When a user clicks "Start building" from a plan card, the chat shows no live streaming narration even though the server is emitting tokens. Two root causes were identified through deep code analysis:

**Root Cause 1 — Thinking tokens are silently dropped when `commMsgIndex` is -1:**
`flushThinkingToStore()` has a guard `if (idx === -1) return` which silently discards thinking tokens if no step-header message has been attached yet. This can happen during the first iteration because `step_starting` runs synchronously (no `await` after adding the message), so React hasn't committed it before thinking tokens start accumulating. There is also no fall-through to create a message on-demand.

**Root Cause 2 — For thinking-mode models (Kimi, GLM), `delta.content` is often zero:**
These models place all reasoning in `reasoning_content` and call tools directly, producing zero `narration_token` events from the AI itself. Tool handlers DO emit narration tokens (`\nReading: ...`, `\nWriting: ...`), but the content is prepended to the step-header string producing a concatenated blob that only appears after typing ends — giving the impression of no streaming.

**Root Cause 3 — Thinking content is rendered too faintly:**
During the thinking phase (`typing === true`), thinking text is shown at 12 px, italic, `text-muted-foreground/60`. Users perceive this as "nothing happening" because it looks like a footnote rather than live AI output.

## Done looks like
- During a build session, the user sees a progress message appear immediately when each step starts.
- Thinking/reasoning text from Kimi, GLM, MiniMax, or Doubao streams into the chat in real time and is clearly readable (not faint/tiny).
- File operations (read/write) emit distinct, readable progress lines that stream in as they happen.
- Even if the AI produces zero `delta.content`, the user always sees meaningful live feedback via thinking tokens and tool-call narration.
- The server-side streaming tests continue to pass.

## Out of scope
- Changing the AI providers or their APIs.
- Modifying the plan-mode (manager-chat) streaming flow.
- Changing the build orchestrator's step sequencing.

## Tasks

1. **Fix `step_starting` yield and `flushThinkingToStore` robustness** — After handling `step_starting` in the streaming loop, add `await new Promise(r => setTimeout(r, 0))` so React commits the step-header message before thinking tokens arrive. In `flushThinkingToStore`, if `idx === -1` (no message found), create a new communicator message on the fly (same as `flushNarrationToStore` does) so thinking tokens are never silently dropped.

2. **Separate step header from narration accumulator** — Currently `commAccumulated` is initialized to the step header text so narration tokens get prepended with the header. Reset `commAccumulated` to `""` after adding the header message in `step_starting`, keeping the header only as the initial `content` of the message. This way narration tokens show as fresh streaming content without repeating the header.

3. **Improve thinking-token visibility in `NarrationBubble`** — During `isActivelyThinking` (typing === true), render the streaming thinking content at a more readable size and opacity (e.g., `text-[13px]` not `text-[12px]`, `text-muted-foreground/80` not `/60`, remove italic). Add a more prominent header label like "Reasoning…" instead of just "Thinking…" so users understand they're watching real AI output.

4. **Add a `thinking_token` console log in agent-loop.ts** — Add a console.log line for the very first narration_token per iteration (parallel to the existing thinking_token log) so production logs can confirm narration tokens are being emitted for all providers.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:2282-2328` (flushThinkingToStore, flushNarrationToStore, resetNarration)
- `client/src/components/ide/chat-panel.tsx:2396-2448` (streaming event handlers for step_starting, thinking_token, narration_token)
- `client/src/components/ide/chat-panel.tsx:1489-1543` (NarrationBubble component)
- `server/agent-loop.ts:98-132` (thinking_token and narration_token emission)
- `server/agent-tools.ts:119-165` (tool handler narration emissions)
