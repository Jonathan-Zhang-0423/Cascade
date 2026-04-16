# Editor Context A/B Test

## What & Why

The Editor Agent currently picks which files to send based on path mentions in the Manager's step description — a fragile heuristic. Two cleaner fixes were proposed:

- **Variant A (All Files)**: Always send the full project to the Editor. Dead simple. Guarantees no missing context. Costs more tokens.
- **Variant B (Manager Annotates)**: Manager adds a `required_files` array to each plan step. Editor gets exactly those files. Smarter, but relies on Manager being accurate.

This task builds a live A/B test that runs both variants against the same 3 fixed scenarios, measures speed (ms latency + file-chars sent as a token proxy) and accuracy (Verifier `requirement_match_percent` + `overall_status`), and shows a side-by-side results table so we can decide which to ship.

## Done looks like

- A new page at `/ab-test` (only visible in dev, not in the sidebar nav) with a "Run Test" button
- Clicking Run Test fires a single API call that runs both variants across all 3 scenarios concurrently
- Results table shows per-scenario: latency (ms), chars sent to Editor, Verifier pass/fail, requirement match %
- Aggregate row at the bottom shows mean values for each variant
- No permanent changes to the Editor or Manager pipeline — both variants run only inside the test endpoint

## Out of scope

- Choosing a winner and replacing the existing pipeline (that's the follow-up task)
- Authentication or access control on the test page
- More than 3 test scenarios

## Tasks

1. **Add `required_files` to Manager prompt** — Extend the Manager Agent's Mode 2 plan JSON schema (in `server/manager-prompt.ts`) to include a `required_files: string[]` field on each step. Update the prompt instructions to tell Manager to list only the files that step will read or write.

2. **Create test scenarios** — Add `server/ab-test-scenarios.ts` with 3 hardcoded scenarios. Each scenario has: `userRequest`, `initialFiles` (the project state before the step), a single-step `plan` (matching the Manager plan format, with both description text and `required_files` populated), and `expectedOutput` notes for the Verifier.

3. **Build the A/B test server endpoint** — Add `POST /api/ab-test` to `server/routes.ts`. For each scenario it runs Variant A and Variant B concurrently: both call `/api/chat` (the Editor endpoint) with the same prompt but different file lists. After each finishes it runs the Verifier. It records start/end timestamps, file-chars count, and Verifier output. Returns structured JSON with per-scenario results for both variants.

4. **Build the results UI page** — Add `client/src/pages/ab-test.tsx` with a clean table UI. Scenarios are rows; columns are Variant A vs B. Each cell shows: latency (ms), chars sent, pass/fail badge, match %. An aggregate stats row sits at the bottom. Register the route in `client/src/App.tsx`.

## Relevant files

- `server/manager-prompt.ts`
- `server/editor-prompt.ts`
- `server/verifier-prompt.ts`
- `server/routes.ts`
- `server/doubao-client.ts`
- `client/src/App.tsx`
