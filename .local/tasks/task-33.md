---
title: Plan Review Card on Plan→Build mode switch
---
# Plan Review Card on Mode Switch

## What & Why
When a user is in Plan mode, has brainstormed with the Manager, and the Manager has proposed a plan, switching to Build mode via the toggle button should feel like a deliberate, guided handoff — not an invisible state change, and not an immediate auto-execution.

The desired UX: when the user toggles from Plan → Build with an active plan, a confirmation card appears in the chat (similar to Replit's "Review your plan" flow), letting the user:
- Glance at the proposed plan
- Request revisions before committing to build
- Confirm by clicking "Build Now"

## Done looks like
- Toggling from Plan mode → Build mode when a `managerPlan` exists inserts a Plan Review Card into the chat timeline (does NOT auto-execute)
- The Plan Review Card shows:
  - The plan summary as a header
  - Up to 10 lines of plan steps; the rest are blurred/faded with a chevron "Expand" button to reveal all
  - "Revise Plan" button (left side) — switches back to Plan mode and focuses the input so the user can give further instructions to the Manager
  - "Build Now" button (right side) — triggers plan execution (same as clicking "Start building" on the plan card)
  - "Expand" button/icon — opens a modal overlay showing the complete plan with all steps clearly listed
- If there is no active `managerPlan` when toggling to Build mode, the toggle behaves exactly as before (just switches chatMode, no card shown)
- After "Build Now" is clicked, the review card collapses/disappears and execution begins normally
- After "Revise Plan" is clicked, the mode switches back to Plan mode and the chat input is focused; the review card is dismissed
- Switching from Build → Plan mode (the reverse direction) is unchanged

## Out of scope
- Auto-executing the plan when the toggle is clicked (explicitly NOT wanted)
- Changing the existing "Start building" button on the regular plan card in Plan mode
- Changing the Manager, Editor, Communicator, or Verifier agents
- The auto-execute path for Build-mode typed messages (Task #32's behavior for free-form Build mode messages stays as-is)

## Tasks

1. **Plan Review Card component** — Create a `PlanReviewCard` component (in `chat-panel.tsx` or a separate file) that receives the `managerPlan`, `onBuildNow`, `onRevise`, and `onDismiss` callbacks. Show the plan summary as a title, render the first ~10 lines of steps with the rest blurred (using a CSS fade/blur overlay), include an Expand button that opens a modal with the full plan, a "Revise Plan" button (secondary style, left), and a "Build Now" button (primary style, right).

2. **Modal for full plan** — Add a simple full-plan modal (using shadcn Dialog) that lists all steps clearly when the Expand button is clicked. Can be triggered from within `PlanReviewCard`.

3. **Toggle handler with smart routing** — Replace the toggle button's inline `onClick` with a named `handleToggleMode` callback. When switching `"manager"` → `"build"` with a non-null `managerPlan` and no active execution: set a `showPlanReview` state flag to true (which renders the `PlanReviewCard` in the chat). Otherwise just call `setChatMode(...)` as before.

4. **Revise and Build callbacks** — Wire up:
   - `onBuildNow`: call `handleExecutePlan()`, set `showPlanReview` to false
   - `onRevise`: call `setChatMode("manager")`, focus the textarea, set `showPlanReview` to false
   - `onDismiss`: set `showPlanReview` to false (user cancelled the card without acting)

## Relevant files
- `client/src/components/ide/chat-panel.tsx:2172-2187` — toggle button onClick
- `client/src/components/ide/chat-panel.tsx:1695-1699` — handleExecutePlan start
- `client/src/components/ide/chat-panel.tsx:2089-2138` — merged chat timeline render
- `client/src/components/ide/chat-panel.tsx:1211-1220` — refs and state declarations