# Enable Doubao Thinking (reasoning_effort: medium)

## What

Doubao's `doubao-seed-2-0-code-preview-260215` and `doubao-seed-2-0-lite-260215` models support
a `thinking` parameter in the API request that enables extended reasoning (chain-of-thought output
in `delta.reasoning_content`). Currently the parameter is missing, so Doubao runs without thinking.

The client-side streaming infrastructure is already in place — `agent-loop.ts` already reads
`delta.reasoning_content` and emits `thinking_token` events, and the new NarrationBubble (Task #86)
renders them as a live-streaming block. Only the server-side API parameter is missing.

Kimi K2.5 already has thinking built in and does NOT need this change.

## Change

In `server/agent-loop.ts`, detect whether the active model is a Doubao model and inject the
`thinking` parameter:

```typescript
const isDoubaoModel = activeModel.toLowerCase().includes("doubao");
const thinkingParam = isDoubaoModel
  ? { thinking: { type: "enabled", budget_tokens: 8192 } }
  : {};

activeClient.chat.completions.create(
  {
    model: activeModel,
    messages,
    ...thinkingParam,
    tools: ...,
    tool_choice: ...,
    stream: true,
    max_tokens: 16384,
  } as any,   // `thinking` is Doubao-specific, not in OpenAI SDK types
  { timeout: 30_000 },
)
```

`budget_tokens: 8192` corresponds to medium reasoning effort (low ≈ 2048, medium ≈ 8192, high ≈ 16384).

## Notes

- The `as any` cast is needed because the OpenAI TypeScript SDK doesn't define `thinking` in its
  request type — Doubao extends the OpenAI-compatible API with this non-standard field.
- The context compressor (`server/context-compressor.ts`) calls the Doubao lite model directly for
  simple summarization — thinking should NOT be enabled there (unnecessary cost and latency).
- The `runAgentLoop` function signature doesn't need changes; the thinking param is injected
  internally based on `activeModel`.
- The timeout in the `withRetry` call is currently 30 s — once thinking is enabled, Doubao's
  first token may take longer. Consider increasing to 90 s for Doubao models.

## Relevant files

- `server/agent-loop.ts` lines 60–73 (the `chat.completions.create` call)
