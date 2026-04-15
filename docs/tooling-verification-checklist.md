# Tooling Verification Checklist

Manual E2E verification for the four new infrastructure layers (file materialization,
AST-grep, LSP, shell/Docker). Run this after any changes to:
`server/ast-tools.ts`, `server/lsp-manager.ts`, `server/lsp-tools.ts`,
`server/shell-manager.ts`, `server/shell-tools.ts`, `server/build-orchestrator.ts`.

---

## Phase 1: File Materialization

- [ ] Start dev server: `npm run dev`
- [ ] Trigger a build via the UI (any small project).
- [ ] While the build is running, open a terminal:
  ```bash
  ls /tmp/codestart-sessions/
  ```
  **Expected:** A directory named with the session UUID exists.
- [ ] List its contents:
  ```bash
  ls /tmp/codestart-sessions/<session-id>/
  ```
  **Expected:** Project files seeded from the in-memory map are present on disk.
- [ ] Wait for the build to complete, then:
  ```bash
  ls /tmp/codestart-sessions/
  ```
  **Expected:** Session directory is gone (cleaned up by `routes.ts` `.finally()`).

---

## Phase 2: AST-Grep

- [ ] Verify `@ast-grep/napi` loads in the current Node environment:
  ```bash
  node --input-type=module <<< "import('@ast-grep/napi').then(m => console.log('ast-grep ok', Object.keys(m)))"
  ```
  **Expected:** Prints `ast-grep ok` followed by exported names including `parse`.
- [ ] Trigger a TypeScript build. The editor agent may call `ast_search` or `ast_replace`
  depending on the task. This is informational — check server logs for those tool names.

---

## Phase 3: LSP

- [ ] Verify `typescript-language-server` is reachable:
  ```bash
  ./node_modules/.bin/typescript-language-server --version
  ```
  **Expected:** Prints a version number (e.g. `5.1.3`).
- [ ] Trigger any TypeScript build and watch server logs.
  **Expected log line:** `[LspManager] started typescript-language-server for session <id>`
- [ ] To test diagnostics: trigger a build of a project with a deliberate TS type error
  (e.g. `const x: number = "hello";`). The verifier agent should call `lsp_diagnostics`
  and report the error as a bug. Check the UI action log.

---

## Phase 4: Shell / Docker

- [ ] Confirm Docker is running:
  ```bash
  docker info
  ```
  **Expected:** Docker version and system info printed, no error.
- [ ] Set `ENABLE_SHELL=true` in your `.env` file, then restart: `npm run dev`
- [ ] Trigger a TypeScript build. Watch for `shell_run` in the UI action log
  (label "Shell" with a command like `tsc --noEmit`).
- [ ] After the build completes, confirm no leftover containers:
  ```bash
  docker ps
  ```
  **Expected:** No `node:20-slim` containers running.
- [ ] Check stopped containers are cleaned up:
  ```bash
  docker ps -a | grep node
  ```
  **Expected:** Empty, or all show `Exited` — none stuck in `Up` state.
