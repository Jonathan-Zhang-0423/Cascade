# GLM-5 AI Provider Integration

## What & Why
Add ZhipuAI's GLM-5 as a fourth selectable AI provider alongside Doubao, Kimi K2.5, and MiniMax M2.7. The user has already stored `GLM_API_KEY` in secrets. GLM-5 is OpenAI-compatible (base URL `https://open.bigmodel.cn/api/paas/v4`), supports streaming, and has thinking **enabled by default** — configured via `extra_body: { thinking: { type: "enabled" } }` in the API call. Its streaming thinking tokens arrive on `delta.reasoning_content` (same field as Doubao/Kimi, so no new token-parsing is needed in agent-loop).

## Done looks like
- The provider dropdown in the chat panel shows "GLM-5" as a fourth option when `GLM_API_KEY` is set
- Selecting GLM-5 and sending a message routes the request through the GLM-5 API with thinking and streaming active
- Thinking tokens appear in the UI just like with other providers
- `/api/providers` returns `{ doubao, kimi, minimax, glm }` availability flags
- If `GLM_API_KEY` is missing, GLM-5 is hidden from the dropdown and any persisted "glm" selection falls back to "doubao"
- Provider choice persists across page refreshes (same localStorage key as other providers)

## Out of scope
- Preserved thinking / interleaved thinking (advanced GLM features)
- Any changes to tool-calling or function-calling logic
- Pricing or quota display

## Tasks
1. **GLM server client** — Create `server/glm-client.ts` exporting a `glmClient` (OpenAI instance at `https://open.bigmodel.cn/api/paas/v4`, using `GLM_API_KEY`) and a `GLM_MODEL = "glm-5"` constant.

2. **Provider registry & routing** — Extend `AIProvider` type to include `"glm"`, add a `getAIClient("glm")` case (fallback to Doubao if key missing), add `glm: !!GLM_API_KEY` to `/api/providers`.

3. **Agent-loop GLM handling** — Add `isGLMModel` detection. For GLM, skip the top-level `thinking` parameter and instead pass `extra_body: { thinking: { type: "enabled" } }`. Include GLM in the 90-second timeout group. The `delta.reasoning_content` path that already exists covers GLM thinking tokens.

4. **Frontend — provider state & dropdown** — Extend `AIProvider` in `ide-store.ts` to include `"glm"`. In `chat-panel.tsx`, add `glm: boolean` to the providers state, fall back to `"doubao"` if the saved provider is `"glm"` and `!loaded.glm`, and add a "GLM-5" dropdown item (shown only when `providers.glm`) with a distinct badge colour (e.g. blue/cyan).

## Relevant files
- `server/glm-client.ts`
- `server/minimax-client.ts`
- `server/kimi-client.ts`
- `server/agent-loop.ts:59-68`
- `server/routes.ts:377-383`
- `client/src/stores/ide-store.ts`
- `client/src/components/ide/chat-panel.tsx`
