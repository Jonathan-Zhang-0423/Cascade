---
title: Fix build streaming visibility (planning indicator + ActionLog timing)
---
# Fix Build Session Streaming Visibility

## Root Causes Identified

After deep code analysis of the current state (post Task #94 + Task #95 merge), three compounding bugs prevent the user from seeing any streaming content during a build session:

### Bug 1 — "Planning..." indicator fills the entire view during building

`isManagerResponding` is set to `true` at the start of `handleExecutePlan()` (line 2590) and cleared only at the very end (line 2998). This means the `{isManagerResponding && <TypingIndicator text="Planning..." />}` at line 3247-3249 shows for the ENTIRE duration of a build session. Since the chat auto-scrolls to the very bottom, the user sees this indicator as the primary content, even though step-header messages and ActionLogLive exist above and below it.

**Fix**: Change `{isManagerResponding && ...}` to `{isManagerResponding && chatMode !== "build" && ...}`. During build mode, `chatMode` is set to `"build"` (line 2592), so the planning indicator is hidden. The ActionLogLive and the footer phase indicator provide the right visual feedback instead.

### Bug 2 — ActionLogLive doesn't appear until AFTER the first thinking_token or reader.read()

The `step_starting` handler has this sequence:
1. Local block: `appendActionLog({ type: "step" })` → sets `liveActionLog` (React state, pending)
2. Local block: `addManagerMessage(...)` → adds step header
3. **YIELD**: `await new Promise(r => setTimeout(r, 0))`
   - React renders here: `liveActionLog.length = 1` ✓ BUT `isExecuting = false` (executingTaskIndex still null)
   - `ActionLogLive` condition: `false && 1 > 0` → **NOT SHOWN**
4. Post-yield: project-level block calls `setExecutingTaskIndex(0)` → `isExecuting = true` (pending)
5. Only on the NEXT `await` (next thinking_token yield or reader.read()) does React render with `isExecuting = true`

This means `ActionLogLive` doesn't appear until the first thinking_token arrives or the next chunk is read — which can be several seconds on thinking models.

**Fix**: Move `setExecutingTaskIndex` call from the project-level block to inside the local block's `if (isCurrentProjectNow)` guard, BEFORE the yield. Remove it from the project-level block to avoid double-calling. This way, after the yield, React renders with both `liveActionLog.length = 1` AND `isExecuting = true` — so `ActionLogLive` appears immediately.

### Bug 3 — ActionLogLive only shows when `liveActionLog.length > 0`, missing pure-thinking phase

The current condition is `isExecuting && liveActionLog.length > 0`. After fix 2, the step entry IS in `liveActionLog` when `step_starting` fires, so this is resolved. But as an extra safety net for edge cases where `step_starting` might arrive late, also show ActionLogLive when `liveThinkingText` is non-empty:

**Fix**: Change to `isExecuting && (liveActionLog.length > 0 || !!liveThinkingText)`.

## Files to change

`client/src/components/ide/chat-panel.tsx`:

1. **Line 3247-3249** (planning indicator): Add `chatMode !== "build"` guard
2. **Lines 2745-2765** (`step_starting` local block): Move `setExecutingTaskIndex` call inside `if (isCurrentProjectNow)`, before the yield
3. **Lines 2885-2887** (`step_starting` project block): Remove `setExecutingTaskIndex` call (now in local block)
4. **Lines 3250-3253** (ActionLogLive): Change condition to `isExecuting && (liveActionLog.length > 0 || !!liveThinkingText)`

## Exact code changes

### Change 1 — Planning indicator (line ~3247)
```tsx
// BEFORE:
{isManagerResponding && (
  <TypingIndicator text={t(getPlanCardLang(), "planning")} />
)}

// AFTER:
{isManagerResponding && chatMode !== "build" && (
  <TypingIndicator text={t(getPlanCardLang(), "planning")} />
)}
```

### Change 2 — Move setExecutingTaskIndex before yield (step_starting local block)
```tsx
// In the step_starting local block, INSIDE if (isCurrentProjectNow):
commAccumulated = "";
addManagerMessage({ role: "assistant", content: stepLabel, source: "communicator", typing: true });
commMsgIndex = useIDEStore.getState().managerMessages.length - 1;
setExecutingTaskIndex(stepNum - 1);  // <-- ADD THIS
// Yield so React commits the step-header message AND isExecuting before thinking tokens arrive.
await new Promise<void>(r => setTimeout(r, 0));
```

### Change 3 — Remove setExecutingTaskIndex from project-level block
```tsx
// In the project-level step_starting block:
if (type === "step_starting") {
  updateTaskStatus(String(ev.stepNumber), "running");
  // setExecutingTaskIndex removed — now set in local block before yield
}
```

### Change 4 — ActionLogLive condition
```tsx
// BEFORE:
{isExecuting && liveActionLog.length > 0 && (

// AFTER:
{isExecuting && (liveActionLog.length > 0 || !!liveThinkingText) && (
```

## Verification

After these changes, clicking "Start Building" should:
1. Immediately show ActionLogLive with a "Step 1/N: Title" step entry (no more waiting for thinking_token)
2. NOT show "Planning..." (replaced by the build phase indicator in the footer)
3. Show thinking text in ActionLogLive as reasoning tokens stream in
4. Show file read/write entries as tool calls happen