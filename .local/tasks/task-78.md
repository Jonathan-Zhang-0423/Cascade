---
title: Fix Kimi K2.5 build failure (reasoning_content)
---
# Fix Kimi K2.5 Build Failure (reasoning_content)

## What & Why
When Kimi K2.5 is selected and a build starts, the agent loop fails immediately on iteration 2 with:

```
400 thinking is enabled but reasoning_content is missing in assistant tool call message at index 2
```

Kimi's "thinking" mode attaches a `reasoning_content` field to every assistant message it emits. When our agent loop appends an assistant message to the conversation history between iterations, it only includes `content` and `tool_calls` — omitting `reasoning_content`. Kimi then rejects the next API call because the field is absent on a previous assistant turn where thinking was active.

## Done looks like
- Builds with Kimi K2.5 as the selected provider complete successfully (all build + verify + fix cycles work).
- Builds with Doubao (default) are unaffected.
- The retry log no longer shows `reasoning_content is missing` errors.

## Out of scope
- Changes to any Doubao-specific logic.
- UI changes.

## Tasks
1. **Collect `reasoning_content` during streaming** — In `runAgentLoop`, accumulate the `reasoning_content` from streaming deltas (it arrives on `delta.reasoning_content`, a non-standard field that Kimi adds). Cast the delta to `any` or use an extended type to safely access it without breaking TypeScript compilation.

2. **Include `reasoning_content` in the assistant history message** — When building `assistantMsg` to append to `messages`, attach `reasoning_content` when non-empty so that subsequent Kimi API calls see the complete prior turn.

## Relevant files
- `server/agent-loop.ts:76-123`
- `server/kimi-client.ts`