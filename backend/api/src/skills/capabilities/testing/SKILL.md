# Testing Skill

How to add tests that actually catch regressions instead of padding a coverage
number: pick the right level (unit / integration / e2e), test behavior not
implementation, cover the edge and failure paths, and keep tests fast and
deterministic. A test that never fails when the code breaks is worse than none.

## Test the behavior, at the cheapest level that proves it

- **Unit** — pure functions / logic, no I/O. Fast, run constantly. Most tests live here.
- **Integration** — a unit + its real collaborators (DB, router, filesystem). Fewer.
- **E2E** — the whole app through the UI. Fewest; reserve for critical user journeys.

Push each test to the lowest level that can prove the behavior. Don't spin up a
browser to check a date formatter. Extract pure logic out of UI/handlers so it can
be unit-tested without mounting anything (e.g. a string transform → its own module).

## A good test: Arrange–Act–Assert, one reason to fail

```js
it("rounds a tax total to 2 decimals", () => {
  const result = computeTotal([{ price: 9.99, qty: 3 }], 0.0825); // Arrange + Act
  expect(result).toBe(32.44);                                      // Assert one thing
});
```

- Name states the expected behavior ("rejects an expired token"), not "test1".
- Assert outputs/effects, not internals. Don't assert a private was called if you can
  assert the result it produced — implementation tests break on every refactor.
- One logical assertion per test; multiple `expect`s are fine if they check one behavior.

## Cover the paths that actually break

The happy path rarely ships the bug. For each unit, test:

- **Boundaries**: 0, empty string/array, 1, max, off-by-one, negative.
- **Bad input**: null/undefined, wrong type, malformed, huge, unicode/emoji.
- **Failure**: the dependency throws / times out / returns an error — assert the code
  handles it (retries, surfaces a message), not just the success case.
- **The regression you're fixing**: when fixing a bug, FIRST write a test that fails
  on the old code, then make it pass. That's how you prove the fix and prevent its return.

```js
it("returns 401 on a wrong password (no user enumeration)", async () => {
  const res = await login({ user: "real", password: "wrong" });
  expect(res.status).toBe(401);
  expect(res.body.error).toBe("Invalid credentials"); // same msg as unknown-user
});
```

## Keep tests deterministic and isolated

Flaky tests get ignored, then everything rots. Eliminate non-determinism:

- No real network/clock/random in unit tests. Inject or mock them; freeze time
  (`vi.useFakeTimers`), seed or stub randomness.
- Each test sets up and tears down its own state; never depend on order or on data a
  previous test left behind. Reset shared state in `beforeEach`.
- For DB/integration: use a dedicated test database and truncate between tests; never
  point tests at dev/prod data.
- Mock the slow/external edges (3rd-party APIs, email/SMS), not the thing under test.

```js
beforeEach(async () => { await truncateAll(); });   // clean slate per test
afterEach(() => { vi.restoreAllMocks(); });
```

## Async & errors

- Always `await` async assertions; a forgotten `await` makes a test pass while broken.
- Assert that a promise rejects with the expected error:
  `await expect(fn()).rejects.toThrow(/timeout/)`.
- Test concurrency where it matters (parallel writes, double-submit) — these are where
  real bugs hide and the happy-path test won't find them.

## E2E: few, stable, user-centric

- Drive the app the way a user does; select by role/label/test-id, not brittle CSS.
- Wait for state/elements, never `sleep(n)`. Assert on what the user sees.
- Keep them to the money paths (sign-up, checkout, the core flow). They're slow and
  costlier to maintain — breadth belongs in unit tests.

## What NOT to do

- Don't test the framework/library itself, or trivial getters.
- Don't write tests that restate the implementation line-for-line (they only break on refactor).
- Don't chase 100% coverage with assertion-free tests; coverage ≠ confidence.
- Don't leave a test that can't fail — delete or fix it.

## Self-check

- [ ] Each behavior tested at the lowest sufficient level; pure logic extracted to unit tests.
- [ ] Test names describe behavior; assert outputs/effects, not internals.
- [ ] Boundaries, bad input, and failure paths covered — not just the happy path.
- [ ] A bug fix ships with a test that fails on the old code.
- [ ] No real network/clock/random; state reset per test; test DB isolated + truncated.
- [ ] Async awaited; rejections asserted; concurrency tested where it matters.
- [ ] E2E limited to critical journeys, selected by role/test-id, no fixed sleeps.
