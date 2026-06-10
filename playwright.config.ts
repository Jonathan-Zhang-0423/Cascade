import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load the test DB credentials the same way the vitest integration setup does,
// so the E2E server points at cascade_test rather than dev/prod data.
loadEnv({ path: ".env.test" });

/**
 * E2E config. The full Express server (API + built SPA) is booted by the
 * `webServer` block on a dedicated port. Every test mocks `/api/*` at the
 * browser network layer (see e2e/_helpers/mock-api.ts), so:
 *   - no real AI provider is called (deterministic, offline, free),
 *   - no auth session or invite code is required,
 *   - the test DB is never mutated by the browser flows.
 *
 * The server still needs to start (to serve the SPA bundle and satisfy any
 * unmocked asset requests); it points at the test DB so an accidental real
 * write never touches dev/prod data.
 *
 * Requires a built client in dist/public — `npm run build` if missing.
 */
const PORT = Number(process.env.E2E_PORT ?? 5099);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One retry everywhere: the suite runs single-worker against one long-lived
  // server, where an occasional animation/layout "element not stable" flake can
  // surface late in the run. Each spec passes deterministically on its own; a
  // retry absorbs the transient without masking real failures (a true break
  // fails both attempts).
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Run the server via tsx in production mode so it serves the prebuilt
    // dist/public SPA without a separate server rebuild step. `node
    // dist/index.mjs` also works now (the SEV-4 CJS crash is fixed), but tsx
    // keeps E2E decoupled from the server bundle.
    command: `cross-env NODE_ENV=production PORT=${PORT} tsx backend/api/src/infra/index.ts`,
    url: BASE_URL,
    // Always boot a fresh server: reusing a long-lived local instance across
    // runs can carry over accumulated in-memory session state and flake the
    // tail of the suite.
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
      SESSION_SECRET: "e2e-secret",
      GLM_API_KEY: "e2e-mock-key",
    },
  },
});
