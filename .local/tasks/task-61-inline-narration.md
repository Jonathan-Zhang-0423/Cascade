# Live Narration + Plan Card Step Progress

## What & Why
Three issues to fix in the build experience:

1. **Narration dumps at end, not live** — narration tokens are added to Zustand state but React doesn't paint each update to the screen in real time. The `await setTimeout(r, 0)` yield between tokens is not reliably triggering DOM paints. Need to use `flushSync` from `react-dom` to force an immediate commit after each token update.

2. **English text in Chinese sessions** — `session.userLang` is received by the server but never used. The static step announcement ("Working on step X: title.") is hardcoded English. The Editor and Verifier agents have no language instruction, so they default to English preambles regardless of the user's project language.

3. **Plan card step status not prominent enough** — the existing status icons (spinner, green tick, circle) are 12px and done steps show with strikethrough text which is hard to read. The user wants clear, immediate visual feedback: green ticks for done steps, a clear highlight on the active step, and no line-through styling.

## Done looks like
- During a build, narration messages appear in the chat message list (below the plan card) **word-by-word as the agent works** — visibly streaming live, not dumped at the end
- Narration is NOT shown inline inside the step rows — it stays in the message list only
- When the user's project is in Chinese, ALL narration is in Chinese — static announcements ("正在执行第1步：...") and AI-generated Editor/Verifier preambles
- In the plan card, done steps show a prominent green tick with plain (not strikethrough) muted text; the currently-running step has a subtle highlighted background row so it stands out clearly; pending steps are visually de-emphasized; there is a small "X/Y steps done" counter visible at the top of the steps section during a build
- Both streaming validation tests still pass

## Out of scope
- Showing narration inline inside step rows (explicitly excluded per user request)
- Changing the plan card's "what and why" / "done looks like" sections
- Modifying Plan Mode communicator narration (separate code path)

## Tasks

1. **Force live DOM paint per narration token (client)** — In `handleExecutePlan`'s `narration_token` handler, import `flushSync` from `react-dom`. Wrap each Zustand state update in `flushSync(...)`: on the first token use `flushSync(() => addManagerMessage(...))`, on subsequent tokens use `flushSync(() => useIDEStore.setState({ managerMessages: updated }))`. Remove the `await new Promise<void>(r => setTimeout(r, 0))` that follows — it is no longer needed. This ensures every token immediately paints to the DOM.

2. **Language-aware static narration (server)** — In `build-orchestrator.ts`, replace hardcoded English strings `"Working on step X: title."` and `"Fixing step X: title."` with language-aware equivalents using `session.userLang`. For Chinese, emit `"正在执行第X步：title。"` and `"正在修复第X步：title。"` as a single narration_token (no need to split character-by-character). Keep English as fallback for all other languages. Do the same for the reviewing phase if it has static text.

3. **Language instruction in Editor and Verifier (server)** — Add `userLang` as a parameter to `callEditor` and `callVerifier` functions in `build-orchestrator.ts`. Pass `session.userLang` at all call sites (main loop + fix cycle). Inside each function, append a language instruction to the messages sent to the AI: if userLang is Chinese, add "Write your preamble/summary in Chinese (中文)." at the end of the user message. Update both the main-loop calls and the fix-cycle calls.

4. **Redesign StepItem for clear step progress (client)** — Refactor `StepItem` in the plan card:
   - **Done**: larger green check icon (w-4 h-4), muted text (no line-through), text color `text-muted-foreground`
   - **Running**: same or slightly larger blue spinner, step title in `text-foreground font-medium`, and a subtle highlighted row background (e.g. `bg-primary/5 rounded-md px-2 -mx-2`) so it clearly stands out as the active step
   - **Pending**: keep small gray circle, text `text-foreground/50`
   - Add a small progress counter "X/Y" at the top-right of the steps section header in `TaskPlanCard`, visible only when `isExecuting` is true and at least one step is done

## Relevant files
- `client/src/components/ide/chat-panel.tsx:830-883,964-1090,2183-2265`
- `server/build-orchestrator.ts:60-220,258-300,380-430`
- `server/editor-prompt.ts`
- `server/verifier-prompt.ts`
