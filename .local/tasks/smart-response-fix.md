# Fix Smart Response Button

## What & Why

Two bugs with the "smart response" button (the sparkle icon in the chat input area):

1. **Clicking produces nothing** — When the chat is in "manager/plan" mode, the message list sent to the server includes messages with `role: "checkpoint"`. This is an invalid OpenAI-compatible API role ("checkpoint" is not "user", "assistant", or "system"), which causes the Doubao API to reject the request with a 400 error. The client-side `catch {}` block is completely empty so the error is silently swallowed — the spinner appears and disappears with nothing filled in.

2. **Suggested text appears in the wrong language** — The system prompt says "match the language of the conversation" but the last injected message is always in English (`"[Generate a suggested response…]"`). Doubao Lite tends to follow the language of the most recent message, so it replies in English even when the conversation is in Chinese.

## Done looks like

- Clicking the smart response button reliably fills the input with a suggested message in both chat modes (plan/build).
- When the conversation is in Chinese, the suggestion is in Chinese; when in English, the suggestion is in English.
- If the API call fails, a small toast or console error makes the failure visible in dev.

## Out of scope

- Redesigning the smart response UI
- Supporting languages other than Chinese and English

## Tasks

1. **Fix message filtering on the client** — In `handleSmartResponse`, filter out messages with `role === "checkpoint"`, `typing === true`, or empty `content` before sending them to the server. This is the root cause of "nothing appearing" in manager mode. Also add a `catch` log/toast so failures are no longer silent.

2. **Detect conversation language and pass it to the server** — After filtering messages, scan them for Chinese characters (using a simple regex like `/[\u4e00-\u9fff]/`). If found, set `language: "Chinese"`, otherwise `language: "English"`. Include this in the POST body.

3. **Fix language enforcement on the server** — Replace the vague "Match the language of the conversation" instruction with an explicit `"You MUST respond only in [language]."` directive at the top of the system prompt, using the `language` field from the request body. Also reduce `max_tokens` from 16384 to 400 (smart responses are 1–4 sentences).

## Relevant files

- `client/src/components/ide/chat-panel.tsx:2566-2589`
- `server/routes.ts:1157-1211`
