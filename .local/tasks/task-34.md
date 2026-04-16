# Fix Build Execution: Silent Code-Write Failures

## What & Why
When the build pipeline runs (via "Start Building" or "Build Now"), steps are marked "done" even when the AI produced no usable code blocks — so the plan appears to complete but files are never actually changed. There are three contributing bugs:

1. `executeSubTask` always returns `true` on a successful API call, even when `finalBlocks.length === 0`. This causes `handleExecutePlan` to mark the step "done" with no code written.
2. `max_tokens: 4096` on `/api/chat` (Editor Agent) is frequently too low for steps that output large modified files — the stream ends mid-block, corrupting the code fence and causing extraction to fail.
3. The editor prompt doesn't emphasize the `file="..."` annotation strongly enough; the model sometimes emits plain code fences that the parser silently strips.

## Done looks like
- A step that produces no code blocks (because the model failed to follow the format or the stream was cut short) is marked **failed**, not done — and the task card shows it in a red/failed state so the user can see something went wrong.
- `max_tokens` for the Editor Agent is raised to 16 384 (or higher) so large file outputs aren't truncated mid-stream.
- The editor system prompt adds a bolded reminder that omitting `file="..."` makes the output useless, reducing silent format mismatches.
- Optionally: if a step fails for "no code produced", the step shows a short reason badge ("No code output") so the user knows to retry or clarify.

## Out of scope
- Automatic retry on failure (could be future work)
- Verifying code correctness (the holistic review pass already covers this)

## Tasks
1. **Raise Editor Agent token limit** — Change `max_tokens` in `/api/chat` from 4096 to 16384 to prevent mid-stream truncation of large file outputs.
2. **Strengthen editor prompt** — Add a bolded warning at the top of the output format section making clear that any code block without `file="..."` will be completely ignored by the system.
3. **Mark step failed when no code produced** — In `executeSubTask`, change the return value to `false` (or a new `{ success: false, reason: "no_code" }` signal) when `finalBlocks.length === 0` after the full stream completes. Update `handleExecutePlan` to mark the step "failed" in that case, so the task card displays it visually as a failure.

## Relevant files
- `server/routes.ts:229-233`
- `server/editor-prompt.ts`
- `client/src/components/ide/chat-panel.tsx:1775-1784`
- `client/src/components/ide/chat-panel.tsx:1921-1943`
