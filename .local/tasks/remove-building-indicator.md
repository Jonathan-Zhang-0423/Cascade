# Remove "building" status indicator from plan card

## What & Why
The plan card shows a "构建中..." (Building...) badge with a spinner during the build phase. This is redundant since the step progress in the card already communicates that building is underway. Remove it to reduce visual noise.

## Done looks like
- The "构建中..." badge no longer appears in the plan card during build execution.
- All other review phase badges (reviewing, review passed, review failed, fixing) continue to appear as before.

## Out of scope
- Changes to any other phase indicators or the ReviewStatusBadge component logic beyond skipping the "building" phase.

## Tasks
1. In the `ReviewStatusBadge` function, add an early return for `phase === "building"` so the badge is not rendered during the build phase. Optionally clean up the now-unused "building" entry from the configs object and its i18n strings.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:893-940`
