# Agent Chat UI/UX Redesign — Spec

**Date:** 2026-04-28  
**Status:** Approved for implementation

---

## Context

The current agent chat UI suffers from visual noise that overwhelms users. The primary issues:

1. **Too noisy** — multiple competing panels (floating `ActionLogLive`, `ThinkingStream`, `AgentStatusLine`, narration bubbles) all visible simultaneously
2. **No persistence** — after returning to the app, the conversation shows only checkpoint rows and build artifacts with no summary of what happened
3. **Checkpoint clutter** — every build writes two full-width checkpoint rows (`Before build`, `Build complete`) that dominate the scroll area
4. **Error duplication** — connection errors appear multiple times as inline messages
5. **Dead resting state** — completed builds leave no agent voice; conversation dies

The redesign consolidates everything into one contained live panel per step, cleans up the resting state, and restores agent presence after each build via a narration summary + next-step suggestion.

---

## Design Decisions Summary

| Decision | Choice |
|---|---|
| Resting state | "Just the conversation" — clean by default |
| Live activity | Rich but calmer — one contained panel |
| Plan/Build modes | Keep separate toggle as-is |
| Checkpoints | Only most recent shown, as a subtle divider |
| Plan card after build | Collapsed to one line |
| Thinking stream placement | Inside live panel; collapses when narration starts |
| Summary/next-step | Plain narration bubble below the done card |

---

## Component Architecture

### 1. Live Panel (`BuildLivePanel`) — replaces `ActionLogLive` + `ThinkingStream`

A single self-contained component that renders during active build execution. Lives in the message list (not floating). Disappears completely at rest.

**Zones (top to bottom):**

```
┌─ BuildLivePanel ──────────────────────────────┐
│ ● Step title                        1 / N     │  ← header
├───────────────────────────────────────────────┤
│ 💭 Thought for Xs                    › expand │  ← thinking (collapsed after narration starts)
│   OR                                          │
│ Thinking ···                                  │  ← thinking (expanded while streaming)
│   [streaming reasoning text]                  │
├───────────────────────────────────────────────┤
│ [narration text streaming...]                 │  ← narration (left-border, no background)
├───────────────────────────────────────────────┤
│ ● reading: path/to/file.js                    │  ← file log (compact, last ~5 entries)
│ ● writing: path/to/file.js         ✓          │
└───────────────────────────────────────────────┘
```

**State transitions:**
- `thinking_token` received → thinking zone expanded, text streams
- `narration_token` received → thinking zone collapses to "Thought for Xs ›" chip; narration zone appears and streams
- `action_log` received → file log row appended (indigo dot = read, green dot = write)
- `step_completed` / `step_failed` → panel for this step finalizes (stops animating)
- `done` → entire `BuildLivePanel` removed from message list; replaced by done card + narration bubble

**Thinking collapse timing:** Collapse the thinking block the moment the first `narration_token` arrives. Record elapsed thinking time (from first `thinking_token` to first `narration_token`) to display as "Thought for Xs".

**File log:** Max 5 most recent entries. No flash animations. Indigo dot for reads, green dot for writes. Monotext filename only, no full path unless it fits.

---

### 2. Done Card (`BuildResultCard`) — replaces `TaskPlanCard` post-build

A collapsed single-line artifact. Tapping expands to show full step list, thinking traces, and file diffs (future).

```
┌─────────────────────────────────────────────┐
│ ✓  Build summary title      file.js  +2  ›  │
└─────────────────────────────────────────────┘
```

- Left: green checkmark icon
- Center: plan summary (from `ManagerPlan.summary`)
- Right: file chips (up to 3, then "+N more"), expand arrow
- Background: `#141420`, border `#2a2a3a`, radius 8px — same as current collapsed style
- **No text inside the card itself.** Pure artifact.

On expand (tap `›`): show full step list with status dots, file list, completion percentage from review.

---

### 3. Post-Build Narration Bubble — new

After the done card, the communicator agent emits a plain narration message (left-border style, no background) containing:

1. **Summary paragraph** (1–3 sentences): what was changed, which files, why. Specific — references actual function names and files, not generic.
2. **Next step suggestion** (1 sentence, prefixed with `→`): a concrete actionable suggestion to continue the conversation.

**Rendering:** Uses the existing communicator narration bubble style (`border-left: 2px solid #4a4a7a`, no background fill, `color: #b0b0d0`). Not a new component — same as how communicator narration is already rendered in `plan-components.tsx`.

**Data source:** The `all_complete` SSE event already carries `summaryText`. The communicator prompt needs a new output field: `nextStepSuggestion` (one sentence string). The client emits this as a `ManagerMessage` with `source: "communicator"` after receiving `all_complete`.

---

### 4. Checkpoint Dividers — simplified

**Rule:** Only the most recent checkpoint is shown inline. All others are hidden.

