---
title: Fix slow manager agent response time (25-35s to first narration)
---
# Fix Prompt Delivery Failures

## What & Why
User prompts are silently dropped and lost in multiple scenarios. The `handleManagerSend` guard at line 124 of `useManagerStream.ts` silently returns when `isManagerResponding` or `isAiResponding` is true, but the calling code (`handleCurrentSend`) clears the input field regardless, losing the user's typed message with zero feedback. Similarly, `pendingPrompt` (the initial prompt from project creation) is cleared even when the guard blocks the actual send. This makes the chat appear broken — the user types, clicks send, their message disappears, and nothing happens.

## Done looks like
- When a send is blocked (because a previous session is reconnecting or responding), the user sees a visible indicator (toast or inline message) explaining the chat is busy
- The typed message is NOT cleared from the input if the send was blocked — the user can retry
- `pendingPrompt` is only cleared after the message is confirmed sent (not on silent early return)
- `handleManagerSend` returns a boolean indicating whether the send actually proceeded
- After reconnection completes (typically 1-3 seconds), the user can immediately send without any stuck state

## Out of scope
- Changing the reconnection strategy itself (that's a separate task)
- Modifying server-side session handling
- Changing the SSE streaming protocol

## Tasks
1. **Make `handleManagerSend` return success/failure** — Change the guard clause to return `false` when the send is blocked, return `true` on successful send initiation. The async function signature becomes `Promise<boolean>`.

2. **Prevent input clearing on blocked send** — In `handleCurrentSend`, check the return value of `handleManagerSend`. Only call `setInput("")` if the send succeeded. Same for `handleEditorSend`.

3. **Fix `pendingPrompt` loss** — In the `pendingPrompt` effect, only set `pendingHandled.current = true` and call `clearPendingPrompt()` if `handleManagerSend` actually returns `true`. If blocked, leave `pendingHandled.current = false` so the effect re-fires when the blocking flags clear.

4. **Add user-facing feedback when send is blocked** — Show a brief toast or inline indicator when the guard blocks a send, telling the user the agent is still processing/reconnecting and to try again in a moment. Use the existing toast system.

5. **Add safety timeout for `isManagerResponding`** — If `isManagerResponding` has been `true` for more than 120 seconds without any SSE activity, auto-reset it to `false`. This prevents permanent lockout from broken sessions. Implement via a ref-based timer that resets on each SSE event and fires `setManagerResponding(false)` on expiry.

## Relevant files
- `client/src/components/ide/chat/hooks/useManagerStream.ts:121-210`
- `client/src/components/ide/chat-panel.tsx:160-204`
- `client/src/components/ide/chat/hooks/useEditorStream.ts`
- `client/src/stores/ide-store.ts:259,273,965,1121`