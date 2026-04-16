# Enhance Building Step Indicator

## What & Why
When the editor agent is actively building a step, the plan card's step list should clearly indicate which step is currently under construction. The existing "running" status uses a spinning loader icon and a very subtle `bg-blue-500/8` background, which is too subtle for users to notice at a glance. The indicator needs to be more prominent so users can immediately see build progress.

## Done looks like
- The currently building step in the plan card has a clearly visible "building" indicator — for example a pulsing glow/border, a "Building..." text label, or a more prominent animated background highlight
- Completed steps show a green checkmark (already works)
- Pending steps remain visually muted (already works)
- The active step stands out immediately without needing to look closely at tiny icons

## Out of scope
- Changing the backend SSE event flow (the `step_starting` / `step_completed` events already work correctly)
- Modifying the task status state management in the store (the `running` status is already set correctly)
- Adding new status types — this is purely a visual enhancement of the existing `running` state

## Tasks
1. Make the `StepItem` "running" state more visually prominent — increase the background highlight opacity, add a subtle pulse or glow animation, and/or add a short "Building..." text label next to the step title
2. Ensure the enhanced indicator works consistently across all three rendering paths in `TaskPlanCard` (rich sections view, pre-execution view, and default execution view) where `StepItem` is rendered with status props

## Relevant files
- `client/src/components/ide/chat-panel.tsx:1627-1721`
- `client/src/components/ide/chat-panel.tsx:1923-1987`
- `client/src/components/ide/chat-panel.tsx:2072-2113`
- `client/src/stores/ide-store.ts:270,1098-1101`