**Visual:** Thin horizontal rule (`height: 1px, opacity: 0.4`) with "restore · Xhr ago" in 9px dim text, centered. No restore button visible inline — accessible via a history panel or long-press (future).

**Implementation:** In `ChatMessageList.tsx`, filter checkpoint messages so only the last one (highest `seq` among `role === "checkpoint"` messages) renders as a divider. All others render `null`.

---

### 5. Error Messages — deduplication

Connection errors (`构建连接中断，请重试`) currently appear as multiple separate messages. 

**Rule:** Consecutive error messages of the same type are collapsed into one. If an error is already the last message and the same error arrives again, update the timestamp but do not add a new message. Implement in `useBuildStream.ts` before calling `addChatMessage` for errors.

---

### 6. AgentStatusLine — keep as-is

The `AgentStatusLine` component (phase dot + label + elapsed time) is working well and stays unchanged. It already correctly communicates the current phase without adding visual noise.

---

## Data Flow Changes

### Server: `all_complete` event — add `nextStepSuggestion`

The communicator agent (in `server/communicator-prompt.ts`) currently produces `summaryText`. Add a second output field `nextStepSuggestion: string` — one sentence, concrete, conversational.

Update the `all_complete` SSE payload in `server/build-orchestrator.ts`:
```ts
{ changedFiles, summary, summaryText, nextStepSuggestion }
```

Update `shared/schema.ts` / `BuildResultData` type to include `nextStepSuggestion?: string`.

### Client: `useBuildStream.ts` — `all_complete` handler

On receiving `all_complete`:
1. Write the done card (existing `saveBuildResult` logic → produces `ManagerMessage` with `buildResult`)
2. After writing the done card, call `addManagerMessage({ role: "assistant", source: "communicator", content: summaryText + "\n\n→ " + nextStepSuggestion })` — this produces the plain narration bubble below the card

### Client: `useBuildStream.ts` — thinking collapse tracking

Add local state:
- `thinkingStartTime: number | null` — set on first `thinking_token`
- `thinkingElapsedSec: number | null` — set when first `narration_token` arrives

Pass `thinkingElapsedSec` to `BuildLivePanel` so it can display "Thought for Xs".

### Client: `ChatMessageList.tsx` — checkpoint filtering

Before rendering, find the max `seq` among all checkpoint messages. Only render that one; render `null` for all others.

---

## Files to Create / Modify

| File | Change |
|---|---|
| `client/src/components/ide/chat/BuildLivePanel.tsx` | **New** — replaces `ActionLogLive` during build execution |
| `client/src/components/ide/chat/action-log.tsx` | Remove or gut `ActionLogLive`; keep `ActionLogCollapsed` for expand view |
| `client/src/components/ide/chat/plan-components.tsx` | Add `BuildResultCard` component (collapsed line, post-build only). `TaskPlanCard` planning/building/verifying phases remain **unchanged** — only the final "done" state is replaced by `BuildResultCard` |
| `client/src/components/ide/chat/ChatMessageList.tsx` | Add checkpoint filtering (last only); wire `BuildLivePanel` in place of `ActionLogLive` |
| `client/src/components/ide/chat/hooks/useBuildStream.ts` | Add thinking elapsed tracking; update `all_complete` handler to emit narration bubble; add error deduplication |
| `server/communicator-prompt.ts` | Add `nextStepSuggestion` output field to prompt |
| `server/build-orchestrator.ts` | Include `nextStepSuggestion` in `all_complete` SSE payload |
| `shared/schema.ts` | Add `nextStepSuggestion?: string` to `BuildResultData` |
| `client/src/components/ide/chat-panel.tsx` | Remove wiring for separate `ActionLogLive` live panel; wire `BuildLivePanel` instead |

---

## What Stays the Same

- `AgentStatusLine` — unchanged
- `useManagerStream.ts` — unchanged (plan mode pipeline untouched)
- Plan mode UI (communicator narration, `TaskPlanCard` in planning phase, execute/revise buttons) — unchanged
- `MobileChatPanel` — apply same changes after desktop is validated
- Provider selector, mode toggle, input area — unchanged

---

## Verification

1. Start dev server (`npm run dev`)
2. Open a project, send a message in Build mode
3. **Live phase:** Confirm single contained panel appears — thinking streams, collapses on first narration token, file log rows appear compactly
4. **Completion:** Confirm live panel disappears, done card + plain narration bubble appear below it
5. **Narration bubble:** Has no background, left-border only, contains summary + `→` next step
6. **Checkpoints:** Only the most recent restore divider is visible; older ones absent
7. **Reconnect:** Close and reopen the app mid-session; confirm state restores correctly
8. **Error dedup:** Simulate connection drop; confirm error appears once, not multiple times
9. **Plan mode:** Confirm plan flow is completely unaffected
