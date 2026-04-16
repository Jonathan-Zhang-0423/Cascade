---
title: Enhanced Plan Card — Communicator-Narrated Sections
---
# Task 39: Enhanced Plan Card — Communicator-Narrated Sections

## What & Why
The current plan card shows only a one-line summary and a numbered list of step titles. The spec calls for a richer, structured card with five named sections: **What & Why**, **Done looks like**, **Out of scope**, **Tasks**, and **Relevant files**. The Manager generates the technical content for each section, and the Communicator rewrites them in warm, beginner-friendly language before they are displayed.

## Done looks like
- The Manager's plan JSON now includes `what_and_why`, `done_looks_like`, `out_of_scope`, and `relevant_files` fields alongside `summary` and `steps`
- The `plan_created` Communicator event receives these new fields and returns friendly narrative versions of each section
- The `TaskPlanCard` UI is redesigned to display: What & Why → Done looks like → Out of scope → Tasks (numbered step list, collapsed/expandable) → Relevant files — replacing the current summary + flat step list layout
- Old plan cards (pre-execution cards for non-latest plans) continue to render gracefully using whatever fields are present
- All new fields are i18n-aware (Chinese/English matching user language)

## Out of scope
- Changing the execution loop, verifier, or fix cycle logic
- Server-side build orchestration (that is Task 41)
- The dual-tone Manager prompt update (that is Task 40)

## Changes required

### 1. `server/manager-prompt.ts`
Add the four new fields to the Mode 2 (Task Plan) JSON schema and instructions:
```json
{
  "type": "plan",
  "what_and_why": "Technical description of the problem/task and reasoning",
  "done_looks_like": "Concrete description of the end state",
  "out_of_scope": "Related but excluded concerns for this task",
  "relevant_files": ["/project/index.html", "/project/app.js"],
  "summary": "...",
  "steps": [...],
  "needs_input": []
}
```
Add per-field guidance in the prompt (e.g. "what_and_why: 2-3 sentences describing what is being built and why").

### 2. `client/src/stores/ide-store.ts`
Add optional fields to `ManagerPlan` interface:
```ts
export interface ManagerPlan {
  summary: string;
  steps: ManagerSubTask[];
  needs_input: string[];
  // new
  what_and_why?: string;
  done_looks_like?: string;
  out_of_scope?: string;
  relevant_files?: string[];
  // communicator-narrated versions (filled in after plan_created event)
  narrated_what_and_why?: string;
  narrated_done_looks_like?: string;
  narrated_out_of_scope?: string;
}
```

### 3. `server/communicator-prompt.ts`
- Update `CommunicatorEvent` interface: add `whatAndWhy?: string`, `doneLooksLike?: string`, `outOfScope?: string`, `relevantFiles?: string[]`
- Update `buildCommunicatorMessage` for `plan_created` to include these fields in the context message
- Update `COMMUNICATOR_AGENT_SYSTEM_PROMPT` `plan_created` section: the Communicator should output the narrative versions of each section using structured tags, e.g.:
  ```
  [PLAN_SUMMARY] ...
  [STEP_1] ...
  [WHAT_AND_WHY] Friendly narrated version of what_and_why...
  [DONE_LOOKS_LIKE] Friendly narrated version of done_looks_like...
  [OUT_OF_SCOPE] Friendly narrated version of out_of_scope...
  ```

### 4. `client/src/components/ide/chat-panel.tsx`

**In `handleManagerSend`:**
- Pass the new fields to `callCommunicator("plan_created")`: `whatAndWhy`, `doneLooksLike`, `outOfScope`, `relevantFiles`
- After the Communicator response, parse the new `[WHAT_AND_WHY]`, `[DONE_LOOKS_LIKE]`, `[OUT_OF_SCOPE]` tags (extend `parsePlanLocalization`)
- Store the narrated versions on `displayPlan` as `narrated_what_and_why`, `narrated_done_looks_like`, `narrated_out_of_scope` before calling `setManagerPlan(displayPlan)`

**In `TaskPlanCard`:**
- Replace the current layout (summary line + flat step list) with the five-section design:
  1. **What & Why** — `plan.narrated_what_and_why || plan.what_and_why`
  2. **Done looks like** — `plan.narrated_done_looks_like || plan.done_looks_like`
  3. **Out of scope** — `plan.narrated_out_of_scope || plan.out_of_scope` — always visible
  4. **Tasks** — numbered step list (existing StepItem components), collapsible/expandable
  5. **Relevant files** — `plan.relevant_files` as a pill/badge list
- Keep the existing Revise Plan / Build Now footer unchanged
- Keep the existing review status badge, confirmation input, and stop button logic unchanged
- Add i18n keys: `whatAndWhy`, `doneLooksLike`, `outOfScope`, `tasks`, `relevantFiles` to `planCardStrings`

## Relevant files
- `server/manager-prompt.ts` — plan JSON schema
- `server/communicator-prompt.ts` — plan_created event, CommunicatorEvent interface
- `client/src/stores/ide-store.ts` — ManagerPlan interface
- `client/src/components/ide/chat-panel.tsx` — handleManagerSend, parsePlanLocalization, TaskPlanCard