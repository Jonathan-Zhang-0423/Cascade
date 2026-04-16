# Redesign Manager Mode → Plan Mode (Replit-style)

## What & Why

The current "Manager Mode" always responds with JSON task plans. Replit's Plan Mode is fundamentally
different: it's a **conversational planning assistant** that can brainstorm ideas, answer questions,
discuss approaches, and only generates a task list when the user is ready to build. The user then
clicks "Start building" and the mode automatically switches to Build Mode to begin execution.

This redesign transforms our Manager Mode to work identically to Replit's Plan Mode.

## Done looks like

- Mode selector label changes from "Manager" to "Plan" everywhere in the UI
- In Plan Mode the AI can hold a multi-turn conversation: answer questions, brainstorm, discuss approaches — no task list generated unless the request is clearly "build X"
- When the request IS a build request, a task plan card appears (existing TaskPlanCard component, unchanged)
- Clicking "Start building" on the plan card automatically switches the mode label to "Build" and immediately begins executing the plan steps (Editor + Verifier + Fix cycle, all unchanged)
- Conversational Plan Mode responses render as proper friendly chat bubbles (not italic/muted), visually distinct from user bubbles but cohesive with Build Mode style
- The full merged timeline continues to show both Build and Plan Mode messages chronologically

## Out of scope

- Changes to the Editor Agent, Verifier Agent, fix-cycle logic, or Communicator narration pipeline (all unchanged)
- Changes to Build Mode (Vibe Agent)
- Per-step verification or any new agent roles

## Tasks

1. **Rewrite Manager Agent prompt for conversational planning** — Update `server/manager-prompt.ts` system prompt so the Manager Agent can: (a) have free-form conversations (answer questions, brainstorm, guide) and (b) generate a structured task plan only when the user's request is a clear build instruction. New JSON output must distinguish the two: `{ "type": "message", "content": "..." }` for conversation or `{ "type": "plan", "summary": "...", "steps": [...], "needs_input": [] }` for a task plan. Keep the existing `MANAGER_FIX_MODE_SYSTEM_PROMPT` unchanged.

2. **Update `/api/manager-chat` route to handle dual output** — In `server/routes.ts`, after calling the Manager Agent, parse the new dual-output format. If `type === "message"`, return `{ message: "..." }`. If `type === "plan"`, return `{ plan: {...} }` (existing behavior). Handle errors gracefully.

3. **Handle conversational responses in `handleManagerSend`** — In `chat-panel.tsx`, update `handleManagerSend` to handle the new `{ message: "..." }` response from `/api/manager-chat`. Add the message to `managerMessages` with `source: "communicator"` so it renders as visible text.

4. **Improve conversational bubble rendering** — In `ManagerMessageBubble`, render conversational messages (those without `source: "manager_raw"` and without a plan) as proper chat bubbles with a small "Plan" agent avatar/label — not just muted italic text. Should look like a proper AI message bubble.

5. **Auto-switch to Build Mode on "Start building"** — In `TaskPlanCard` (inside `chat-panel.tsx`), when the "Start building" button is clicked (`onExecute`), call `setChatMode("vibe")` before invoking the execution pipeline. This visually switches the mode selector to "Build" as execution begins. Import `setChatMode` from `useIDEStore` inside the component.

6. **Rename all "Manager Mode" labels to "Plan Mode"** — Search the entire codebase for all user-facing strings "Manager", "Manager Mode", "manager" (in UI labels, placeholders, tooltips, mode selectors, typing indicators) and rename them to "Plan" / "Plan Mode". The internal state value `"manager"` in `chatMode` can stay as-is for code compatibility. Focus on: mode dropdown/selector text, typing indicator text ("Planning..."), chat input placeholder, any header or tooltip text.

## Relevant files

- `server/manager-prompt.ts`
- `server/routes.ts:146-194`
- `client/src/components/ide/chat-panel.tsx:794-975,1208-1262`
- `client/src/stores/ide-store.ts:80-90,220-280`
