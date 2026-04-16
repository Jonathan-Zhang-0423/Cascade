---
title: "Plan card i18n and completed state improvements"
---

# Plan card i18n and completed state improvements

## What & Why
The TaskPlanCard component in chat-panel.tsx has all UI labels hardcoded in English (e.g., "Start building", "Stop", "Approve", "Submit & Continue", "All steps built & verified", "Needs your input", "Please respond", "Building...", "Reviewing project...", progress counts, etc.). Since CodeStart detects the user's language via `detectLanguage()` (Chinese vs English), the plan card should display labels in the user's language.

Additionally, when all tasks are fully complete (all done + review passed), the plan card should show a clear "Completed" state: subtasks should appear greyed out and the "Start Building" button should be replaced with a disabled "Completed" button/badge.

## Done looks like
- All hardcoded English strings in the plan card area render in Chinese when the user is using Chinese, and in English otherwise
- The language is detected from the user's first manager message (same pattern already used by `callCommunicator`)
- When `isFullyComplete` is true:
  - All StepItem rows show greyed-out styling (muted text, no bold, dimmed icons)
  - The "Start building" button area shows a disabled "Completed" / "已完成" button instead of disappearing
- No regressions to existing plan card behavior (in-progress states, confirmation flow, review badges, etc.)

## Implementation Details

### 1. Create a locale map for plan card strings
In `chat-panel.tsx`, define a locale map (or simple helper function) that returns the correct string based on detected language. Strings to localize:

**TaskPlanCard:**
- "Start building" → "开始构建"
- "Stop" → "停止"
- "All {n} steps built" → "全部 {n} 步已完成"
- "{done}/{total} steps done" → "{done}/{total} 步已完成"
- "All steps built & verified ✓" → "所有步骤已完成并验证 ✓"
- "Needs your input:" → "需要您的输入："
- "Please respond:" → "请回复："
- "Approve" → "确认"
- "Submit & Continue" → "提交并继续"
- "Type your response here..." → "在此输入您的回复..."
- "Completed" → "已完成"

**ReviewStatusBadge:**
- "Building..." → "构建中..."
- "Reviewing project..." → "正在审查项目..."
- "Review passed" → "审查通过"
- "Review passed ({pct}%)" → "审查通过 ({pct}%)"
- "{n} issues found" → "发现 {n} 个问题"
- "Issues found" → "发现问题"
- "Fixing issues (cycle {n}/3)..." → "修复问题中（第 {n}/3 轮）..."

**TypingIndicator:**
- "Thinking..." → "思考中..."

### 2. Detect language from manager messages
The `detectLanguage()` function already exists. Inside `TaskPlanCard`, determine the user language by checking the first user message in `managerMessages` (or the plan summary). Pass this as a prop or detect it within the component.

Approach: Add a `userLanguage` prop to `TaskPlanCard` (and cascading to `ReviewStatusBadge`). In the parent `ManagerMessageBubble`, detect the language from the plan summary or nearby user messages, then pass it down. Alternatively, since `TaskPlanCard` is always rendered inside `ChatPanel`, use the store's `managerMessages` to find the first user message and detect from it.

### 3. Completed state UI changes
When `isFullyComplete` is true:
- In the button area (currently hidden by `{onExecute && !isFullyComplete && ...}`), render a disabled green "Completed" / "已完成" button with a CheckCircle icon
- Ensure StepItem rows when all are done show consistently greyed-out styling (current `done` state already applies `text-muted-foreground line-through` — this may be sufficient, but verify the icons also dim)

## Relevant files
- `client/src/components/ide/chat-panel.tsx` — TaskPlanCard, StepItem, ReviewStatusBadge, TypingIndicator components (lines ~690-970)
