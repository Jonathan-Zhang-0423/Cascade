---
title: Redesign Manager Mode: Build → Review → Fix Workflow
---
# Redesign Manager Mode: Build → Review → Fix Workflow

## What & Why
Replace the current per-step verification loop (Editor → Verifier per step) with a "Build → Review → Fix" cycle. Currently every step gets individually verified, which is slow (2N+ AI calls for N steps), gives the Verifier tunnel vision (can't catch integration issues), and creates a stop-and-go user experience. The new workflow mirrors how professional development works: build everything first, then do a comprehensive holistic review, then fix any bugs found — and loop until the project passes.

## Done looks like
- **Build Phase**: Editor executes ALL planned steps sequentially without per-step verification. Communicator narrates each step's progress. A full file snapshot is taken before the build phase begins.
- **Review Phase**: After all steps complete, the Verifier receives the original user request, the full plan with all acceptance criteria, the before/after file snapshots, and produces ONE holistic review covering: code runnability across all files, requirement completeness against the original request, regression detection, integration checks (cross-file references), and any items needing user input.
- **Fix Phase**: If the Verifier found bugs/issues, the bug report goes to the Manager who creates a targeted fix plan (not a full replan). Editor executes the fix steps. Verifier re-reviews holistically. This loops up to 3 times.
- **User Confirmation**: If the Verifier flags subjective items, the Communicator presents them and execution pauses for user input, same as before.
- **UI Updates**: Task plan card reflects the new lifecycle — steps show "pending → running → done" during build phase (no per-step "verifying" state). A new "reviewing" state appears after all steps finish. After review, steps may show "bug" status if the Verifier found issues.
- **Communicator Events**: Updated to match the new flow phases — `build_starting`, `build_complete`, `reviewing`, `review_passed`, `bugs_found`, `fixing`, `all_complete`.
- **Happy path is faster**: N steps = N Editor calls + 1 Verifier call (instead of 2N calls).
- Build Mode (Vibe Agent direct chat) is completely unchanged.

## Out of scope
- Actual browser-based e2e test execution (Playwright, headless browser) — the Verifier does thorough static analysis only.
- Changes to Build Mode / Vibe Agent behavior.
- Changes to project persistence or file system structure.

## Tasks
1. **Redesign the Verifier prompt for holistic project-level review** — Replace the per-step verification prompt with one that reviews the entire project at once. It receives: original user request, full plan with all steps/criteria, before-snapshot, after-snapshot. It outputs a comprehensive report with overall pass/fail, list of specific bugs (each with location, description, severity), missing features, and user confirmation items.

2. **Add a Manager "fix mode" prompt capability** — Extend the Manager prompt to handle a second mode: receiving a Verifier bug report and producing a targeted fix plan (small, focused steps to fix specific bugs only — not a full replan). Add a new endpoint or parameter to the existing manager-chat endpoint for this mode.

3. **Update Communicator events for the new flow phases** — Replace the per-step verification events with new flow-phase events: `build_starting`, `build_complete`, `reviewing`, `review_passed`, `bugs_found`, `fixing`, `fix_cycle_N`. Update the Communicator prompt to handle these new event types.

4. **Rewrite the execution loop in chat-panel.tsx** — Replace `handleExecutePlan` with the Build → Review → Fix cycle. Build phase: execute all steps with Communicator narration, no verification. Review phase: call Verifier once with full context. Fix phase: if bugs found, send to Manager for fix plan, execute fixes, re-review. Loop up to 3 cycles. Update the Verifier endpoint call to pass holistic context.

5. **Update task statuses, store types, and TaskPlanCard UI** — Update `taskStatuses` type to support the new lifecycle states. Update the `StepItem` and `TaskPlanCard` components to reflect the new flow: build progress bar, holistic review status indicator, bug annotations on specific steps, fix cycle indicator.

6. **Update the Verifier API endpoint for holistic review** — Modify `/api/verifier-chat` to accept the new holistic context (original user request, full plan, all acceptance criteria, complete before/after snapshots) instead of per-step context. Update `buildVerifierContextMessage` accordingly.

## Relevant files
- `server/verifier-prompt.ts`
- `server/manager-prompt.ts`
- `server/communicator-prompt.ts`
- `server/routes.ts:190-253`
- `client/src/components/ide/chat-panel.tsx:706-911,1374-1560`
- `client/src/stores/ide-store.ts:210-255`