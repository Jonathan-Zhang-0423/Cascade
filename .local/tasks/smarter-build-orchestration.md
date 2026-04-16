# Smarter Build Orchestration: Plan State + Parallelism

## What & Why
The current build orchestrator has two significant weaknesses:

**1. The Editor has no awareness of plan state.** Each step is called in complete isolation — the Editor doesn't know which steps are already done, which is in progress, or what's still pending. On large builds, this causes drift: the Editor may re-implement something already written or make assumptions inconsistent with prior steps.

**2. All steps run sequentially, even when independent.** Writing `styles.css` blocks `utils.js` from starting, even though they share no files. For a 6-step build, sequential execution means each step's latency adds up linearly.

This task applies two patterns from learn-claude-code:
- **s03 (TodoWrite)**: Inject a live plan state block into every Editor call showing what's done, what's active, and what's pending
- **s08 (Background Tasks)**: Identify independent steps (those with non-overlapping `required_files`) and execute them concurrently using `Promise.all`

## Done looks like
- Each Editor call receives a `[Plan State]` block in its prompt listing completed steps (✓), the current step (→), and upcoming steps (○) — giving the Editor full awareness of where it is in the build
- The orchestrator groups plan steps into "waves" of independent steps (no shared `required_files`) and executes each wave concurrently with `Promise.all`
- Dependent steps that share files still run sequentially within the correct order
- Build time for multi-step projects is noticeably reduced (a 6-step independent build runs in roughly the time of the slowest single step)
- The existing SSE progress events (`step_starting`, `step_completed`) still fire correctly for each step, even when running in parallel

## Out of scope
- Parallelizing the Verifier or Fix cycles (those remain sequential by design)
- Detecting file dependencies automatically via static analysis — use `required_files` from the plan as the dependency signal
- UI changes to show parallel execution lanes

## Tasks
1. **Plan state injection** — Modify the `callEditor` function signature in `build-orchestrator.ts` to accept a `planState` object (completed steps, current step index, total steps). Format this into a concise `[Plan State]` text block and prepend it to the Editor's prompt on every call.

2. **Build the dependency wave scheduler** — Add a `groupIntoWaves(steps)` utility in `build-orchestrator.ts` that takes the normalized plan steps and groups them into execution waves: step A and step B are in the same wave if their `required_files` arrays have no overlap. Steps with overlapping files must be in sequential waves.

3. **Replace the sequential loop with wave execution** — In `runBuildSession`, replace the `for` loop that iterates through steps one-by-one with a wave-based loop: for each wave, run all steps in the wave concurrently using `Promise.all`, then move to the next wave. Update the plan state tracking after each step completes.

4. **Validate SSE event ordering** — Ensure `step_starting` and `step_completed` events still emit correctly when steps run concurrently. Each step should independently emit its own events without race conditions on the shared session state.

## Relevant files
- `server/build-orchestrator.ts`
- `server/editor-prompt.ts`
