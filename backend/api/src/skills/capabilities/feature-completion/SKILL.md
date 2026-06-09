# Feature Completion Skill

How to turn a stubbed-out UI into working software: replace placeholders and
hardcoded data with real behavior, wire buttons to actual logic, validate input,
and handle the loading / empty / error states that every real feature has.

## The goal

A feature is "done" when a user can complete the task end-to-end without hitting a
dead button, a fake number, or a blank screen. Scan for these and finish them:

- Buttons/links with no handler (or `onClick={() => {}}`)
- Hardcoded/mock data standing in for real state
- `// TODO`, `// placeholder`, `alert('not implemented')`
- Forms that submit nothing or skip validation
- Lists that never show empty/loading/error states

## Wire actions to real behavior

Replace no-op handlers with real state changes and side effects:

```js
// Before — placeholder
<button onClick={() => alert('TODO')}>Add</button>

// After — real behavior with the three states handled
async function handleAdd() {
  const text = input.trim();
  if (!text) { setError('Please enter a value'); return; }
  setSubmitting(true); setError(null);
  try {
    const item = await api.post('/items', { text });
    setItems(prev => [...prev, item]);
    setInput('');
  } catch (err) {
    setError(err.message ?? 'Something went wrong');
  } finally {
    setSubmitting(false);
  }
}
```

## Replace mock data with real state

Mock arrays are fine for a first paint, but a finished feature owns its data:
load it, mutate it through real operations, and persist it where appropriate
(API, localStorage). If there's no backend, localStorage is a legitimate store —
just make add/edit/delete actually update it.

## Form validation

Validate on submit (and optionally on blur). Show errors next to the field, keep
the user's input, and block submission while invalid.

```js
function validate(values) {
  const errors = {};
  if (!values.email.trim()) errors.email = 'Email is required';
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) errors.email = 'Invalid email';
  if (values.password.length < 8) errors.password = 'Min 8 characters';
  return errors; // empty object = valid
}
```

Validate untrusted input on the server too — client checks are UX, not security.

## The three states every data view needs

```jsx
if (loading) return <Spinner />;
if (error)   return <ErrorMessage onRetry={refetch}>{error}</ErrorMessage>;
if (items.length === 0) return <EmptyState message="No items yet. Add one to get started." />;
return <List items={items} />;
```

An empty list and a still-loading list look identical without this — users can't
tell "nothing here" from "broken".

## Edge cases to finish

- Empty input / whitespace-only / very long input
- Duplicate submissions — disable the button while `submitting`
- Network failure — catch, show a retryable error, don't crash
- Concurrent edits — last-write or optimistic update with rollback
- Zero / one / many items (singular vs plural labels)
- Slow responses — show progress, don't appear frozen

## Common Pitfalls
- Leaving `console.log` "it works" instead of actual logic.
- Swallowing errors silently (`catch {}`) — surface them to the user.
- Optimistic UI without rollback — the screen lies when the request fails.
- Validating only on the client — round-trip untrusted data through server checks.
- Forgetting to clear the input / reset form state after a successful action.
- No disabled/loading state on submit → double-submits.
- Mock data left in alongside real data, causing duplicates.

## Definition of done
- [ ] Every button/link does something real (or is removed)
- [ ] No placeholder text, fake numbers, or unhandled TODOs in the shipped path
- [ ] Forms validate, show errors, and reset on success
- [ ] Loading, empty, and error states all render
- [ ] Data persists across reload (API or localStorage)
- [ ] No uncaught exceptions on the common paths
