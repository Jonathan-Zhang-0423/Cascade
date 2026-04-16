# Use required_files for Editor Context

## What & Why
The Manager agent already outputs a `required_files` field on every plan step, but `executeSubTask` ignores it. Instead it runs a fragile regex over the description text to guess which files to include. This leads to missed files (regex doesn't match) or too many files (index.html always appended). The fix threads `required_files` through the data pipeline so the Editor receives exactly and only the files the Manager explicitly listed.

## Done looks like
- When the Manager produces a plan step with `required_files: ["/project/app.js"]`, the Editor Agent receives context for `/project/app.js` only — not the entire project
- When a step has no `required_files` (or an empty array), the Editor falls back to all files (safe default)
- Fix-mode steps (from the fix-cycle prompt) also carry `required_files` so the same logic applies there

## Out of scope
- Changing how the Manager generates `required_files` (already working)
- Changing the Verifier or Communicator agents
- A/B test infrastructure

## Tasks

1. **Add `required_files` to `ManagerSubTask`** — Add `required_files?: string[]` to the `ManagerSubTask` interface in `ide-store.ts`.

2. **Thread `required_files` through the pipeline** — Update `normalizeSteps` in `chat-panel.tsx` to carry `required_files` from the raw plan JSON; add `required_files?: string[]` to the `managerContext` parameter of `executeSubTask`; pass `task.required_files` at both call sites (normal plan execution and fix-cycle execution).

3. **Replace regex path-parsing with `required_files`** — Inside `executeSubTask`, when `managerContext.required_files` is non-empty, filter `allFiles` to exactly that list. Remove the regex path-scan and the unconditional `index.html` append. Keep the full-file fallback for when `required_files` is absent or empty.

4. **Add `required_files` to the fix-mode Manager prompt** — Add `required_files: string[]` to the fix step JSON schema in `MANAGER_FIX_MODE_SYSTEM_PROMPT` with the same "list only directly read/written files" rule, so fix-cycle steps carry the field too.

## Relevant files
- `client/src/stores/ide-store.ts:30-36`
- `client/src/components/ide/chat-panel.tsx:103-113`
- `client/src/components/ide/chat-panel.tsx:1463-1510`
- `client/src/components/ide/chat-panel.tsx:1750-1753`
- `client/src/components/ide/chat-panel.tsx:1914-1917`
- `server/manager-prompt.ts:107-149`
