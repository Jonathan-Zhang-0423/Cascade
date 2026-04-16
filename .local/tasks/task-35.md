---
title: Port Plan Review features into TaskPlanCard
---
# Port Plan Review Features into TaskPlanCard

## What & Why
Task #33 built the Plan Review Card features (step preview blur, full-plan expand modal, "Revise Plan"/"Build Now" buttons) as a *separate* `PlanReviewCard` component that only appears momentarily when toggling Plan→Build mode. The actual card users see — `TaskPlanCard` inside `ManagerMessageBubble` — still shows all steps flat with no preview limit and only a single "Start Building" button. The review features need to live in `TaskPlanCard` itself, which is the primary UI users interact with.

## Done looks like
- `TaskPlanCard`, when in pre-execution state (no steps done yet, not executing), shows:
  - First ~10 steps clearly; any additional steps blurred with a gradient fade + "Show all N steps" inline expand button
  - A small expand/maximize icon button in the header that opens a Dialog modal with all steps and their full descriptions
  - Footer with two buttons: "Revise Plan" (secondary, left) and "Build Now" (primary, right) — instead of the single "Start Building" button
- "Revise Plan" switches back to Plan mode (chatMode = "manager") and focuses the chat textarea
- "Build Now" triggers `handleExecutePlan()` exactly as the old "Start Building" did
- Once execution starts (any step is running/done), the card reverts to its normal execution-progress view (step status icons, Stop button, review badges, etc.) — the pre-execution review UI goes away
- The separate `PlanReviewCard` component and `showPlanReview` / `handleToggleMode` flow are either removed or simplified since `TaskPlanCard` now owns the review UX
- The planCardStrings i18n object gets "revisePlan" and "buildNow" keys for both Chinese and English

## Out of scope
- Changing any execution logic (handleExecutePlan, executeSubTask, etc.)
- Changing the holistic review phase UI or confirmation input UI

## Tasks
1. **Add `onRevise` prop to `TaskPlanCard`** — accept an optional `onRevise?: () => void` callback alongside the existing `onExecute`.
2. **Step preview + blur in `TaskPlanCard`** — add `useState(false)` for expanded state; render first 10 steps normally, blur the next 1-2 as a peek, show "Show all N steps" / "Collapse" toggle button — only in pre-execution state (`doneCount === 0 && !isExecuting`).
3. **Expand modal in `TaskPlanCard`** — add a small expand icon (Maximize2) button in the header that opens a shadcn Dialog showing all steps with titles + descriptions, plus "Revise Plan" / "Build Now" in the modal footer.
4. **Replace "Start Building" with "Revise Plan" + "Build Now"** — in pre-execution state (`doneCount === 0 && !isExecuting && !isFullyComplete`), show a split footer with secondary "Revise Plan" (calls `onRevise`) and primary "Build Now" (calls `onExecute`). Keep Stop/completed buttons exactly as they are for execution/done states.
5. **Wire `onRevise` from `ManagerMessageBubble` caller** — pass `handleRevisePlan` as `onRevise` when rendering the last plan's `TaskPlanCard` in the merged timeline.
6. **Remove or no-op `PlanReviewCard` / `showPlanReview` toggle flow** — since `TaskPlanCard` now owns the review UX, the separate `PlanReviewCard` component and `handleToggleMode` review-card branch can be removed to avoid duplicate UIs.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:893-1089` — TaskPlanCard component
- `client/src/components/ide/chat-panel.tsx:1093-1256` — PlanReviewCard component (to simplify/remove)
- `client/src/components/ide/chat-panel.tsx:1258-1331` — ManagerMessageBubble (passes props to TaskPlanCard)
- `client/src/components/ide/chat-panel.tsx:2395-2410` — merged timeline render (where onRevise/onExecute are passed)
- `client/src/components/ide/chat-panel.tsx:16-61` — planCardStrings i18n (add revisePlan, buildNow keys)
- `client/src/components/ide/chat-panel.tsx:2195-2215` — handleToggleMode / handleRevisePlan / handleBuildNow callbacks