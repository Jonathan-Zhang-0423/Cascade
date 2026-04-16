# Model Provider Toggle (Doubao / Kimi K2.5)

## What & Why
Add a model selector toggle to the chat input toolbar so users can switch between
Doubao (current default) and Kimi K2.5 (Moonshot AI). Kimi K2.5 is an
OpenAI-compatible model with strong coding and agent capabilities.

Kimi API details:
- Base URL: `https://api.moonshot.ai/v1`
- Model name: `kimi-k2.5`
- API key env var: `KIMI_API_KEY`
- Fully compatible with the OpenAI Node.js SDK already in use

## Done looks like
- A model toggle button appears in the chat input toolbar, immediately to the right
  of the "Plan Mode" checkbox toggle.
- Clicking cycles between "Doubao" and "Kimi K2.5".
- The selected model is used for both Plan Mode (manager-chat) and Build Mode
  (build-session) agent loops.
- If `KIMI_API_KEY` is not set, the Kimi option is disabled with a tooltip explaining
  why (graceful degradation — Doubao always works).
- Secondary services (context compressor, mentor, smart-response, codestart generation)
  remain on Doubao.

## Out of scope
- Switching secondary services (compressor, mentor, smart-response)
- More than two providers
- Persisting the selection across page reloads (session-only is fine)

## Tasks

1. **Create `server/kimi-client.ts`** — Instantiate an OpenAI SDK client pointing to
   `https://api.moonshot.ai/v1` with `KIMI_API_KEY`, and export `kimiClient` and
   `KIMI_MODEL = "kimi-k2.5"`. Also export a helper `getAIClient(provider)` that
   returns `{ client, model }` for either `"doubao"` or `"kimi"`, making it the
   single source of truth for provider resolution on the server.

2. **Make `runAgentLoop` provider-agnostic** — Add an optional `{ client, model }`
   options field to `runAgentLoop`'s options parameter. When provided, use those
   instead of the hardcoded `doubaoClient` / `DOUBAO_MODEL`. The existing callers
   that don't pass these continue to work as before (backward compatible).

3. **Thread the provider through build-orchestrator and routes** — Update
   `BuildSessionState` to carry an optional `provider` field. Update `runBuildSession`
   and all `runAgentLoop` calls inside the orchestrator to pass `{ client, model }`
   from `getAIClient(session.provider)`. Do the same in `/api/manager-chat` — accept
   `provider` in the request body and pass the resolved `{ client, model }` to
   `runAgentLoop` and to the communicator narration `doubaoClient.chat.completions.create`
   call (switch the communicator to the selected provider too, for consistency).
   Also accept `provider` in the `/api/build-session` POST body.

4. **Add `selectedProvider` to the Zustand IDE store** — Add a
   `selectedProvider: "doubao" | "kimi"` field (default `"doubao"`) and a
   `setSelectedProvider` action to `useIDEStore`.

5. **Add the model toggle UI to the chat toolbar** — In `chat-panel.tsx`, insert a
   compact toggle button between the Plan Mode checkbox and the `flex-1` spacer
   (around line 2640). Show the active provider name as a small pill/button
   (e.g. "Doubao" or "Kimi K2.5") with a subtle icon. Clicking cycles the
   `selectedProvider`. Disable the Kimi option if the server reports
   `KIMI_API_KEY` is absent (add a `/api/providers` GET endpoint that returns
   `{ kimi: boolean }` based on whether the key is set). Add `data-testid="toggle-model-provider"`.

6. **Pass `provider` in fetch requests** — In `handleManagerSend` and
   `handleExecutePlan` in `chat-panel.tsx`, include `provider: selectedProvider`
   in the JSON body of the respective API calls.

## Note on API key
`KIMI_API_KEY` must be set in the environment for Kimi to work. The task executor
should add it via the Replit environment secrets tool. If it is not set, the Kimi
option is visually disabled in the UI (Doubao remains the active default).

## Relevant files
- `server/doubao-client.ts`
- `server/agent-loop.ts:1-71`
- `server/build-orchestrator.ts`
- `server/routes.ts:373-452,452-614`
- `client/src/components/ide/chat-panel.tsx:2620-2681`
- `client/src/store/ide-store.ts`
