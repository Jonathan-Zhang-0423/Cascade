# Node.js + Express Skill

## Project Structure
```
/project/
  src/
    index.js (or server.js)  # Entry point, starts the HTTP server
    routes/                  # Route handlers grouped by resource
      users.js
      items.js
    middleware/              # Custom middleware (auth, error handling, validation)
      auth.js
      errorHandler.js
    services/                # Business logic, separate from routes
    models/                  # Data models or DB access logic
    utils/                   # Shared helper functions
    config.js                # Environment config and validation
  public/                    # Static assets served by Express
  package.json
  .env                       # Environment variables (never commit)
  .env.example               # Template for env vars (do commit)
```

## Essential Dependencies
```json
{
  "express": "^4.x",
  "dotenv": "^16.x",
  "cors": "^2.x",
  "helmet": "^7.x",
  "express-validator": "^7.x",
  "jsonwebtoken": "^9.x",
  "bcryptjs": "^2.x",
  "pg": "^8.x",
  "drizzle-orm": "^0.x"
}
```

## Idiomatic Patterns

### Server setup
```js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler } from './middleware/errorHandler.js';
import usersRouter from './routes/users.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/users', usersRouter);

app.use(errorHandler);   // Must be last

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

### Route handlers (thin controllers)
```js
// routes/users.js
import { Router } from 'express';
import { userService } from '../services/userService.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const users = await userService.getAll();
    res.json(users);
  } catch (err) {
    next(err);  // delegate to error handler
  }
});

router.post('/', async (req, res, next) => {
  try {
    const user = await userService.create(req.body);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
```

### Centralized error handler
```js
// middleware/errorHandler.js
export function errorHandler(err, req, res, next) {
  const status = err.status ?? err.statusCode ?? 500;
  const message = status < 500 ? err.message : 'Internal server error';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
}

// Create typed errors:
export class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}
```

### JWT authentication middleware
```js
// middleware/auth.js
import jwt from 'jsonwebtoken';

export function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
```

### Input validation with express-validator
```js
import { body, validationResult } from 'express-validator';

const validateUser = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    next();
  },
];

router.post('/', validateUser, createUser);
```

### Async wrapper to avoid try/catch in every route
```js
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.get('/:id', wrap(async (req, res) => {
  const user = await userService.getById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  res.json(user);
}));
```

### Environment config
```js
// config.js
import 'dotenv/config';

const required = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000'),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
};
```

## Common Pitfalls
- Forgetting `express.json()` middleware — request body is `undefined`.
- Not calling `next(err)` in middleware — request stalls forever.
- Hardcoding ports or secrets — always use `process.env`.
- Missing error handling for async routes — causes unhandled rejection crashes.
- Sending a response after headers are already sent — crashes the process. Call `return res.json(...)`.
- Not using `helmet()` — leaves default security headers missing.
- SQL injection when building queries with string concatenation — always use parameterized queries.
- Storing plain-text passwords — always hash with `bcryptjs`.

## Code Style
- Use ES modules (`import`/`export`) with `"type": "module"` in `package.json`.
- Group middleware registrations before route registrations.
- Name route files after the resource they handle (`users.js`, `products.js`).
- Use `res.json()` to send JSON responses — never `res.send(JSON.stringify(...))`.
- HTTP status codes: 200 OK, 201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict, 500 Internal Server Error.
