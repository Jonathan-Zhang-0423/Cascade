# Fix Kimi thinking display in NarrationBubble

## What & Why

When using Kimi K2.5 as the AI provider, the server correctly generates `reasoning_content` (confirmed by `[agent-loop] first thinking_token from kimi-k2.5` server logs), and the SSE `thinking_token` events reach the client. However, the grey italic thinking text never appears inside the `NarrationBubble` during a build — only the pulsing "Thinking…" dot shows, meaning `message.thinking` stays empty throughout.

The pulse dot appearing confirms:
- `step_starting` fires and creates a step message with `typing: true` ✓
- `commMsgIndex` is set to the new message index ✓

But `message.thinking` stays empty, meaning `flushThinkingToStore()` is not updating the store correctly, even though `commMsgIndex !== -1` and `thinking_token` events are arriving.

## Done looks like

- During a Kimi build, the NarrationBubble for each step shows the pulsing "Thinking…" dot **plus** the grey italic reasoning text streaming in live.
- After the step completes, a collapsible "(Thinking)" toggle appears in the step bubble with the full reasoning text.
- No regressions for Doubao thinking display.

## Out of scope

- Changing AI provider selection UI
- Changing the Kimi API parameters (already confirmed working server-side)

## Tasks

1. **Add runtime debug logging** — In `chat-panel.tsx`, inside the `thinking_token` SSE handler, add:
   ```typescript
   console.log('[thinking_token] commMsgIndex:', commMsgIndex, 'tokenLen:', token.length, 'accLen:', thinkingAccumulated.length);
   ```
   Inside `flushThinkingToStore`, before each early-return and before the `setState` call:
   ```typescript
   console.log('[flushThinking] isCurrentProject:', isCurrentProject, 'commMsgIndex:', commMsgIndex, 'target role:', target?.role, 'accLen:', thinkingAccumulated.length);
   ```

2. **Run a Kimi build and inspect browser console** — Start a new project, select Kimi as provider, run a build. Read the browser console output to identify the exact failure point:
   - If `commMsgIndex === -1` → `step_starting` check failed; investigate `isCurrentProjectNow` values
   - If `target?.role !== "assistant"` → wrong message is at `commMsgIndex`; investigate index calculation
   - If all conditions pass but thinking still doesn't show → Zustand `setState` update not triggering re-render

3. **Apply the targeted fix** based on what the console reveals. Most likely fixes ranked by probability:

   **Fix A (if `commMsgIndex` timing issue):** In `flushThinkingToStore`, add a fallback to find the last assistant message with `typing: true` if `commMsgIndex === -1` or `msgs[commMsgIndex]?.role !== "assistant"`:
   ```typescript
   const flushThinkingToStore = () => {
     const isCurrentProject = useIDEStore.getState().projectId === projectId;
     if (!isCurrentProject) return;
     let idx = commMsgIndex;
     const msgs = useIDEStore.getState().managerMessages;
     if (idx === -1 || msgs[idx]?.role !== "assistant") {
       idx = [...msgs].reverse().findIndex(m => m.typing === true && m.role === "assistant");
       if (idx !== -1) idx = msgs.length - 1 - idx;
     }
     if (idx === -1) return;
     const target = msgs[idx];
     if (target?.role === "assistant") {
       const updated = [...msgs];
       updated[idx] = { ...target, thinking: thinkingAccumulated };
       useIDEStore.setState({ managerMessages: updated });
     }
   };
   ```

   **Fix B (if Zustand setState not triggering re-render):** Add a Zustand store action `setMessageThinking(index, text)` that goes through the store's `set` pipeline instead of calling `useIDEStore.setState` directly:
   ```typescript
   // In ide-store.ts:
   setMessageThinking: (index: number, thinking: string) =>
     set((state) => {
       const msgs = [...state.managerMessages];
       const target = msgs[index];
       if (target?.role === "assistant") {
         msgs[index] = { ...target, thinking };
       }
       return { ...state, managerMessages: msgs };
     }),
   ```
   Then in `flushThinkingToStore`, call `useIDEStore.getState().setMessageThinking(commMsgIndex, thinkingAccumulated)` instead.

   **Fix C (if `isCurrentProjectNow` fails in step_starting):** Read `projectId` freshly from the store's URL/params rather than from the closure, or remove the `isCurrentProjectNow` guard from step_starting (since the step message doesn't modify files and is safe to create regardless of project mismatch).

4. **Remove debug console.logs** once the fix is confirmed working.

5. **Test with e2e**: run a build with Kimi selected, verify grey thinking text streams live in the NarrationBubble during the thinking phase, and verify the "(Thinking)" toggle appears after each step completes.

## Relevant files

`client/src/components/ide/chat-panel.tsx:2253-2310`
`client/src/components/ide/chat-panel.tsx:2361-2414`
`client/src/components/ide/chat-panel.tsx:1488-1542`
`client/src/stores/ide-store.ts:149-160`
`client/src/stores/ide-store.ts:1051-1066`
`server/agent-loop.ts:90-107`
