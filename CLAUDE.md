# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start full-stack dev server (client + server on same port, default 5000)
npm run build      # Build for production (Vite for client → dist/public, esbuild for server → dist/index.cjs)
npm start          # Run production build
npm run check      # TypeScript type-check only (no emit)
npm run db:push    # Push Drizzle schema changes to PostgreSQL

npm test           # Vitest: unit + integration + stress (needs TEST_DATABASE_URL for the latter two)
npm run test:unit  # Pure-logic unit tests only (no DB; always runnable)
npm run test:integration  # Route + DB integration tests
npm run test:stress       # Concurrency / high-frequency / fuzz stress tests
npm run test:e2e   # Playwright browser E2E (boots the server, mocks /api)
npm run test:all   # Vitest + Playwright
```

A full automated test suite lives in `backend/api/__tests__/` (unit/integration/stress) and `e2e/` (Playwright). See `backend/api/__tests__/README.md` for layout, the test-DB setup, and how AI calls are mocked. Real product defects surfaced by the suite are tracked in `STRESS_FINDINGS.md` at the repo root.

## Architecture Overview

### Single-port full-stack

Express serves both the API (`/api/*`) and the React client from one process. In dev, Vite middleware is mounted on the Express app (`backend/api/src/infra/vite.ts`). In production, Express serves the built static files from `dist/public`. Entry point: `backend/api/src/infra/index.ts`.

### AI agent pipeline (the core product)

There are two distinct chat modes with separate agent pipelines:

**Plan mode** (`/api/manager-chat`):
- Manager agent reads the codebase + user message → produces a structured `ManagerPlan` (JSON with steps)
- Streams SSE events: `thinking_token`, `communicator_narration_starting`, `communicator_token`, `plan_ready`, `manager_done`
- Client stream handler: `frontend/web/src/services/stream/manager-stream-instance.ts`

**Build mode** (`/api/build-session`):
- Editor agent executes each plan step (reads/writes files via tools)
- Verifier agent reviews the result after all steps complete
- Streams SSE events: `step_starting`, `narration_token`, `code_applied`, `step_completed`, `reviewing`, `bugs_found`, `all_complete`, `done`
- Client stream handler: `frontend/web/src/services/stream/build-stream-instance.ts`

Sessions are kept alive server-side (stored in memory maps in `backend/api/src/api/routes/index.ts`). Clients can reconnect mid-stream using session IDs stored in localStorage.

### Agent tools

Tools exposed to the LLM agents are built in `backend/api/src/agent/tools/` and assembled per-agent (builder/fixer get the full set; verifier/reviewer/manager get read-only subsets). Categories:

- **File I/O** (`agent-tools.ts`): `write_file`, `read_file`, `patch_file`, `hash_patch_file`, `delete_file`. All text-only; no binary/image support. `read_file` appends a block-hash index so the agent can target blocks with `hash_patch_file`.
  - `patch_file` requires `old_content` to match **exactly once** — it refuses ambiguous (multi-match) patches rather than silently patching the first occurrence. Use `hash_patch_file` for repeated patterns.
  - File writes/deletes mirror to three places: `session.files` (in-memory), the DB (`storage.upsertProjectFile`/`deleteProjectFile`), and the on-disk session dir (`/tmp/cascade-sessions/<id>`, for LSP/shell), plus an LSP change notification.
- **Code intelligence**: `ast_search`/`ast_replace` (ast-grep structural search/rewrite), `lsp_diagnostics`/`lsp_find_references`/`lsp_goto_definition` (`lsp-manager.ts`). TS/TSX writes return inline LSP diagnostics in the tool response.
- **Shell/compile/test** (`shell-tools.ts`, `test-tools.ts`): `shell_run`, `run_tests`. Runs in a per-command Docker sandbox (`shell-manager.ts`): `network=none`, 512MB / 0.5 CPU, project bind-mounted at `/workspace`. Gated by `ENABLE_SHELL=true`. Sandbox images (`node:20-slim`, `ghcr.io/cirruslabs/flutter:stable`) are auto-pulled on first use.
- **Control-flow**: `mark_step_complete`, `finish_build` (builder), `submit_plan` (manager), `submit_verdict`/`submit_review`/`report_issue` (verifier/reviewer). Completing the final step trips a shared exit signal so the builder loop ends deterministically instead of relying on the model to emit `finish_build`.
- **Absent by design**: no network/HTTP-fetch tool, no image/OCR/binary tool. Agents cannot reach the network except through the sandboxed shell (which itself runs `network=none`).

### Capability skills

An additive guidance layer, orthogonal to the framework/tech-stack skills. Each is a `SKILL.md` under `backend/api/src/skills/capabilities/<name>/`; `capability-loader.ts` keyword-scores the user/plan text (bilingual zh/en, no LLM call) and injects the matches into the build/manager system prompt.

- Selection is **tiered & token-aware**: top `FULL_CAPABILITIES` (default 2) get their complete `SKILL.md`; further matches that clear a relative score gate get a compact **digest** (description + checklist, ~10 lines), up to `MAX_CAPABILITIES` (default 6). Env-tunable: `CAPABILITY_FULL` / `CAPABILITY_MAX` / `CAPABILITY_SECONDARY_RATIO` / `CAPABILITY_MIN_SCORE`.
- Adding a skill = new directory + `SKILL.md` (with a `## Self-check`/`## Checklist`-style `- [ ]` section for the digest) + a `CAPABILITY_KEYWORDS` entry, and bump `EXPECTED` in `capability-loader.test.ts`.



All IDE state lives in Zustand (`frontend/web/src/stores/ide-store.ts`) and is debounce-persisted to localStorage under `cascade-project-${projectId}`. On project switch, `loadProject()` restores state from localStorage and falls back to the DB for files.

Key fields:
- `managerMessages[]` — plan-mode message history (user bubbles, plan cards, narration)
- `chatMessages[]` — build-mode editor message history
- `_nextSeq` — shared monotonic counter used to merge both arrays into a single sorted list in `ChatMessageList`
- `managerPlan` — the active `ManagerPlan` object
- `taskStatuses` — per-step status map keyed by step number string

Both `managerMessages` and `chatMessages` are merged by `seq` in `ChatMessageList.tsx` for display.

### Message ordering invariant

`_nextSeq` is shared across both message arrays. Every `addManagerMessage` and `addChatMessage` consumes the next seq. This counter is persisted to localStorage. If it resets to 1 after a reload, new messages get seq 1 and sort to the top of history (appearing to "disappear").

### Preview pipeline

Browser-based device simulator — required because iOS App Store clause 2.5.2 forbids compiling/running native code inside an app.

| Framework | Approach | Status |
|-----------|----------|--------|
| Web | Direct iframe | Working |
| React Native | Babel → react-native-web → iframe | Partially working |
| Flutter | DartPad embed fallback | Broken |
| Kotlin | Needs Compose Multiplatform pipeline | Broken |

React Native compilation: `backend/api/src/compiler/rn-web/rn-web-compiler.ts` — Babel transforms TSX, esbuild bundles a vendor file (`rn-vendor.js`), the result is injected into an iframe. Vendor bundle is cached on disk.

### Database

PostgreSQL via Drizzle ORM. Schema in `shared/schema.ts`:
- `users`, `projects`, `projectFiles`

Files are stored both in the DB (`projectFiles`) and in localStorage. The DB is authoritative for files; localStorage is authoritative for chat/device/session state.

### Path aliases

- `@/` → `frontend/web/src/`
- `@shared/` → `shared/src/`
- `@cascade/shared` → `shared/src/index.ts`
- `@cascade/database` → `database/schema/index.ts`

### AI providers

All providers use the OpenAI-compatible chat completions API. Configured via env vars (`DOUBAO_API_KEY`, `KIMI_API_KEY`, `MINIMAX_API_KEY`, `GLM_API_KEY`). Default is Doubao. Provider selection is per-project, stored in localStorage.

### Desktop/mobile parity (UI changes)

Several pages (e.g. `frontend/web/src/pages/app-detail.tsx`, `create-square.tsx`) share business logic across breakpoints but diverge in rendering: plain Tailwind `sm:`/`lg:` responsive classes for pure visual differences, and fully separate JSX branches (e.g. an `isDesktop` check) for interaction patterns that only exist on one breakpoint (like the mobile-only immersive fullscreen preview). Past redesigns landed only on desktop and silently left mobile behind (e.g. a desktop preview panel redesign shipped without updating the mobile immersive-preview branch, and `group-hover`-only reveal buttons — comment delete, card share/fork — are invisible on touch devices since there is no hover state).

**When making a UI/UX change to a page or component that renders differently on mobile vs desktop: always check both breakpoints before considering the change done.** If a change is desktop-only or mobile-only by nature, say so explicitly and confirm with the user whether the other breakpoint needs an equivalent treatment — don't silently skip it.

## Key Files

| File | Role |
|------|------|
| `backend/api/src/api/routes/index.ts` | All API endpoints (~3900 lines) |
| `backend/api/src/agent/prompts/manager-prompt.ts` | Manager agent system prompt |
| `backend/api/src/agent/prompts/editor-prompt.ts` | Editor agent system prompt |
| `backend/api/src/agent/prompts/communicator-prompt.ts` | Communicator agent prompt (step narration + completion summary) |
| `backend/api/src/agent/tools/agent-tools.ts` | File I/O + control-flow agent tools (write/read/patch/delete, step/plan/verdict) |
| `backend/api/src/agent/tools/shell-manager.ts` | Docker sandbox for `shell_run` (per-command container, auto-pulls images) |
| `backend/api/src/skills/capability-loader.ts` | Capability-skill keyword scorer + tiered (full/digest) injection |
| `frontend/web/src/stores/ide-store.ts` | All IDE state, persistence, checkpoints |
| `frontend/web/src/services/stream/manager-stream-instance.ts` | Plan mode SSE stream handler |
| `frontend/web/src/services/stream/build-stream-instance.ts` | Build mode SSE stream handler |
| `frontend/web/src/components/ide/chat/hooks/useSSEStream.ts` | Shared SSE frame parser + heartbeat watchdog |
| `frontend/web/src/components/ide/chat/ChatMessageList.tsx` | Merges + renders both message arrays |
| `frontend/web/src/components/ide/chat/plan-components.tsx` | Plan card, narration bubble, task steps |
| `backend/api/src/compiler/rn-web/rn-web-compiler.ts` | React Native → browser preview compiler |
| `backend/api/__tests__/` | Unit / integration / stress tests (+ README) |
| `e2e/` | Playwright browser E2E tests |
| `STRESS_FINDINGS.md` | Real product defects surfaced by the test suite |
