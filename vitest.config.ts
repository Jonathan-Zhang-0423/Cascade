import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["backend/api/__tests__/**/*.test.ts"],
  },
});
