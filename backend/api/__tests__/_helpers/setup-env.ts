/**
 * Integration/stress test setup — runs BEFORE any test module (and therefore
 * before the app's `infra/db.ts` reads DATABASE_URL at import time).
 *
 * It loads `.env.test` (if present), then redirects DATABASE_URL to the
 * dedicated test database so the app's pg pool never touches the dev DB.
 *
 * Registered as `setupFiles` for the `integration` vitest project.
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "../../../..");

// Load base .env first (for AI keys etc.), then .env.test overrides.
if (existsSync(resolve(root, ".env"))) loadEnv({ path: resolve(root, ".env") });
if (existsSync(resolve(root, ".env.test"))) loadEnv({ path: resolve(root, ".env.test"), override: true });

// The whole integration suite runs against TEST_DATABASE_URL. If it's set,
// hard-redirect DATABASE_URL so every `import { db }` in the app uses it.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Routes guard on DOUBAO_API_KEY presence before doing work; the AI mock
// intercepts the actual network call, so a dummy value is enough.
if (!process.env.DOUBAO_API_KEY) process.env.DOUBAO_API_KEY = "test-key";

// Keep NODE_ENV=test so the app doesn't try to mount Vite or serve static.
process.env.NODE_ENV = process.env.NODE_ENV || "test";
