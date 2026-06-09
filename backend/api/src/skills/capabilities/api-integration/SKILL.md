# API Integration Skill

How to connect a frontend to a backend cleanly: one wrapper around fetch/axios,
consistent loading and error states, timeouts and retries for transient failures,
request cancellation, optimistic updates with rollback, and normalized error
handling — including auth headers.

## One request layer

Centralize HTTP in a single module so every call shares base URL, headers, error
normalization, and timeout. Components never call `fetch` directly.

```js
// api.js
const BASE_URL = '/api';

async function request(method, path, { body, signal, headers } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s safety net
  // Chain caller's signal into ours so either can cancel
  if (signal) signal.addEventListener('abort', () => controller.abort());

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeader(), ...headers },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) throw await toApiError(res);
    return res.status === 204 ? null : await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get:    (p, o)    => request('GET', p, o),
  post:   (p, body, o) => request('POST', p, { ...o, body }),
  put:    (p, body, o) => request('PUT', p, { ...o, body }),
  delete: (p, o)    => request('DELETE', p, o),
};
```

## Normalize errors

Turn every failure into one shape so the UI handles them uniformly:

```js
async function toApiError(res) {
  let detail = '';
  try { detail = (await res.json()).message ?? ''; } catch {}
  const err = new Error(detail || `Request failed (${res.status})`);
  err.status = res.status;
  err.isAuth = res.status === 401 || res.status === 403;
  return err;
}
```

Now callers can branch on `err.status` / `err.isAuth` without parsing responses.

## Auth headers

```js
function authHeader() {
  const token = getToken(); // from memory/localStorage
  return token ? { Authorization: `Bearer ${token}` } : {};
}
```

On a 401, clear the token and redirect to login in one place (e.g. an interceptor or
a check in `toApiError`'s caller) — don't scatter auth logic across components.

## Loading & error state in the UI

```js
const [data, setData]       = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError]     = useState(null);

useEffect(() => {
  const ac = new AbortController();
  setLoading(true); setError(null);
  api.get('/items', { signal: ac.signal })
    .then(setData)
    .catch(err => { if (err.name !== 'AbortError') setError(err); })
    .finally(() => setLoading(false));
  return () => ac.abort(); // cancel on unmount / dep change
}, [/* deps */]);
```

Always ignore `AbortError` — a cancelled request is not a user-facing error.

## Retry with backoff (transient failures only)

```js
async function withRetry(fn, { tries = 3, base = 300 } = {}) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (err) {
      const retryable = !err.status || err.status >= 500; // not 4xx
      if (!retryable || i === tries - 1) throw err;
      await new Promise(r => setTimeout(r, base * 2 ** i)); // 300, 600, 1200ms
    }
  }
}
```

Never retry 4xx (client error — retrying won't help) or non-idempotent POSTs without
an idempotency key.

## Optimistic update with rollback

```js
async function toggleDone(id) {
  const prev = items;
  setItems(items.map(it => it.id === id ? { ...it, done: !it.done } : it)); // optimistic
  try {
    await api.put(`/items/${id}/toggle`);
  } catch (err) {
    setItems(prev);            // rollback on failure
    setError('Could not save — reverted.');
  }
}
```

## Common Pitfalls
- Calling `fetch` directly in components — duplicates headers/error logic and is impossible to change later.
- Not checking `res.ok` — fetch only rejects on network failure, a 500 resolves successfully with `ok: false`.
- No timeout — a hung request leaves the UI spinning forever; use `AbortController`.
- Treating `AbortError` as a real error — shows a spurious message on unmount.
- Retrying 4xx or non-idempotent writes — wastes time or duplicates data.
- Optimistic updates without rollback — UI lies when the server rejects.
- Putting the auth token in code or logging it — read from storage, never echo it.
- Forgetting to cancel in-flight requests on unmount/param change — race conditions where stale responses overwrite fresh state.

## Checklist
- [ ] All HTTP goes through one wrapper with base URL + auth + timeout
- [ ] `res.ok` checked; errors normalized to one shape
- [ ] Loading / error / empty states rendered for every fetch
- [ ] Requests cancellable; `AbortError` ignored
- [ ] Retries limited to idempotent + 5xx/network, with backoff
- [ ] Optimistic updates roll back on failure
