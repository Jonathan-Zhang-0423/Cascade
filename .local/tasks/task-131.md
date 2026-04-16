---
title: Fix white screen crash & refactor chat-panel.tsx
---
# Fix White Screen & Refactor chat-panel.tsx

## What & Why
The app whites out when AI streaming completes because: (1) no React error boundary exists — any rendering exception crashes the entire component tree into a blank page with no recovery, (2) chat-panel.tsx is 6,489 lines / 230KB with 81 hooks in a single component, causing fragile HMR updates that reset all streaming state and refs, and (3) redundant code (dual plan parsing, 4x duplicate codestart generation, 37 inlined sub-components) increases complexity and crash surface area.

The fix prioritizes deleting redundant code and splitting the file, with a minimal error boundary as the only truly new code.

## Done looks like
- Sending "帮我搭建一个计算器" in 新建项目 no longer whites out the app
- If a rendering error does occur, the user sees a helpful error message with a retry button instead of a blank white page
- chat-panel.tsx is reduced from ~6,500 lines to ~2,500 lines or fewer
- Redundant plan parsing (dual plan_ready + manager_done path) is consolidated into a single path
- Duplicate generate-codestart calls are consolidated from 4 to at most 2
- Sub-components and utility functions are extracted to separate files (not new code — just moved)
- All existing functionality continues to work identically

## Out of scope
- Adding new features to the chat panel
- Changing the streaming protocol or server-side logic
- Modifying the store (ide-store.ts) beyond what's needed for the refactor
- Performance optimization beyond what comes naturally from the restructuring

## Tasks
1. **Add a minimal ErrorBoundary** — Create a single small ErrorBoundary component that wraps ChatPanel, showing an error message and retry button instead of a white screen. This is the only net-new code.

2. **Extract sub-components into separate files** — Move the 20+ inlined components (ActionLogLive, ActionLogCollapsed, BuildCompletionCard, CodeBlockView, MessageBubble, ManagerMessageBubble, TaskPlanCard, StepItem, CheckpointMarker, TypingIndicator, ThinkingStream, CollapsedThinking, ReviewStatusBadge, NarrationBubble, ThinkingToggle, TextWithSummary, MessageContent, ActionLogChip, ActionLogLiveRow) out of chat-panel.tsx into a `chat/` subdirectory. Update imports in chat-panel.tsx. No logic changes — pure extraction.

3. **Extract utility functions into a shared module** — Move pure utility functions (normalizeSteps, stripProjectNameMarker, stripPlainFences, parseCodeBlocks, extractCodeBlocks, formatRelativeTime, escapeHtml, findTagEnd, tokenizeLine, detectLanguage, parseCompletionSummary, getActionLogIcon, getActionLogColor, findSummaryHeader, renderBoldMarkdown, splitSummaryBody, t, getPlanCardLang) out of chat-panel.tsx into a utilities file. No logic changes — pure extraction.

4. **Extract manager-chat stream processing into a custom hook** — Move the ~800-line manager-chat SSE event processing loop (currently inlined in ChatPanel) into a dedicated `useManagerChatStream` hook in a separate file. This isolates the streaming logic and reduces ChatPanel's hook count.

5. **Remove redundant plan parsing** — The `manager_done` handler (lines ~3261-3506) independently re-parses the plan from accumulated text even though `plan_ready` (lines ~3115-3187) already parsed and added it. Consolidate so `manager_done` only acts as cleanup (clear refs, clear localStorage session) and falls back to parsing ONLY if no plan was received via `plan_ready`.

6. **Consolidate duplicate generate-codestart calls** — Currently called at 4 different locations (lines 3164, 3411, 4485, 4570). Consolidate into a single helper function called from at most 2 places (plan_ready for new plans, and build completion for architecture changes).

7. **Remove duplicate getPlanCardLang/usePlanCardLang** — These two functions do nearly the same thing. Keep one and delete the other.

## Relevant files
- `client/src/components/ide/chat-panel.tsx`
- `client/src/stores/ide-store.ts`
- `client/src/App.tsx`