# Revert Manager Model to Main

## What & Why
Task #47 switched the manager agent to the lite model to reduce streaming delay, but the manager should use `doubao-seed-2-0-code-preview-260215` (DOUBAO_MODEL) for higher quality planning. Revert both calls in the `/api/manager-chat` endpoint back to DOUBAO_MODEL.

## Done looks like
- Manager agent uses `doubao-seed-2-0-code-preview-260215` for its own response
- Inline communicator call (after plan_ready) also uses `doubao-seed-2-0-code-preview-260215`

## Out of scope
- Any changes to the typing indicator or client-side streaming logic
- Any other model assignments (editor, verifier, vibe agent)

## Tasks
1. In `server/routes.ts`, change both `DOUBAO_LITE_MODEL` references inside the `/api/manager-chat` handler back to `DOUBAO_MODEL`.

## Relevant files
- `server/routes.ts:409-414,519-527`
