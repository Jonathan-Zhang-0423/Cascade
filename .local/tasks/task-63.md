---
title: Fix live narration streaming + AI language
---
# Fix live streaming and language output

## What & Why

Two bugs affect the Build Mode experience:

1. **Narration tokens dump at end instead of streaming live.** The current approach calls `flushSync` on every token inside an async loop, but React 18's automatic batching collapses those into a single paint — users see all narration text appear at once when the build completes rather than word-by-word as it streams.

2. **AI preamble text comes back in English even when user writes in Chinese.** The language instruction (`"Write your preamble in Chinese (中文)."`) is appended only to the user message. The model routinely ignores user-level format hints. The instruction needs to live in the system prompt where models reliably follow it.

## Done looks like

- During Build Mode execution, narration messages appear in the chat word-by-word as they stream from the server — no more waiting until a step finishes to see the text.
- When a Chinese-speaking user starts a build, the AI-generated preamble inside each narration message is written in Chinese, not English.
- The static step-start narration (e.g. "正在执行第1步：…") is already correct and must not regress.

## Out of scope

- Changing the streaming architecture (SSE stays as-is; this is a rendering and prompt fix only).
- Changing narration behavior in Plan Mode chat (the communicator agent flow).

## Tasks

1. **Replace `flushSync` with a `requestAnimationFrame` update loop** — In `handleExecutePlan`, store the streaming narration content in a `useRef` alongside the existing local variables. Start a `requestAnimationFrame` loop when a step begins and cancel it when the step ends. Each frame, compare the ref to the last-rendered content; if changed, call `useIDEStore.setState` once. This decouples token accumulation from rendering, lets the browser paint at 60 fps without blocking the SSE reader, and avoids React 18 batching issues with `flushSync`.

2. **Move language instruction into the editor system prompt at call time** — In `callEditor` in `server/build-orchestrator.ts`, when `userLang` is non-English, prepend a strong language directive to the `EDITOR_AGENT_SYSTEM_PROMPT` string that is passed as the first system message (e.g., `"IMPORTANT: Write ALL explanatory text and preamble in Chinese (中文). Code and file paths remain in their original language."`). Do the same in `callVerifier`. This makes the model reliably follow the language instruction.

## Relevant files

- `client/src/components/ide/chat-panel.tsx:2192-2420`
- `server/build-orchestrator.ts:114-195`
- `server/build-orchestrator.ts:195-260`