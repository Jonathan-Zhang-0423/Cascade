# Cascade AI — Mobile-First AI Development Platform

## Overview
Cascade AI is a mobile-first development platform designed to enable complete beginners to build production-ready iOS and Android applications using AI coding agents. It supports multiple mobile frameworks (React Native/Expo, Flutter, SwiftUI, Kotlin/Jetpack Compose) and languages (TypeScript, Dart, Swift, Kotlin). Users interact with AI coding agents through natural language and can preview apps in a device simulator. The platform supports isolated projects, each with its own files, chat history, and preview.

**Deployment target:** Self-hosted VPS (full toolchain control — no Replit or cloud sandbox).

## User Preferences
The AI assistant:
- Demands clarity from the user.
- Confirms understanding before building.
- Avoids jargon in explanations and code comments.
- Follows an iterative development approach.
- Includes 1-3 emojis in approximately 90% of responses to maintain a warm and friendly tone.
- Provides beginner-friendly, no-jargon inline comments on every line of generated code, matching the user's language.

## System Architecture
The Cascade IDE uses a single-port full-stack architecture. Express serves both the API (`/api/*`) and the React client from one process. In dev, Vite middleware is mounted on the Express app (`server/vite.ts`). In production, Express serves static files from `dist/public`.

**Frontend**:
- React 18 + TypeScript + Vite
- Styling: Tailwind CSS + Radix UI (shadcn/ui)
- State management: Zustand, with project data debounce-persisted to localStorage
- Code editor: `@monaco-editor/react`
- Routing: Wouter
- UI: dark-themed interface with Geist font, midnight studio color palette, CSS transition tokens

**Backend**:
- Express 5 + TypeScript (tsx), entry point `server/index.ts`
- Database: PostgreSQL + Drizzle ORM, schema in `shared/schema.ts`
- AI providers: Doubao (default), Kimi K2.5, MiniMax, GLM-4 — all OpenAI-compatible

## Core Features & Design Patterns

### Multi-Agent AI Pipeline
Two distinct chat modes with separate agent pipelines:

**Plan mode** (`/api/manager-chat`):
- Manager agent reads codebase + user message → produces structured `ManagerPlan` (JSON with steps)
- Streams SSE events: `thinking_token`, `communicator_narration_starting`, `communicator_token`, `plan_ready`, `manager_done`
- Client hook: `useManagerStream.ts`

**Build mode** (`/api/build-session`):
- Editor agent executes each plan step (reads/writes files via tools)
- Verifier agent reviews after all steps complete
- Streams SSE events: `step_starting`, `narration_token`, `code_applied`, `step_completed`, `reviewing`, `bugs_found`, `all_complete`, `done`
- Client hook: `useBuildStream.ts`

**Agent roster (4 agents):**
- **Manager Agent** — conversational planning, brainstorming, structured task plan generation
- **Editor Agent** — code execution per plan step
- **Verifier Agent** — holistic project review (bugs, regressions, missing features)
- **Communicator Agent** — user-facing progress narration in real-time

### State Management
All IDE state lives in Zustand (`client/src/stores/ide-store.ts`), debounce-persisted to localStorage under `codestart-project-${projectId}`. On project switch, `loadProject()` restores from localStorage, falls back to DB for files.

Key fields:
- `managerMessages[]` — plan-mode message history (user bubbles, plan cards, narration)
- `chatMessages[]` — build-mode editor message history
- `_nextSeq` — shared monotonic counter for cross-array message ordering
- `managerPlan` — the active `ManagerPlan` object
- `taskStatuses` — per-step status map keyed by step number string

Both arrays are merged by `seq` in `ChatMessageList.tsx` for display.

### Message Ordering
`_nextSeq` is a shared monotonic counter across both message arrays. Every `addManagerMessage` and `addChatMessage` consumes the next seq value. This counter is persisted to localStorage. Messages are sorted by `seq` (fallback: timestamp) in `ChatMessageList.tsx`.

