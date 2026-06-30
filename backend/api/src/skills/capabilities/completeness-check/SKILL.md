# Completeness Check Skill

A pre-delivery self-audit. Before declaring work done, walk this checklist against
the code you produced and fix what fails. The goal is to catch the gaps that make
software feel broken: dead buttons, missing error handling, blank states, console
errors, and unfinished TODOs.

## How to use this

After implementing, do a focused review pass over the files you touched. For each
category below, search the code and verify. Fix issues directly rather than
reporting them — a finished deliverable has no open items.

## 1. Wiring — nothing is dead

- Every button, link, and interactive control has a real handler (not empty, not `alert('TODO')`).
- Navigation targets exist (no links to routes/pages that aren't defined).
- Form submit actually does something and prevents default page reload.
- Imported symbols are used; referenced functions/components are defined and exported.

Search for: `onClick={() => {}}`, `href="#"`, `TODO`, `FIXME`, `placeholder`,
`not implemented`, `console.log`.

## 2. Error handling

- Every `await` / promise that can reject is inside `try/catch` or has `.catch`.
- Network/IO failures show a user-visible message, not a silent fail or crash.
- No empty `catch {}` blocks that swallow errors.
- Inputs that can be null/undefined are guarded before property access.

## 3. State coverage

- Data views render **loading**, **empty**, and **error** states — not just success.
- Lists handle zero / one / many (correct singular vs plural, no `0 items` looking broken).
- Initial render doesn't flash wrong content before data loads.

## 4. Runs clean

- No console errors or warnings during a normal session (load, primary action, navigation).
- No unhandled promise rejections.
- No references to undefined variables / missing imports.
- Build / type-check passes (run the project's check command).

## 5. Data integrity

- State that should survive reload is persisted (API or localStorage) and reloaded on init.
- Mutations (add/edit/delete) update both the in-memory state and the store.
- No leftover mock data duplicating real data.

## 6. Inputs & edge cases

- Empty, whitespace-only, and over-long inputs are handled.
- Double-submit is prevented (disabled/loading state).
- Division by zero, empty arrays, and missing optional fields don't throw.

## 7. Responsive & accessible (UI)

- Layout doesn't overflow or break on a narrow (mobile) viewport.
- Interactive elements are keyboard-reachable with a visible focus ring.
- Inputs have labels; meaningful images have `alt`.

## Audit method

1. Grep the touched files for the placeholder/TODO patterns above — resolve each hit.
2. Trace each interactive element to its handler — confirm it's real.
3. For each data fetch, confirm loading/empty/error branches exist.
4. Run the build/type-check and, if possible, the app — watch the console.
5. Exercise one full happy path plus one failure path (e.g. network off).

## Report format (if asked to report rather than fix)

Group findings by severity:
- **Blocking** — crashes, dead primary actions, build failures.
- **Important** — missing error/empty states, unhandled edge cases.
- **Polish** — minor a11y, copy, responsive nits.

For each: file:line, what's wrong, and the concrete fix.

## Common gaps this catches
- A "Save" button that logs to console instead of saving.
- A list that shows a spinner forever because the error case sets nothing.
- A form that crashes on empty submit.
- Mobile layout where a fixed-width element overflows the screen.
- A `TODO: handle error` left in the network layer.
- Console flooded with React key warnings or `undefined` access errors.

## Self-check
- [ ] Grep for dead patterns: `onClick={() => {}}`, `href="#"`, `TODO`, `FIXME`, `placeholder`, stray `console.log`.
- [ ] Every promise/await has a catch; no empty `catch {}` swallowing errors.
- [ ] Every data view renders loading, empty, and error states — not just success.
- [ ] No console errors or unhandled rejections during a normal session.
- [ ] State persists (API or localStorage) and reloads correctly on init.
- [ ] Edge cases handled: empty input, double-submit, missing optional fields.
- [ ] Build/type-check passes; layout holds on mobile; interactive elements keyboard-reachable.
