# Fix Build Session Streaming Visibility — Complete Analysis

## Evidence-Based Root Cause Trace

The scroll area div (line 3176) contains this exact DOM sequence during a build:

```
[merged messages, sorted by timestamp]
  → ...chat messages...
  → ManagerMessageBubble: plan card         (from managerMessages)
  → ManagerMessageBubble: step-header msg  (added by addManagerMessage, typing:true)
{isManagerResponding && <TypingIndicator "Planning...">}   ← LINE 3247
{isExecuting && liveActionLog.length>0 && <ActionLogLive>}  ← LINE 3250
```

The scroll effect (lines 1965–1969) fires whenever `chatMessages` or `managerMessages` changes:

```ts
useEffect(() => {
  if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
}, [chatMessages, managerMessages]);
```

`flushThinkingToStore()` (called on every `thinking_token`) does
`useIDEStore.setState({ managerMessages: updated })` — this fires a Zustand update that
changes the reactive `managerMessages` value in ChatPanel, triggering the scroll effect.

### Root Cause 1 — "Planning..." indicator is permanently in-view during entire build

`isManagerResponding` is set to `true` in `handleExecutePlan()` (line 2590) and is only
cleared in the `finally` block (line 2998) — **after the entire build finishes**.

The `{isManagerResponding && <TypingIndicator "Planning...">}` sits between the step-header
message and `ActionLogLive` in the DOM. Since `flushThinkingToStore` fires on every
thinking token and always triggers `scrollTop = scrollHeight`, the user is **constantly
auto-scrolled to the very bottom** of the scroll area.

The absolute bottom is either the planning indicator (if ActionLogLive is not yet shown)
or ActionLogLive (once it appears). Either way, the **step-header NarrationBubble** — which
carries the "Reasoning…" live thinking text — is scrolled above both elements and is
**off-screen**.

This is why the user sees nothing useful: every thinking-token heartbeat pushes them back
to the planning indicator / ActionLogLive, hiding the NarrationBubble above it.

### Root Cause 2 — ActionLogLive is invisible during the initial thinking phase

The `step_starting` local block:
1. calls `appendActionLog({type: "step"})` → `liveActionLog.length = 1` (pending)
2. calls `addManagerMessage(...)` → `managerMessages` updated (pending)
3. **YIELD** (`await setTimeout(0)`) — React renders: `liveActionLog.length=1` BUT `isExecuting=false` → `ActionLogLive` condition `isExecuting && liveActionLog.length > 0` evaluates to **false**
4. After yield: project block runs `setExecutingTaskIndex(stepNum-1)` → `isExecuting=true`
5. No yield after step 4 → `isExecuting=true` takes effect only on the **next** render

So ActionLogLive is dark for one render cycle. Normally brief, but on slow models it means
the user sees only the planning indicator for several seconds at the start of each step.

### Root Cause 3 — action_log events don't trigger scroll-to-bottom

`appendActionLog` calls `setLiveActionLog(...)`, a local React state — **not in the scroll
effect's dependency array**. So when tool-call entries appear in ActionLogLive (file reads,
file writes), the user is **not automatically scrolled** to see them. They appear silently
below the visible area.

## The Full DOM Picture After All Three Fixes

After the fixes, the bottom of the scroll area during a build looks like:

```
ManagerMessageBubble: step-header  ← "Reasoning…" live thinking text IS HERE
ActionLogLive                      ← step entry + tool-call entries
```

Every thinking token fires `flushThinkingToStore → managerMessages change → scroll to bottom`.
Scroll-to-bottom now goes to ActionLogLive (the absolute last element). The step-header
NarrationBubble is **directly above** ActionLogLive and is visible in the same viewport.
The user sees both the streaming "Reasoning…" text AND the tool-call log simultaneously.

## Exact Fixes

### Fix 1 — Hide planning indicator during build (line 3247)

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

`chatMode` is set to `"build"` at line 2592 (start of `handleExecutePlan`) and stays `"build"`
for the entire build session. This one guard removes the element that was constantly
intercepting the user's scroll position.

### Fix 2 — Move `setExecutingTaskIndex` before the yield (step_starting local block)

In the `step_starting` local block, **inside** the `if (isCurrentProjectNow)` guard, add
`setExecutingTaskIndex(stepNum - 1)` before the yield. Remove it from the project-level
block (line 2887) since it's now handled earlier.

```ts
// In step_starting local block, inside if (isCurrentProjectNow):
commAccumulated = "";
addManagerMessage({ role: "assistant", content: stepLabel, source: "communicator", typing: true });
commMsgIndex = useIDEStore.getState().managerMessages.length - 1;
setExecutingTaskIndex(stepNum - 1);   // ← ADD BEFORE YIELD
// Yield: React renders with isExecuting=true AND liveActionLog.length=1
await new Promise<void>(r => setTimeout(r, 0));

// In project block for step_starting (line 2885–2887): REMOVE setExecutingTaskIndex call
if (type === "step_starting") {
  updateTaskStatus(String(ev.stepNumber), "running");
  // setExecutingTaskIndex removed — handled in local block
}
```

### Fix 3 — Add `liveActionLog` to scroll-to-bottom effect (line 1965)

```ts
// BEFORE:
}, [chatMessages, managerMessages]);

// AFTER:
}, [chatMessages, managerMessages, liveActionLog]);
```

This ensures the user auto-scrolls to ActionLogLive when tool-call entries arrive (file
reads, file writes). Without this, those entries appear silently below the viewport.

### Fix 4 — Widen ActionLogLive condition to include liveThinkingText (line 3250)

```tsx
// BEFORE:
{isExecuting && liveActionLog.length > 0 && (

// AFTER:
{isExecuting && (liveActionLog.length > 0 || !!liveThinkingText) && (
```

Edge-case safety: if thinking tokens arrive before the step entry is in `liveActionLog`
(e.g., race condition between server event ordering), ActionLogLive still shows the
thinking line rather than being completely invisible.

## Files to Change

`client/src/components/ide/chat-panel.tsx` — four targeted edits, no new state, no new
components, no redesign:

| # | Location | Change |
|---|----------|--------|
| 1 | Line ~3247 (planning indicator) | Add `chatMode !== "build"` guard |
| 2 | Line ~2762 (step_starting local block) | Add `setExecutingTaskIndex` before yield |
| 3 | Line ~2887 (step_starting project block) | Remove `setExecutingTaskIndex` |
| 4 | Line ~1969 (scroll effect deps) | Add `liveActionLog` |
| 5 | Line ~3250 (ActionLogLive condition) | Add `|| !!liveThinkingText` |

## Verification

After these changes, starting a build should:
1. Immediately show ActionLogLive with the "Step N/M: Title" entry
2. Show "Reasoning…" streaming text in the step-header NarrationBubble (above ActionLogLive, both in the viewport)
3. NOT show a "Planning..." spinner during building
4. Auto-scroll to show new file read/write entries as they arrive
5. Footer "Agent is thinking..." status indicator remains visible throughout
