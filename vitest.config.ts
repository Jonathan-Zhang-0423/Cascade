import { defineConfig } from "vitest/config";
import { resolve } from "path";

const r = (p: string) => resolve(__dirname, p);

// Path aliases mirror tsconfig.json `compilerOptions.paths` so tests can import
// workspace packages (@cascade/database etc.) the same way the app does.
const alias = {
  "@cascade/database": r("./database/schema/index.ts"),
  "@cascade/shared/types": r("./shared/src/types/index.ts"),
  "@cascade/shared/constants": r("./shared/src/constants/index.ts"),
  "@cascade/shared": r("./shared/src/index.ts"),
  "@shared": r("./shared/src"),
  "@": r("./frontend/web/src"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    // Two projects:
    //   unit        — pure logic, no DB. Always runnable, CI-safe.
    //   integration — route + DB tests (needs TEST_DATABASE_URL); auto-skips
    //                 via describeIntegration when the env var is absent.
    // Stress tests live under stress/ and share the integration setup.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["backend/api/__tests__/**/*.test.ts"],
          exclude: [
            "backend/api/__tests__/integration/**",
            "backend/api/__tests__/stress/**",
            "**/node_modules/**",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: [
            "backend/api/__tests__/integration/**/*.test.ts",
            "backend/api/__tests__/stress/**/*.test.ts",
          ],
          // Integration/stress tests touch real Postgres and spin up the
          // Express app; keep them serial to avoid cross-test DB contention.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
