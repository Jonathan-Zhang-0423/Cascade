---
title: Live narration streaming + language + plan card step progress
---
# Live Narration: Streaming + Language Fix + Plan Card Step Progress

## What & Why
Three issues in the build-session narration system to fix:

1. **Narration dumps at end, not live** — narration tokens update Zustand state but React doesn't paint each update to screen in real time. Fix: use `flushSync` from `react-dom` to force immediate commits.

2. **English narration in non-English sessions** — `session.userLang` is received by the server but never used. Static narration and AI agent preambles default to English. Fix: language-aware static narration + language instruction in Editor/Verifier prompts.

3. **Plan card step status not clear enough** — icons too small, done steps show with distracting strikethrough, running step not visually distinct, no progress indicator.

## Done looks like
- Narration messages in the chat panel (below the plan card) stream live — word-by-word as the agent works — NOT dumped at the end
- Narration is NOT shown inline inside the step rows of the plan card — it stays in the message list only
- Chinese sessions show Chinese narration text (static step announcements and AI preambles)
- Plan card: done steps have green tick (no strikethrough), running step has highlighted background, progress counter "X/Y" visible during build
- Both streaming validation tests pass

## Out of scope
- Showing narration inline inside step rows (explicitly excluded per user request: "do not show it inside the plan card, just show the live streamed narration message under the plan card in the chat panel")
- Modifying Plan Mode communicator narration (separate code path)

## Tasks
1. **Force live DOM paint per narration token (client)** — Import `flushSync` from `react-dom`. In the `narration_token` handler, wrap `addManagerMessage` (first token) and `setState({ managerMessages: updated })` (subsequent tokens) in `flushSync(...)`. Remove the `await setTimeout(r, 0)` yield.

2. **Language-aware static narration (server)** — Replace hardcoded English `"Working on step X: title."` and `"Fixing step X: title."` strings in `build-orchestrator.ts` with `stepNarrationText()` helper that returns the correct language (Chinese, Japanese, Korean, Spanish, French, English fallback). Emit as a single token.

3. **Language instruction in Editor and Verifier (server)** — Add `langInstruction(userLang)` helper. Append hint to editor user prompt (`callEditor`) and verifier context message (`callVerifier`). Pass `session.userLang` at all call sites.

4. **Redesign StepItem for clear step progress (client)** — Icons enlarged to w-3.5 h-3.5; done steps: green tick + plain muted text (no strikethrough); running step: subtle `bg-blue-500/8` background highlight; pending steps de-emphasized. Add "X/Y" progress counter in steps section header visible only when `isExecuting`.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:830-895,1038-1060,2249-2271`
- `server/build-orchestrator.ts:84-115,117-195,198-228,306-313,432-434`
