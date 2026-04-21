# Vanilla JavaScript Skill

## Project Structure
```
/project/
  index.html          # Entry point and HTML structure
  style.css           # All styles (or styles/ folder for larger projects)
  src/
    app.js            # Main application bootstrap
    state.js          # Application state and mutations
    ui.js             # DOM update functions
    api.js            # fetch() wrappers
    utils.js          # Pure helper functions
  assets/             # Images, fonts, icons
```

## Idiomatic Patterns

### HTML setup
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

### State management pattern
Keep all mutable state in one place and update the DOM reactively:
```js
// state.js
let state = { todos: [], filter: 'all', loading: false };
const listeners = new Set();

export function getState() { return state; }

export function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);  // returns unsubscribe function
}
```

### DOM rendering — build elements safely
Always create DOM nodes programmatically to avoid security issues with user data:
```js
// ui.js
export function renderTodos(todos, container) {
  container.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (const todo of todos) {
    const li = document.createElement('li');
    li.className = `todo-item${todo.done ? ' done' : ''}`;
    li.dataset.id = todo.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = todo.done;

    const label = document.createElement('span');
    label.textContent = todo.text;  // textContent is safe — no injection risk

    li.append(checkbox, label);
    fragment.appendChild(li);
  }

  container.appendChild(fragment);
}
```

### Event delegation
Attach one listener to a container instead of each child — handles dynamically added items:
```js
document.getElementById('todo-list').addEventListener('click', (e) => {
  const item = e.target.closest('.todo-item');
  if (!item) return;
  const id = item.dataset.id;
  if (e.target.matches('input[type="checkbox"]')) toggleTodo(id);
  if (e.target.matches('.delete-btn')) deleteTodo(id);
});
```

### API layer with fetch
```js
// api.js
const BASE_URL = '/api';

async function request(method, path, data) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, data) => request('POST', path, data),
  put: (path, data) => request('PUT', path, data),
  delete: (path) => request('DELETE', path),
};
```

### App bootstrap
```js
// app.js
import { getState, setState, subscribe } from './state.js';
import { renderTodos } from './ui.js';
import { api } from './api.js';

const listEl = document.getElementById('todo-list');
const form = document.getElementById('add-form');

// Re-render whenever state changes
subscribe((state) => renderTodos(state.todos, listEl));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = form.querySelector('input');
  const text = input.value.trim();
  if (!text) return;
  try {
    const todo = await api.post('/todos', { text });
    setState({ todos: [...getState().todos, todo] });
    input.value = '';
  } catch (err) {
    showError(err.message);
  }
});

async function init() {
  setState({ loading: true });
  try {
    const todos = await api.get('/todos');
    setState({ todos, loading: false });
  } catch (err) {
    setState({ loading: false });
  }
}

init();
```

### LocalStorage helpers
```js
export function persist(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
```

## Common Pitfalls
- Running scripts before the DOM is ready — use `<script type="module">` (deferred by default).
- Using `var` — always use `const` or `let`.
- Rendering user-provided text via `element.textContent` is safe; inserting it as HTML requires a sanitizer (e.g., DOMPurify) to prevent XSS.
- Event listeners on dynamically removed elements prevent garbage collection — remove them on teardown.
- Mutating the DOM inside a loop — build a `DocumentFragment` first to avoid layout thrashing.
- Forgetting `e.preventDefault()` on form submit — causes page reload.
- Global variable pollution — use ES modules (`type="module"`) to keep scope local.
- Not encoding query parameters — use `encodeURIComponent()` when building URL strings.

## Code Style
- `const` by default, `let` only when reassignment is needed. Never `var`.
- Name DOM element references with an `El` suffix: `btnSubmitEl`, `inputEmailEl`, `listEl`.
- Use ES modules — `import`/`export` instead of global scripts.
- Group in `app.js`: imports → element queries → subscriptions → event bindings → init call.
- Keep functions short and single-purpose. Use descriptive verb names: `renderList`, `handleFormSubmit`, `fetchUsers`.
- Pure functions (no side effects) go in `utils.js`; DOM mutation functions go in `ui.js`.