### Agent Stream Persistence (AgentStreamProvider)
`useManagerStream` and `useBuildStream` are hoisted to a singleton `AgentStreamProvider` at the App root (`client/src/components/ide/AgentStreamProvider.tsx`), so SSE connections survive navigation (e.g., going to the dashboard and back). `useEditorStream` is excluded — it handles short-lived direct edits and doesn't need this treatment.

### Checkpoint / Rollback System
Automatic checkpoints created before and after each AI build. Users can browse checkpoint history in `CheckpointPanel.tsx` and restore any past state. Diffs are shown inline via `InlineDiffView.tsx`.

### Session Survival & Reconnection
- Build sessions and manager sessions are kept alive server-side (30-min done retention, memory maps in `routes.ts`)
- Clients can reconnect mid-stream using session IDs stored in localStorage
- `StreamingSnapshot` persisted to localStorage during active SSE streams — enables UI state restoration after page reload or HMR
- Completed plans persisted to `projects.last_plan` DB column; build results to `projects.last_build_result`

### Preview Pipeline
Browser-based device simulator — required because iOS App Store clause 2.5.2 forbids compiling/running native code inside an app.

| Framework | Approach | Status |
|-----------|----------|--------|
| Web | Direct iframe | ✅ Working |
| React Native | Babel → react-native-web → iframe | 🟡 Partially working |
| Flutter | DartPad embed + flutter build web | 🔴 Broken (no SDK) |
| Kotlin | Kotlin/Wasm + Compose Multiplatform | 🔴 Broken (wrong pipeline) |
| SwiftUI | SHELVED — code view only | ⏸ Shelved |

### Performance Optimizations
- Non-blocking Communicator calls (fire-and-forget for narration events)
- `max_tokens` caps on all AI endpoints
- Filtered Manager conversation history (excludes Communicator narration)
- `requestAnimationFrame`-based streaming UI updates (aligned to screen refresh)
- Relevant-files-only context for Editor agent

### Chat Panel Modular Architecture
`chat-panel.tsx` is a thin orchestrator delegating to composable hooks and modules under `client/src/components/ide/chat/`:
- `hooks/useSSEStream.ts` — reusable SSE parsing, heartbeat watchdog, reconnect controller
- `hooks/useManagerStream.ts` — Manager chat SSE flow, plan preparation, communicator integration
- `hooks/useBuildStream.ts` — Build session SSE flow, phase tracking, action log accumulation
- `chat-types.ts` — shared types, constants, i18n strings
- `chat-utils.tsx` — pure utilities (language detection, code parsing, markdown rendering)
- `action-log.tsx` — grouped consecutive tool calls with multi-icon strips, collapsible
- `message-components.tsx` — chat bubbles, code blocks, checkpoint markers, completion cards
- `plan-components.tsx` — plan card, step items, review badges, manager message bubbles
- `BuildPhaseIndicator.tsx` — build phase pill (Thinking/Working/Verifying/Fixing) with animated icons
- `error-boundary.tsx` — React ErrorBoundary wrapping chat panel

### My Coding Notebook / Learner Space
- **Mentor Agent** analyzes project files → structured learning content (project summary, file breakdowns, mind map, learning tips)
- Workspace ↔ Learner Space toggle in navbar
- Auto-generation on first visit, manual refresh button

### LLM Output Monitor
Non-modal floating panel with real-time color-coded, source-labeled events from LLM interactions. Pub/sub event bus with batching.

### QR Code Phone Preview
Local preview server serves project files with live reload via WebSockets, accessible on device via QR code. Sessions are token-scoped and auto-expire.

## File Structure

