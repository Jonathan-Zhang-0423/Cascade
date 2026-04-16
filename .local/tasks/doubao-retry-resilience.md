# Doubao API Retry & Resilience

## What & Why
The agent occasionally shows "哎呀，现在连不上团队！请稍后再试" when the Doubao API has a transient hiccup. Currently there is zero retry logic — a single failed request immediately surfaces the error to the user. Adding retries with exponential backoff and a configurable timeout will absorb most intermittent failures invisibly.

## Done looks like
- A transient Doubao API error (network blip, brief rate-limit) triggers an automatic retry (up to 3 attempts) before the error message is ever shown to the user
- A per-request timeout (e.g. 30 s) prevents the agent from hanging indefinitely on a stalled connection
- If all retries are exhausted, the existing "chat.errorConnect" message is shown as before — behaviour is unchanged for genuine outages
- Server logs clearly show each retry attempt and the final outcome

## Out of scope
- Changing the Doubao model or API endpoint
- Client-side retry (retries happen server-side only)
- Changing the error message wording shown to users

## Tasks
1. **Add a retry-aware wrapper around Doubao streaming calls** — Write a helper (e.g. `withRetry`) in `server/doubao-client.ts` or a new `server/utils/retry.ts` that retries a given async factory function up to N times with exponential backoff (100 ms → 200 ms → 400 ms), re-throwing only after all attempts fail.

2. **Apply retry wrapper to `runAgentLoop`** — Wrap the `doubaoClient.chat.completions.create(...)` call inside `server/agent-loop.ts` with the retry helper, and add a per-request timeout (30 s) using `AbortSignal.timeout` or the OpenAI SDK's `timeout` option.

3. **Apply retry wrapper to the Communicator call in `server/routes.ts`** — The communicator narration stream (`doubaoClient.chat.completions.create` at line ~552) should also be wrapped so narration failures are retried before falling back to the `communicator_error` event.

4. **Add server-side retry logging** — Log each retry attempt (attempt number, error message, delay) via `console.warn` so failures are visible in server output without being noisy in the happy path.

## Relevant files
- `server/doubao-client.ts`
- `server/agent-loop.ts`
- `server/routes.ts:518-606`
