import { resolve } from "path";

/**
 * Resolve a path under the backend source root (`backend/api/src`).
 *
 * Production builds bundle every server module into a single flattened file
 * (`dist/index.mjs`), so `import.meta.dirname` no longer reflects a module's
 * original directory — and in the previous CJS build it was empty entirely,
 * crashing the process at load (see STRESS_FINDINGS.md SEV-4).
 *
 * `process.cwd()` is the repo root for both `npm run dev` and `npm start`
 * (the same assumption `infra/static.ts` already makes for `dist/public`),
 * so anchoring asset/skill/template lookups on it is stable across dev and
 * prod. Call sites pass the directory that used to be `import.meta.dirname`,
 * expressed relative to the source root, then keep their existing relative
 * segments unchanged.
 */
const SRC_ROOT = resolve(process.cwd(), "backend", "api", "src");

export function srcDir(...segments: string[]): string {
  return resolve(SRC_ROOT, ...segments);
}
