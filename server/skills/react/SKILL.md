# React Skill

## Project Structure
```
/project/
  index.html          # Root HTML entry point
  src/
    main.jsx          # App entry, ReactDOM.createRoot
    App.jsx           # Root component, routing
    components/       # Reusable UI components
    pages/            # Route-level page components
    hooks/            # Custom React hooks
    utils/            # Helper functions
  package.json
  vite.config.js      # Or webpack/parcel config
```

## Idiomatic Patterns

### Component structure
- Use functional components with hooks (no class components).
- Keep components small and focused. Extract reusable pieces into `components/`.
- Colocate state as close to where it's used as possible.
- Use `useState` for local state, `useEffect` for side effects, `useContext` for shared state.

### Data fetching
- Fetch data inside `useEffect` or use a library like `react-query` / `swr`.
- Always handle loading and error states explicitly.

### Event handlers
- Name handlers with the `handle` prefix: `handleClick`, `handleSubmit`.
- Pass handler functions as props using arrow functions: `onClick={() => handleClick(id)}`.

### Lists
- Always provide a stable, unique `key` prop when rendering arrays — use IDs, not array indices.

### Forms
- Prefer controlled inputs (value + onChange) for consistent state.
- Use `onSubmit` on the `<form>` element, call `e.preventDefault()`.

## Common Pitfalls
- Forgetting the `key` prop on list items causes React reconciliation bugs.
- Calling `setState` inside `useEffect` without a dependency array causes infinite loops.
- Direct state mutation (e.g. `arr.push(x)` before `setState`) — always return new objects/arrays.
- Using `index` as key in dynamic lists breaks reordering and focus.
- Missing `useEffect` cleanup for subscriptions or timers causes memory leaks.

## Code Style
- File names: `PascalCase` for components (`UserCard.jsx`), `camelCase` for utilities.
- Destructure props at the top of the component: `function Card({ title, children }) { ... }`.
- Keep JSX readable: one prop per line for complex components, inline for simple ones.
- Use `const` for all variable declarations unless reassignment is required.
- Add a comment above each component explaining its purpose in one sentence.
