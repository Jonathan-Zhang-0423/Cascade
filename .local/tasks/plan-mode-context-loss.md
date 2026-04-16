# Fix Plan-Mode Context Loss on Mode Switch

## What & Why
When a user is in Plan mode and the Manager shows a plan card, the intended execution path is clicking "Start building". But if the user manually toggles to Build mode and types anything (e.g. "开始搭建吧", "go ahead", "let's do it"), the message routes to the Vibe/Editor agent, which has no plan context. The Vibe agent responds as if starting fresh, discarding all planning work.

This happens because `handleCurrentSend()` checks `chatMode`:
- `chatMode === "manager"` → `handleManagerSend()` (knows the plan)
- `chatMode === "build"` → `handleSend()` (the Vibe/Editor agent — knows nothing)

When `managerPlan` is set and the user types in Build mode, the intent is always "execute the plan". Instead the Vibe agent gets the message and tries to respond to "开始搭建吧" without any prior context.

## Done looks like
- User is in Plan mode, Manager proposes a plan
- User toggles to Build mode and types "start building" / "开始搭建吧" / "let's go" / anything
- The plan executes (same as clicking "Start building") rather than the Vibe agent responding confusedly
- If the user is in Build mode with NO pending plan, typing still goes to the Vibe agent as before (unchanged)
- The fix also handles the case where the user stays in Plan mode and types "start building" — that message should trigger execution rather than regenerating a new plan

## Out of scope
- Redesigning the plan card UI
- Adding intent detection / NLP — the fix is purely structural

## Tasks

1. **Intercept send when plan is pending in Build mode** — In `handleCurrentSend`, add a guard: if `chatMode === "build"` and `managerPlan !== null` and execution is not already running, call `handleExecutePlan()` directly (discarding the typed text, which is just a "go" signal). This handles the mode-switch case.

2. **Intercept "go ahead" messages in Plan mode** — In `handleManagerSend`, detect if there's already an active `managerPlan` and the new message is a short "go ahead" signal (e.g. non-empty and `managerPlan` already set). In this case, call `handleExecutePlan()` instead of sending to the Manager API again. This prevents accidental plan regeneration when the user says "let's start" in Plan mode after a plan is shown.

3. **Show a hint in Build mode when plan is pending** — In the chat input area, when `chatMode === "build"` and `managerPlan !== null`, change the textarea placeholder to "Press Enter to start building your plan…" so the user knows what will happen.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:2141-2155` — `handleCurrentSend` (routing logic)
- `client/src/components/ide/chat-panel.tsx:1359-1462` — `handleManagerSend` (plan detection)
- `client/src/components/ide/chat-panel.tsx:1684-1709` — `handleExecutePlan` (plan execution)
- `client/src/components/ide/chat-panel.tsx:2285-2295` — chat textarea placeholder