```
client/src/
  stores/
    ide-store.ts               - All IDE state: files, chat, devices, preview, sessions, _nextSeq
    project-store.ts           - Project CRUD, dashboard state
  components/ide/
    AgentStreamProvider.tsx     - Singleton context: hoists useManagerStream + useBuildStream to App root
    CheckpointPanel.tsx         - Checkpoint history browser with restore
    InlineDiffView.tsx          - Inline +/- diff per file after build
    navbar.tsx                  - Header: project name, framework badge, space toggle, layout controls
    tools-dock.tsx              - Vertical icon dock (files, chat, notebook, checkpoints)
    file-tree.tsx               - File explorer with CRUD
    code-editor.tsx             - Monaco + tab management
    chat-panel.tsx              - AI chat orchestrator (~960 lines, delegates to hooks/modules)
    chat/hooks/
      useManagerStream.ts       - Plan mode SSE stream handler
      useBuildStream.ts         - Build mode SSE stream handler
      useSSEStream.ts           - Shared SSE utilities
    chat/
      CodestartLoader.tsx       - Branded 3-bar loader animation
    preview-panel.tsx           - Preview coordinator + device controls + QR
    device-simulator.tsx        - Phone/tablet frame chrome (iOS/Android)
    rn-web-preview.tsx          - React Native → Babel → iframe
    flutter-web-preview.tsx     - Flutter → flutter build web → iframe
    wasm-preview.tsx            - WASM preview (Swift/Kotlin — shelved/broken)
    code-preview.tsx            - Syntax-highlighted code fallback
  lib/
    preview-adapters.ts         - Framework → preview mode mapping
    device-specs.ts             - Device presets (iPhone, Android, custom)
    i18n.ts                     - EN/ZH language toggle

server/
  index.ts                      - Entry point
  routes.ts                     - All API endpoints (~2400 lines)
  manager-prompt.ts             - Manager agent system prompt
  editor-prompt.ts              - Editor agent system prompt
  communicator-prompt.ts        - Communicator agent prompt
  rn-web-compiler.ts            - Babel transform + esbuild vendor bundle
  flutter-compiler.ts           - flutter build web spawner
  swift-wasm-compiler.ts        - SwiftWasm compilation (partially implemented)
  kotlin-wasm-compiler.ts       - Kotlin/Wasm compilation (broken pipeline)
  templates/                    - Project scaffolds per framework
  skills/                       - AI skill files per framework
  stubs/                        - Browser shims for RN (codegenNativeComponent, etc.)
  preview-server.ts             - Live reload server (WebSocket + QR)
  vite.ts                       - Vite dev middleware

shared/
  schema.ts                     - Drizzle schema: users, projects, projectFiles
```

## External Dependencies
- **AI Providers**: Doubao (ByteDance/Volcengine) `doubao-seed-2-0-code-preview` (default) and `doubao-seed-2-0-lite` (Mentor); Kimi K2.5, MiniMax-M2.7, GLM-5 (selectable)
- **Code Editor**: `@monaco-editor/react`
- **State**: Zustand
- **UI Components**: Shadcn UI, Radix UI
- **Icons**: Lucide-react
- **Resizable Panels**: `react-resizable-panels`
- **Routing**: Wouter
- **API Client**: `openai` (used with Doubao's OpenAI-compatible endpoint)
- **Kotlin/Wasm**: Gradle 8.10+, Kotlin 2.1+, Compose Multiplatform plugin
- **SwiftUI/Wasm**: Swift 6.1 toolchain + SwiftWasm SDK, JavaScriptKit 0.21.0

## Commands

```bash
npm run dev        # Start full-stack dev server (client + server, default port 5000)
npm run build      # Build for production (Vite → dist/public, esbuild → dist/index.cjs)
npm start          # Run production build
npm run check      # TypeScript type-check only (no emit)
npm run db:push    # Push Drizzle schema changes to PostgreSQL
```

No automated test suite — verification is manual via browser.

## Key Invariants to Preserve

1. **`_nextSeq` monotonicity** — never reset to a value below the current max; old persisted messages get backfilled seq on `loadProject`
2. **Session survival** — build and manager sessions must not be killed client-side on navigation; `AgentStreamProvider` at App root ensures this
3. **Framework detection** — `server/framework-detector.ts` reads project files to determine framework; determines prompt selection, skill injection, and preview mode
4. **Checkpoint before build** — `handleExecutePlan` creates a "Before build" checkpoint before starting; `useBuildStream` creates "Build complete" after
5. **File sync on build reconnect** — file sync triggered only when user is viewing the same project (prevents cross-project file corruption)
