# State Management Skill

How to keep application state predictable: a single source of truth, immutable
updates, normalized data, derived values computed on read, side effects kept out
of state, and persistence done in one place. Framework-agnostic principles with
patterns that match this project's vanilla-js and react skills.

## Principles

1. **Single source of truth** — each piece of state lives in exactly one place. Don't copy it into multiple components/modules that can drift.
2. **Immutable updates** — never mutate; produce a new object/array. This makes change detection cheap and time-travel/undo possible.
3. **Normalize** — store collections by id, not as nested arrays you search linearly.
4. **Derive, don't store** — compute totals, filters, and flags from base state on read. Storing them means keeping them in sync forever.
5. **Isolate side effects** — fetching, timers, and storage live outside the reducer/setter. State updates are pure.

## Immutable update patterns

```js
// Add
const next = [...items, newItem];
// Update one by id
const next = items.map(it => it.id === id ? { ...it, done: true } : it);
// Remove
const next = items.filter(it => it.id !== id);
// Nested object
const next = { ...state, user: { ...state.user, name } };
```

Never `items.push()`, `obj.field = x`, or `arr.sort()` (sort mutates — copy first:
`[...arr].sort()`).

## Normalized shape

```js
// Instead of: todos: [{id, text}, ...]  (O(n) lookups, dup-prone)
state = {
  todos: { byId: { a1: {id:'a1', text:'…'}, b2: {…} }, allIds: ['a1','b2'] }
};
// Lookup: state.todos.byId[id]      — O(1)
// Render order: state.todos.allIds.map(id => state.todos.byId[id])
```

Use this once collections get large or are referenced from multiple places. For a
small flat list, a plain array is fine — don't over-engineer.

## Derived state

```js
// Don't store completedCount in state. Compute it:
const completedCount = todos.filter(t => t.done).length;
const visibleTodos = todos.filter(t => filter === 'all' || (filter === 'done') === t.done);
```

In React, wrap expensive derivations in `useMemo`; in vanilla, compute inside the
render function. Storing derived values is the #1 source of "the count is wrong" bugs.

## Vanilla store (matches the vanilla-js skill)

```js
let state = { todos: [], filter: 'all' };
const listeners = new Set();

export const getState = () => state;
export function setState(patch) {
  state = { ...state, ...patch };   // shallow immutable merge
  listeners.forEach(fn => fn(state));
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Actions are the only way to change state — keeps mutations in one file
export const addTodo = (text) =>
  setState({ todos: [...state.todos, { id: crypto.randomUUID(), text, done: false }] });
```

## React: reducer for complex state

```jsx
function reducer(state, action) {
  switch (action.type) {
    case 'add':    return { ...state, todos: [...state.todos, action.todo] };
    case 'toggle': return { ...state, todos: state.todos.map(t =>
                     t.id === action.id ? { ...t, done: !t.done } : t) };
    default: return state;
  }
}
const [state, dispatch] = useReducer(reducer, initialState);
```

Use `useState` for local/simple state, `useReducer` when updates are multi-field or
interdependent, Context to share across a subtree. Reach for a library (Zustand,
Redux) only when prop-drilling or cross-tree sharing actually hurts.

## Persistence — one place, on change

```js
// Subscribe once; serialize the slice you care about
subscribe((s) => persist('app-state', { todos: s.todos }));

function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function hydrate(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
```

Hydrate once at startup into the initial state. Don't scatter `localStorage` calls
across the codebase.

## Common Pitfalls
- Mutating state then setting it (`state.items.push(x); setItems(state.items)`) — React sees the same reference and skips re-render.
- Storing derived data and forgetting to update it — counts/flags go stale.
- Duplicating the same entity in multiple arrays — they desync.
- `sort()`/`reverse()`/`splice()` on state arrays — they mutate in place.
- Doing fetches inside reducers/setters — keep effects out; call the action after the await resolves.
- Deeply nested state — flatten/normalize so updates don't need 4-level spreads.
- Persisting the entire state including transient flags (loading, error) — persist only durable data.

## Checklist
- [ ] Each state value has exactly one owner
- [ ] All updates return new references (no mutation)
- [ ] Derived values computed on read, not stored
- [ ] Side effects live outside state updates
- [ ] Persistence centralized; transient flags excluded
