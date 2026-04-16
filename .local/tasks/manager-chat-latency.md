# Manager Chat Latency Fixes

## What & Why
Every message sent to the Plan Mode manager currently triggers 2–3 sequential LLM calls instead of 1, making follow-up messages like "按钮会保存到localStorage" noticeably slow. Three concrete bugs cause this:

1. **Redundant `read_project_files` tool call** — project files are already injected into the manager's system prompt via `buildManagerContextMessage`. The agent loop still lets the model call `read_project_files` as a tool, which wastes a full LLM round-trip fetching content it already has. Removing this tool (or strongly discouraging it in the prompt) cuts the loop from 2 LLM calls to 1 for the common case.

2. **`compressMessages` is a dead import** — `server/context-compressor.ts` exists and is imported in `routes.ts` but is never actually called. Long conversations accumulate unbounded context, making each LLM call slower and more expensive over time. Wire it up.

3. **SSE headers flushed after async work** — `res.flushHeaders()` is called on line 476 of `routes.ts`, *after* `detectSkillFromText` (line 469) and `loadSkill` (lines 499–502) both await. The browser receives zero bytes until all that completes. Moving `res.flushHeaders()` to before the async steps makes the connection feel instant.

## Done looks like
- A follow-up clarification message in Plan Mode (Stage 1 or 2) triggers **one** LLM call, not two or three.
- Long planning conversations (>10 messages, >25k estimated tokens) compress older history before sending to the LLM.
- The SSE stream opens immediately when a message is sent — the browser does not wait for skill detection before receiving the first byte.
- Both streaming validation tests continue to pass.

## Out of scope
- Changing the manager's three-stage flow or prompt logic.
- Removing the skill library or context compressor features entirely.
- Frontend changes.

## Tasks

1. **Remove `read_project_files` from manager tools** — Delete the `read_project_files` schema and handler from `buildManagerTools` in `server/agent-tools.ts`. Update the manager system prompt in `server/manager-prompt.ts` to clarify that project file content is already available in the system context and no file-reading tool is needed. This eliminates the extra LLM round-trip that currently occurs on nearly every message.

2. **Wire up context compression** — In `server/routes.ts`, call `compressMessages(messages)` on the incoming messages array before passing them to `runAgentLoop`. The function is already imported and implemented; it just needs to be called. This ensures long conversations don't silently accumulate unbounded context.

3. **Flush SSE headers before async work** — Move `res.setHeader(...)` calls and `res.flushHeaders()` to before `detectSkillFromText` and `loadSkill` in the `/api/manager-chat` handler. The skill content can still be appended to `systemPrompt` after detection — the only change is that the HTTP connection is established immediately so the browser is not left waiting.

## Relevant files
- `server/routes.ts:452-600`
- `server/agent-tools.ts:308-420`
- `server/manager-prompt.ts:1-120`
- `server/context-compressor.ts`
- `server/skill-loader.ts`
- `tests/plan-mode-streaming.ts`
- `tests/build-session-streaming.ts`
