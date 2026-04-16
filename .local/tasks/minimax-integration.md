# MiniMax-M2.7 LLM Integration

  ## What & Why
  Add MiniMax-M2.7 as a third selectable AI provider alongside Doubao and Kimi. The LLM button in the IDE chat panel must become a dropdown (Select) so users can choose between all three providers. The user's last chosen provider must be saved globally in localStorage and restored when they return — no more re-selecting every session.

  ## Done looks like
  - A dropdown replaces the current binary Doubao/Kimi toggle in the IDE chat header, showing all configured providers: Doubao, Kimi K2.5, and MiniMax M2.7 (grayed-out/hidden if the API key is not set)
  - Selecting a provider immediately switches the active model for subsequent build/plan-mode calls
  - The selected provider is persisted globally (across all projects) to localStorage key `codestart-selected-provider` and is restored on page load
  - MiniMax calls stream correctly: thinking tokens from MiniMax appear in the NarrationBubble just like Doubao/Kimi thinking tokens
  - `MINIMAX_API_KEY` is registered as a required secret (via the environment-secrets skill); the executor must request this from the user if not set
  - `/api/providers` response includes `{ doubao, kimi, minimax }` availability flags

  ## Out of scope
  - Changing how Doubao or Kimi work (no regressions)
  - MiniMax video/image/TTS features

  ## Implementation notes
  - **MiniMax API**: OpenAI-compatible. Base URL: `https://api.minimax.io/v1`. Model: `MiniMax-M2.7`. API key env: `MINIMAX_API_KEY`.
  - **Thinking**: MiniMax requires `extra_body: { reasoning_split: true }` to separate thinking from content. The streaming delta exposes reasoning in `delta.reasoning_details` (array). In agent-loop, detect `isMinimaxModel` and add the `extra_body` param; emit `thinking_token` events from `delta.reasoning_details?.[0]?.text` (or check actual field name from the streaming response).
  - **AIProvider type** is currently defined in `server/kimi-client.ts` as `"doubao" | "kimi"`. Extend to `"doubao" | "kimi" | "minimax"` in that file; the frontend imports this type via its own local string literals — update `ide-store.ts` accordingly.
  - **Persistence**: `persistState` in `ide-store.ts` saves per-project state; `selectedProvider` must be saved separately under global key `codestart-selected-provider`. On store initialisation, read this key and set the default provider. Whenever `setSelectedProvider` is called, also write to this global key.
  - **Dropdown UI**: Replace the existing button (data-testid `toggle-model-provider`) in `chat-panel.tsx` with a shadcn `Select` component. Populate options dynamically from the `/api/providers` response. Use `data-testid="select-model-provider"`.

  ## Tasks
  1. **MiniMax server client & provider routing** — Create `server/minimax-client.ts` (OpenAI client at minimax base URL, MINIMAX_API_KEY), extend `AIProvider` type to include `"minimax"`, update `getAIClient` in `kimi-client.ts`, update `/api/providers` endpoint to include minimax availability.
  2. **MiniMax thinking in agent-loop** — In `agent-loop.ts`, detect MiniMax model and pass `extra_body: { reasoning_split: true }`; emit thinking_token events from the appropriate streaming delta field (`delta.reasoning_details?.[0]?.text` or similar — verify from live streaming response).
  3. **Provider persistence in IDE store** — In `ide-store.ts`, extend `AIProvider` type, initialise `selectedProvider` from global localStorage key `codestart-selected-provider` (fallback to `"doubao"`), and write to that key inside `setSelectedProvider`.
  4. **Dropdown UI in chat panel** — In `chat-panel.tsx`, fetch provider availability from `/api/providers`, replace the binary toggle button with a shadcn `Select` dropdown listing all available providers; update labels/i18n if needed.
  5. **Set MINIMAX_API_KEY secret** — Use the environment-secrets skill to check if `MINIMAX_API_KEY` is set; if not, request it from the user before finishing.

  ## Relevant files
  - `server/kimi-client.ts`
  - `server/agent-loop.ts`
  - `server/routes.ts`
  - `client/src/stores/ide-store.ts`
  - `client/src/components/ide/chat-panel.tsx`
  - `client/src/lib/i18n.ts`
  