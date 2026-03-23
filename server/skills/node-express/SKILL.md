# Node.js + Express Skill

## Project Structure
```
/project/
  index.js (or server.js)  # Entry point, starts the HTTP server
  routes/                  # Route handlers grouped by resource
    users.js
    items.js
  middleware/              # Custom middleware (auth, error handling)
  models/                  # Data models or DB access logic
  utils/                   # Shared helper functions
  public/                  # Static assets served by Express
  package.json
  .env                     # Environment variables (never commit)
```

## Idiomatic Patterns

### Server setup
```js
const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

### Route handlers
- Use `router` objects for resource grouping: `const router = express.Router()`.
- Keep route handlers thin — delegate business logic to service/model functions.
- Return appropriate HTTP status codes: 200 (OK), 201 (Created), 400 (Bad Request), 404 (Not Found), 500 (Server Error).

### Error handling
- Use a centralized error-handling middleware (4-parameter function): `app.use((err, req, res, next) => { ... })`.
- Always call `next(err)` to propagate errors instead of sending responses inline in middleware.

### Async routes
- Wrap async route handlers or use a helper like `asyncHandler` to catch unhandled promise rejections.

## Common Pitfalls
- Forgetting `express.json()` middleware causes request body to be undefined.
- Not calling `next()` in middleware stalls the request pipeline.
- Hardcoding ports or secrets — always use `process.env`.
- Missing error handling for async operations causes silent 500s.
- Sending a response after headers are already sent causes "Cannot set headers after they are sent" errors.

## Code Style
- Use `const` for all requires and route definitions.
- Group middleware registrations before routes.
- Name route files after the resource they handle (`users.js`, `products.js`).
- Use `res.json()` to send JSON responses — never `res.send(JSON.stringify(...))`.
- Add a comment at the top of each route file describing what resource it manages.
