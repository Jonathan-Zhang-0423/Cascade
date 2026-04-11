# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start full-stack dev server (client + server on same port, default 5000)
npm run build      # Build for production (Vite for client → dist/public, esbuild for server → dist/index.cjs)
npm start          # Run production build
npm run check      # TypeScript type-check only (no emit)
npm run db:push    # Push Drizzle schema changes to PostgreSQL
```

No test suite exists — verification is manual via browser.

## Architecture Overview

### Single-port full-stack

Express serves both the API (`/api/*`) and the React client from one process. In dev, Vite middleware is mounted on the Express app (`server/vite.ts`). In production, Express serves the built static files from `dist/public`. Entry point: `server/index.ts`.

### AI agent pipeline (the core product)

There are two distinct chat modes with separate agent pipelines:

**Plan mode** (`/api/manager-chat`):
- Manager agent reads the codebase + user message → produces a structured `ManagerPlan` (JSON with steps)
- Streams SSE events: `thinking_token`, `communicator_narration_starting`, `communicator_token`, `plan_ready`, `manager_done`
- Client hook: `useManagerStream.ts`

**Build mode** (`/api/build-session`):
- Editor agent executes each plan step (reads/writes files via tools)
- Verifier agent reviews the result after all steps complete
- Streams SSE events: `step_starting`, `narration_token`, `code_applied`, `step_completed`, `reviewing`, `bugs_found`, `all_complete`, `done`
- Client hook: `useBuildStream.ts`

Sessions are kept alive server-side (stored in memory maps in `routes.ts`). Clients can reconnect mid-stream using session IDs stored in localStorage.

### State management

All IDE state lives in Zustand (`client/src/stores/ide-store.ts`) and is debounce-persisted to localStorage under `codestart-project-${projectId}`. On project switch, `loadProject()` restores state from localStorage and falls back to the DB for files.

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

React Native compilation: `server/rn-web-compiler.ts` — Babel transforms TSX, esbuild bundles a vendor file (`rn-vendor.js`), the result is injected into an iframe. Vendor bundle is cached on disk.

### Database

PostgreSQL via Drizzle ORM. Schema in `shared/schema.ts`:
- `users`, `projects`, `projectFiles`

Files are stored both in the DB (`projectFiles`) and in localStorage. The DB is authoritative for files; localStorage is authoritative for chat/device/session state.

### Path aliases

- `@/` → `client/src/`
- `@shared/` → `shared/`

### AI providers

All providers use the OpenAI-compatible chat completions API. Configured via env vars (`DOUBAO_API_KEY`, `KIMI_API_KEY`, `MINIMAX_API_KEY`, `GLM_API_KEY`). Default is Doubao. Provider selection is per-project, stored in localStorage.

## Key Files

| File | Role |
|------|------|
| `server/routes.ts` | All API endpoints (~2400 lines) |
| `server/manager-prompt.ts` | Manager agent system prompt |
| `server/editor-prompt.ts` | Editor agent system prompt |
| `server/communicator-prompt.ts` | Communicator agent prompt (step narration + completion summary) |
| `client/src/stores/ide-store.ts` | All IDE state, persistence, checkpoints |
| `client/src/components/ide/chat/hooks/useManagerStream.ts` | Plan mode SSE stream handler |
| `client/src/components/ide/chat/hooks/useBuildStream.ts` | Build mode SSE stream handler |
| `client/src/components/ide/chat/ChatMessageList.tsx` | Merges + renders both message arrays |
| `client/src/components/ide/chat/plan-components.tsx` | Plan card, narration bubble, task steps |
| `server/rn-web-compiler.ts` | React Native → browser preview compiler |
