# Fix: Narration and Thinking Text Must Stream Visibly in ActionLogLive

## Problem Statement

After Task #96 fixes, the ActionLogLive panel IS appearing at the bottom of the chat. But
the streaming narration text (from `narration_token` events) and the full thinking text are
NOT visible in it. Here's why:

### narration_token handler (line 2793–2798):
```ts
} else if (type === "narration_token") {
  clearTypingOnCurrentMsg();    // ← removes "Reasoning…" from step-header
  commAccumulated += ev.token || "";
  flushNarrationToStore();      // ← writes narration into step-header message (managerMessages)
  setBuildPhase("working");
  await new Promise<void>(r => setTimeout(r, 0));
}
```
- `flushNarrationToStore` changes `managerMessages` → the scroll effect fires → scroll goes
  to `scrollTop = scrollHeight` → **ActionLogLive** is the absolute last element.
- The narration text is written into the **step-header NarrationBubble**, which lives in the
  messages list ABOVE ActionLogLive. After the scroll, it is off-screen.
- The user sees ActionLogLive at the bottom with file entries — but no streaming narration.

### thinkingText in ActionLogLive (line 96–102):
```tsx
<span className="truncate leading-tight italic text-muted-foreground/70">
  {thinkingText.split("\n").filter(Boolean).pop()?.slice(0, 80) || "Thinking…"}
</span>
```
- ActionLogLive already shows thinking text, but only the **last non-empty line, truncated
  to 80 chars**. This is barely useful for long thinking models (Kimi, GLM).
- The full thinking content is in the NarrationBubble (off-screen).

## The Fix

### Principle
**All live streaming content (thinking + narration) should appear inside ActionLogLive**
(which is at the absolute bottom and always in view). The NarrationBubble (step-header
message) is the permanent historical record — it should only be finalized at `step_completed`.

### Changes to `handleExecutePlan` in `chat-panel.tsx`

**1. Add `liveNarrationText` state (alongside existing `liveThinkingText`):**
```ts
const [liveNarrationText, setLiveNarrationText] = useState("");
```

**2. Reset `liveNarrationText` in `resetNarration` (or in `step_starting` local block):**
After the `setLiveThinkingText("")` call in `step_starting` local block, add:
```ts
setLiveNarrationText("");
```

**3. Change `narration_token` handler — stop updating NarrationBubble mid-step:**
```ts
} else if (type === "narration_token") {
  // DON'T call clearTypingOnCurrentMsg() — step-header keeps "Reasoning…" indicator
  // DON'T call flushNarrationToStore() — defer to step_completed
  commAccumulated += ev.token || "";
  setLiveNarrationText(commAccumulated);   // ← stream into ActionLogLive instead
  setBuildPhase("working");
  await new Promise<void>(r => setTimeout(r, 0));
}
```

**4. Clear `liveNarrationText` when action_log fires (tool calls start):**
In the `action_log` handler, after clearing `thinkingAccumulated`, also clear
`liveNarrationText`:
```ts
if (thinkingAccumulated) {
  ...
  thinkingAccumulated = "";
  setLiveThinkingText("");
}
setLiveNarrationText("");   // ← ADD: narration is done, tool calls take over
appendActionLog({ type: actionType, label, detail, timestamp: Date.now(), filePath });
```

**5. Flush narration to step-header at `step_completed` (already calls flushNarrationToStore):**
`step_completed` already calls `clearTypingOnCurrentMsg()` and `flushNarrationToStore()`.
Also add `setLiveNarrationText("")` here:
```ts
} else if (type === "step_completed" || type === "step_failed" || type === "step_cancelled") {
  clearTypingOnCurrentMsg(); finalizeEditor(); flushNarrationToStore();
  setLiveNarrationText("");   // ← ADD
}
```

**6. Clear in `done` and `reviewing` handlers (alongside `setLiveThinkingText("")`):**
```ts
// done handler:
setLiveThinkingText(""); setLiveNarrationText("");

// reviewing handler reset:
// (resetNarration is called which now clears commAccumulated; also call:)
setLiveNarrationText("");
```

**7. Update ActionLogLive component — add `narrationText` prop:**
```tsx
function ActionLogLive({
  entries,
  thinkingText,
  narrationText,         // ← ADD
}: {
  entries: ActionLogEntry[];
  thinkingText?: string;
  narrationText?: string; // ← ADD
}) {
  const last5 = entries.slice(-5);
  ...
  return (
    <div className="px-3 py-2 space-y-1">
      {thinkingText && (
        <div className="flex items-center gap-1.5 py-0.5 text-[11px] text-blue-400">
          <Brain className="w-3 h-3 shrink-0 animate-pulse" />
          <span className="truncate leading-tight italic text-muted-foreground/70">
            {thinkingText.split("\n").filter(Boolean).pop()?.slice(0, 80) || "Thinking…"}
          </span>
        </div>
      )}
      {narrationText && !thinkingText && (   // ← ADD: show narration when not thinking
        <div className="flex items-start gap-1.5 py-0.5 text-[11px]">
          <MessageSquare className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground/50" />
          <span className="leading-relaxed text-foreground/70 line-clamp-3">
            {narrationText}
          </span>
        </div>
      )}
      {last5.map((entry, i) => (
        <ActionLogLiveRow key={i} entry={entry} showCodePreview={i === lastFileIdx} />
      ))}
    </div>
  );
}
```

**8. Pass `liveNarrationText` to ActionLogLive (line ~3257):**
```tsx
<ActionLogLive
  entries={liveActionLog}
  thinkingText={liveThinkingText || undefined}
  narrationText={liveNarrationText || undefined}   // ← ADD
/>
```

**9. Update ActionLogLive visibility condition (line ~3257):**
```tsx
{isExecuting && (liveActionLog.length > 0 || !!liveThinkingText || !!liveNarrationText) && (
```

**10. Add `liveNarrationText` to scroll deps (line ~1972):**
```ts
}, [chatMessages, managerMessages, liveActionLog, liveNarrationText]);
```
This ensures the chat auto-scrolls to bottom when narration starts streaming, keeping
ActionLogLive (and the narration inside it) in view.

## Import needed
Add `MessageSquare` to the lucide-react import at the top of chat-panel.tsx.

## Result After Fix

During a build step:
- **Thinking phase**: ActionLogLive shows step entry + thinking last-line (blue, italic)
- **Narration phase** (Doubao's delta.content): ActionLogLive shows step entry + narration
  text streaming (3-line clamp, grey) — visible at the bottom, always in view
- **Tool phase**: ActionLogLive shows step entry + file operation entries
- **After step**: NarrationBubble in messages list shows final narration as permanent record

The user sees live content streaming in ActionLogLive throughout the step. "Agent's narration
fires" while the status indicator is active.

## Files
`client/src/components/ide/chat-panel.tsx` — all changes are in this one file.
`MessageSquare` import from `lucide-react` (already imported if it was used elsewhere —
check first, may need to add to existing import).
