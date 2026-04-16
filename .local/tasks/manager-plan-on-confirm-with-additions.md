# Manager Prompt: Plan on Confirm + New Requirements

## What & Why

When a user sends a message that combines a confirmation ("没错", "yes", "对") with new requirements AND a "start now" phrase ("开始修改", "start building", "go ahead"), the planning agent incorrectly enters another Stage 2 re-confirmation loop instead of producing a plan. The user then sees plain text instead of a plan card (TaskPlanCard), which is confusing.

Root cause: the manager prompt's Stage Transition Rule #4 says "update and re-confirm if the user adds corrections or new requirements." This rule fires even when the user has also explicitly said to start building, causing an unnecessary extra round-trip.

## Done looks like

- When a user sends "yes + minor new requirement + start now" in one message, the planning agent incorporates the new requirement into the plan and calls `submit_plan` immediately — producing a plan card.
- The agent still re-confirms when the user makes **significant** changes (e.g., changing the core concept, switching from a game to a website) — only minor additions/tweaks alongside an explicit start command can skip the extra confirmation.
- Existing Stage 2 re-confirmation behavior is preserved for messages that only add requirements without a start directive.

## Out of scope

- Changing how the plan card renders
- Changing how the build execution works after the plan card appears

## Tasks

1. **Update Stage Transition Rule #4 in the manager prompt** — Modify the rule to distinguish between two cases: (a) user adds requirements WITHOUT a start phrase → re-confirm as before, and (b) user adds minor requirements WITH a clear start/go-ahead phrase → incorporate the additions and call `submit_plan` immediately. Add explicit examples in both Chinese and English so the model understands the intended behavior.

2. **Add a "combined confirm + build" example** to the manager prompt's Stage 3 section showing how to handle "没错，另外也希望X，请开始修改" → go straight to `submit_plan` with the additions included in the plan.

## Relevant files

- `server/manager-prompt.ts:44-53`
