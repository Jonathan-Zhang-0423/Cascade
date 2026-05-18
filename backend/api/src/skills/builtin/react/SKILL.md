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
    services/         # API calls, data fetching
    context/          # React context providers
  package.json
  vite.config.js      # Or webpack/parcel config
```

## Essential Dependencies
```json
{
  "react": "^18.x",
  "react-dom": "^18.x",
  "react-router-dom": "^6.x",
  "@tanstack/react-query": "^5.x",
  "axios": "^1.x"
}
```

## Idiomatic Patterns

### Component structure
- Use functional components with hooks (no class components).
- Keep components small and focused. Extract reusable pieces into `components/`.
- Colocate state as close to where it's used as possible.
- Accept `className` and spread `...props` in reusable components for flexibility.

```jsx
function Button({ children, variant = 'primary', className = '', ...props }) {
  return (
    <button
      className={`btn btn-${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
```

### Hooks
- `useState` — local mutable state.
- `useEffect` — side effects (fetch, subscriptions, timers). Always return a cleanup function.
- `useContext` — consume shared context; wrap with `useReducer` for complex state.
- `useCallback` — memoize callbacks passed to child components to prevent unnecessary re-renders.
- `useMemo` — memoize expensive computations.
- `useRef` — DOM refs and mutable values that don't trigger re-render.

### Custom hooks
Extract stateful logic into custom hooks for reuse:
```jsx
function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? initialValue;
    } catch {
      return initialValue;
    }
  });
  const set = (v) => {
    setValue(v);
    localStorage.setItem(key, JSON.stringify(v));
  };
  return [value, set];
}
```

### Data fetching with React Query
```jsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

function UserProfile({ userId }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetch(`/api/users/${userId}`).then(r => r.json()),
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  return <div>{data.name}</div>;
}
```

### Routing with React Router v6
```jsx
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/users/:id" element={<UserDetail />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  // ...
}
```

### Forms
- Prefer controlled inputs (value + onChange) for consistent state.
- For complex forms, use `react-hook-form` to minimize re-renders.
```jsx
import { useForm } from 'react-hook-form';

function LoginForm({ onSubmit }) {
  const { register, handleSubmit, formState: { errors } } = useForm();
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('email', { required: 'Email is required' })} />
      {errors.email && <span>{errors.email.message}</span>}
      <button type="submit">Login</button>
    </form>
  );
}
```

### Lists
- Always provide a stable, unique `key` prop — use IDs, not array indices.
- Virtualize long lists with `react-window` or `react-virtual`.

### Error boundaries
Wrap major UI sections to prevent the whole page from crashing:
```jsx
import { ErrorBoundary } from 'react-error-boundary';

function App() {
  return (
    <ErrorBoundary fallback={<ErrorPage />}>
      <MainContent />
    </ErrorBoundary>
  );
}
```

### Context for global state
```jsx
const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  return useContext(AuthContext);
}
```

## Common Pitfalls
- Forgetting the `key` prop on list items causes React reconciliation bugs.
- Calling `setState` inside `useEffect` without a dependency array causes infinite loops.
- Direct state mutation (`arr.push(x)` before `setState`) — always return new objects/arrays.
- Using `index` as key in dynamic lists breaks reordering and focus.
- Missing `useEffect` cleanup for subscriptions or timers causes memory leaks.
- Over-fetching: put data fetching at the closest parent that needs the data, not the top level.
- `useCallback`/`useMemo` without profiling — they add overhead; only use when measurably needed.

## Code Style
- File names: `PascalCase` for components (`UserCard.jsx`), `camelCase` for utilities.
- Destructure props at the top of the component.
- Keep JSX readable: one prop per line for complex components, inline for simple ones.
- Use `const` for all variable declarations unless reassignment is required.
- Co-locate component tests in `__tests__/` next to the component file.
