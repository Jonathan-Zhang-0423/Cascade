# Fix Chat Messages Disappearing on Send

## What & Why
When the user types a message in the chat panel and presses Enter, the message instantly disappears and nothing appears — no user bubble, no AI response. This affects the core chat experience.

Root cause: `handleManagerSend` in `chat-panel.tsx` (lines 1689–1693) has an early-return block that fires whenever a `managerPlan` exists in the store. Instead of sending the user's message to the AI, it silently clears the input and tries to trigger plan execution, then returns — so the message is never added to the display and no AI response is generated. This intercepts ALL user messages in manager chat mode whenever any plan was previously created.

Build mode already handles plan-execution correctly in `handleCurrentSend` (lines 2089–2093), so this guard in `handleManagerSend` is redundant and harmful.

## Done looks like
- User types a message in the chat panel and presses Enter — the message appears in the chat and the AI responds.
- This works regardless of whether a `managerPlan` already exists in the store.
- Build mode behaviour is unchanged: pressing Enter in build mode when a plan exists still triggers plan execution.
- Plan mode (manager) chat always delivers messages to the AI.

## Out of scope
- Any other chat panel changes not related to this specific bug.

## Tasks
1. **Remove the silent intercept in `handleManagerSend`** — Delete lines 1689–1693 (the block `if (!overrideMessage && useIDEStore.getState().managerPlan && useIDEStore.getState().executingTaskIndex === null) { setInput(""); handleExecutePlanRef.current?.(); return; }`). This lets manager-mode messages always proceed to `addManagerMessage` and the AI call.

2. **Verify build mode plan-execution path is unaffected** — Confirm that `handleCurrentSend` still correctly handles `chatMode === "build"` + `managerPlan` + `!isExecuting` → `handleExecutePlan()`. No change needed there.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:1685-1693`
- `client/src/components/ide/chat-panel.tsx:2080-2095`
