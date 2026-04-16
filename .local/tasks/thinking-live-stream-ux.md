# Thinking Live-Stream UX (Replit Agent style)

## Problem

Thinking (grey text) and final narration (white text) appear inside the same NarrationBubble div, mixed together:

```
[Thinking: ▼ toggle]            ← appears AFTER the white header below
  grey reasoning text...

Step 1/3: Create HTML file      ← white text (was already there from step_starting)
Writing: /project/index.html   ← white text (appears after thinking ends)
```

The white step header appears first (at step_starting). Then the grey thinking block pops in above it — feeling like both arrive together. Users cannot distinguish "thinking is happening now" from "thinking already finished."

## Goal

Match Replit Agent's pattern:
- Grey thinking text streams VISIBLY with a pulsing "Thinking…" indicator while the AI is reasoning
- Once thinking ends and tool-calls begin, the pulsing stops; thinking collapses to a static "(Thinking)" summary toggle
- Narration (Writing / Reading / Step N complete) flows clearly below the collapsed thinking

## Implementation plan

### 1. Add `typing` field to manager messages (ide-store.ts)
Extend the message shape:
```typescript
{ role: string; content: string; source?: ...; thinking?: string; typing?: boolean }
```

### 2. Mark message as `typing: true` at step_starting (chat-panel.tsx)
In the `step_starting` SSE handler, when `addManagerMessage` is called with the step header, immediately patch the new message to set `typing: true` via `useIDEStore.setState`.

### 3. Clear `typing` when thinking phase ends (chat-panel.tsx)
In the `step_completed / step_failed / step_cancelled` SSE handler, find `msgs[commMsgIndex]` and set `typing: false`. Also clear it when `narration_token` first fires (transition from thinking → working), so the collapse happens the moment Kimi calls its first tool.

### 4. Redesign NarrationBubble (chat-panel.tsx)

**While `message.typing === true` (AI is currently thinking):**
- Show a pulsing animated "Thinking…" header (pulsing dot + italic label, similar to Replit Agent)
- Render the grey thinking text INLINE — no toggle, no collapse — just flowing grey text so the user sees it streaming in real time
- Do NOT show the step-header content line while thinking is live (or show it very dimly above the thinking block)

**While `message.typing === false` and `message.thinking` exists (thinking done):**
- Collapse thinking to a static `(Thinking)` toggle (closed by default)
- Show the white narration content normally below it

**Visual layout (target):**
```
● Thinking…          ← pulsing while active, removed when done
  grey reasoning text streaming here...

Step 1/3: Create HTML file
Writing: /project/index.html
Step 1 complete: Created index.html
```

After step completes:
```
▶ (Thinking)         ← collapsed, click to expand
Step 1/3: Create HTML file
Writing: /project/index.html
Step 1 complete: Created index.html
```

### 5. Auto-scroll while thinking
The chat panel should auto-scroll to the bottom on each `thinking_token` so the user sees the latest reasoning text without manually scrolling.

## Relevant files

- `client/src/stores/ide-store.ts` — add `typing?: boolean` to message type
- `client/src/components/ide/chat-panel.tsx`:
  - `step_starting` handler (~line 2340): set `typing: true` on new message
  - `step_completed` handler (~line 2377): set `typing: false`
  - `narration_token` handler (~line 2367): set `typing: false` on first token
  - `NarrationBubble` component (~line 1505): redesign with pulsing vs collapsed states
  - Auto-scroll ref usage

## No backend changes needed
All changes are client-side rendering logic.
