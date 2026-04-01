# CodeStart — Mobile-First AI Development Platform

## Overview
CodeStart is a mobile-first development platform that empowers complete beginners to build production-ready iOS and Android apps using AI coding agents. The platform supports multiple mobile frameworks (React Native/Expo, Flutter, SwiftUI, Kotlin/Jetpack Compose) and multiple languages (TypeScript, Dart, Swift, Kotlin). Users develop apps through natural language conversations with a built-in "Vibe Coding Agent" and preview them in a device simulator. The platform supports multiple isolated projects, each with its own files, chat history, and device preview.

## Mobile Pivot Status
The platform is pivoting from a browser-based web IDE to a mobile-first development platform. See `Progress.txt` for the comprehensive roadmap (phases MP-1 through MP-13). Existing web project support (HTML/CSS/JS) is preserved for backwards compatibility.

## User Preferences
The user wants an AI assistant that:
- Demands clarity from the user.
- Confirms understanding before building.
- Avoids jargon in explanations and code comments.
- Follows an iterative development approach.
- Includes 1-3 emojis in approximately 90% of responses to maintain a warm and friendly tone.
- Provides beginner-friendly, no-jargon inline comments on every line of generated code, matching the user's language.

## System Architecture
The CodeStart IDE features a modern web architecture:

**Frontend**:
- Built with React, TypeScript, Tailwind CSS, and Shadcn UI for a responsive and visually appealing user interface.
- State management is handled by Zustand, with project-specific data persisted in `localStorage`.
- The code editor is powered by `@monaco-editor/react`, providing a rich coding experience.
- UI/UX decisions emphasize a dark sidebar chrome, rounded pane containers, and gaps between elements for a clean workspace aesthetic.
- The layout includes a tools dock, resizable tool panels, an editor pane, a preview pane, and a console panel.
- **Unified Theme System** (`client/src/lib/themes.ts`): 14 VS Code-style themes (Dark+, Monokai, Dracula, One Dark, GitHub Dark/Light, Solarized Dark/Light, Abyss, Tomorrow Night Blue, High Contrast variants, Quiet Light, Light+). Single `ThemeId` type drives both Monaco editor theme and app dark/light mode. **Theme is globally managed by `ThemeProvider`** (not per-project) — persists in localStorage key `codestart-theme-id`. `ThemeProvider` exposes `{ themeId, mode, setThemeId }`. Theme selector appears on both dashboard and IDE navbar. Custom Monaco themes registered via `beforeMount` hook to guarantee availability before first render.

**Backend**:
- An Express.js server handles API routes for AI interactions and manages agent communication.

**Core Features & Design Patterns**:
- **Multi-Project System**: Users can manage multiple isolated projects from a dashboard, each with its own files, chat history, and IDE state.
- **AI-Driven Development**: The Vibe Coding Agent guides users through web app creation via natural language. It uses a streaming API for real-time code generation and application.
- **Incremental Code Auto-Apply**: AI-generated code blocks with `file="..."` annotations are automatically applied to the project files as they stream, and the preview updates instantly.
- **Structured AI Output**: The AI agent adheres to a 3-part response format: Thinking, Code, and Changes Summary, with the summary visually styled for clarity.
- **Checkpoint/Rollback System**: Automatic checkpoints are created after AI applies code changes, allowing users to restore previous project states. Checkpoints use reverse diffs for efficient storage.
- **4-Agent System (Plan Mode)** — Conversational planning → Build → Review → Fix cycle:
    - **Manager Agent** (`server/manager-prompt.ts`): **Conversational planning assistant** (Replit Plan Mode style). Supports TWO response modes: (a) `{ type: "message", content }` for brainstorming, Q&A, and guidance, (b) `{ type: "plan", summary, steps, needs_input }` for structured task plans when the user is ready to build. Also generates targeted fix plans via `buildManagerFixPlanMessage`.
    - **Editor Agent** (`server/editor-prompt.ts`): Professional code executor for Plan Mode — stripped-down, task-focused prompt. In Build Mode, the full Vibe Agent prompt (`server/vibe-prompt.ts`) is used instead.
    - **Verifier Agent** (`server/verifier-prompt.ts`): Performs holistic project-level review after all build steps complete (not per-step). Uses `buildHolisticVerifierMessage` with full before/after file snapshots and plan context. Returns `HolisticReviewResult` with `bugs`, `missing_features`, `regressions`, `overall_status`.
    - **Communicator Agent** (`server/communicator-prompt.ts`): The sole user-facing narrator. Streams real-time progress updates via `/api/communicator-chat` (SSE). Events: `build_starting`, `step_starting`, `step_completed`, `build_complete`, `reviewing`, `review_passed`, `bugs_found`, `fixing`, `needs_input`, `all_complete`. **RULE**: Only Communicator narration, Manager conversational messages, and TaskPlanCard are visible to users — all raw Editor and Verifier agent output is hidden. Messages use `source` field ("communicator" | "manager_raw") for filtering.
    - **Execution Flow**: User plans in Plan Mode → clicks "Start building" → auto-switches to Build Mode → Phase 1 BUILD (Editor executes steps) → Phase 2 REVIEW (Verifier holistic review) → Phase 3 FIX (if bugs, Manager fix plan, Editor fixes, Verifier re-reviews, max 3 cycles).
    - **State**: `reviewPhase` (`idle`|`building`|`reviewing`|`review_passed`|`review_failed`|`fixing`), `holisticReview`, `fixCycle` in `ide-store.ts`.
    - **User Confirmation Flow**: When the Verifier flags subjective items needing user input, execution pauses and the Communicator presents the items. Users respond via the confirmation area or main chat input.
- **Performance Optimizations** (Task #4):
    - **Non-blocking Communicator**: Informational narration events (step_starting, step_completed, etc.) fire-and-forget — only `needs_input` blocks. Saves 40-95s per build.
    - **max_tokens caps**: All endpoints raised to 16,384 (model maximum) — Editor, Communicator, Manager, Verifier, Mentor, and all helper endpoints use full capacity to prevent truncation.
    - **Filtered Manager history**: Communicator narration excluded from Manager API conversation context.
    - **Throttled streaming UI**: `updateLastAssistantMessage` batched to ~16ms intervals; `extractCodeBlocks` gated by code-fence marker detection in chunks, with final post-stream catch-all apply.
    - **Relevant-files-only for Editor**: In plan execution, only files mentioned in step descriptions are sent (with index.html fallback). Falls back to all files when no paths detected.
- **My Coding Notebook / Learner Space** (Task #7):
    - **Mentor Agent** (`server/mentor-prompt.ts`): Warm, educational personality. Analyzes project files and returns structured JSON with project_summary, file_breakdowns (with key_concepts and connections), mind_map, and learning_tips.
    - **Doubao Lite Model** (`server/doubao-client.ts`): `DOUBAO_LITE_MODEL` env var, falls back to main model if not set.
    - **API Endpoint**: `POST /api/mentor-analyze` — receives project files, returns structured notebook JSON via Doubao Lite.
    - **Space Toggle**: Navbar has "Workspace" / "Learner Space" pill toggle (`activeSpace` in store).
    - **NotebookPanel** (`client/src/components/ide/notebook-panel.tsx`): Renders project summary, expandable file breakdowns with key concepts, interactive SVG mind map, and learning tips.
    - **MindMap** (`client/src/components/ide/mind-map.tsx`): Custom SVG mind map with three-level interactive exploration. Section heading: "思维导图". Central project node → file branches (hover for description, click to expand/collapse children) → feature sub-nodes (hover for explanation, click to pin/unpin). Children hidden by default. Layout recalculates dynamically on expand/collapse. `NotebookMindMapBranch` has `description` field. Color-coded by file type.
    - **State**: `activeSpace`, `notebookContent`, `isNotebookLoading`, `isNotebookOptimizing`, `notebookError` in `ide-store.ts`. Persisted to localStorage.
    - **Auto-generation**: When user switches to Learner Space and no notebook exists, generation triggers automatically.
    - **Two-Tier Incremental Updates**:
      - **Tier 1 — Auto-patch** (`/api/mentor-patch`): When notebook is stale, automatically sends only changed files + notebook outline + affected sections → Mentor returns a JSON patch → client merges patch into existing notebook. Uses `MENTOR_PATCH_PROMPT`. Lightweight, fires automatically on entering stale notebook.
      - **Tier 2 — Optimize** (`/api/mentor-optimize`): "优化笔记" button sends full existing notebook + all current files → Mentor does targeted refinement with full cross-file context. Uses `MENTOR_OPTIMIZE_PROMPT`. Premium, user-initiated.
      - **Diffing**: `NotebookContent.sourceFiles` stores a snapshot of files at generation time. `computeChangedFiles()` diffs old snapshot vs current files to find added/modified/deleted files.
      - **Patch merge**: `applyPatchToNotebook()` merges `updated_breakdowns`, `new_breakdowns`, `removed_files`, and `updated_mind_map` branches into the existing notebook.
- **LLM Output Monitor** (Task #108):
    - **LLM Monitor Store** (`client/src/stores/llm-monitor-store.ts`): Lightweight pub/sub event bus with batched ingestion (80ms flush interval). Stores up to 2000 events with auto-trimming. Each event has id, timestamp, source, type, and content.
    - **Monitor Component** (`client/src/components/ide/llm-monitor.tsx`): Non-modal floating panel at bottom-right. Shows timestamped, color-coded, source-labeled event rows. Auto-scrolls unless user scrolls up. Clear button and entry count in header.
    - **Instrumented SSE Streams**: All four SSE stream readers in `chat-panel.tsx` (manager-chat, build-session, vibe-chat, communicator-summary) publish events to the monitor store with correct source classification.
    - **Toggle Button**: Radio icon in tools dock bottom section with event count badge when closed.
- **Live HTML Preview**: The preview panel inlines local project files referenced in HTML, capturing console output via `postMessage`.
- **QR Code Phone Preview** (Task #113):
    - **Preview Server** (`server/preview-server.ts`): Integrated into the main Express app on port 5000. Serves project files at `/preview-serve/{token}/` with token-scoped sessions. Inlines CSS/JS referenced in HTML. WebSocket live reload via `/preview-ws?token={token}` on the same HTTP server.
    - **Session Security**: Each preview session gets a unique 32-char hex token. Files, WebSocket connections, and API endpoints are scoped per-token. Sessions auto-expire after 4 hours. Stop endpoint cleans up on component unmount.
    - **QR Code UI**: QR button in preview panel toolbar opens a popover with QRCodeSVG from `qrcode.react`. Shows preview URL, copy button, open-in-new-tab button, and live reload status.
    - **Auto-Sync**: Files are automatically pushed to the preview server when content changes (1s debounce). Full content hashing ensures all changes trigger updates.
- **Command Palette**: Provides quick access to actions via `Ctrl+Shift+P`.

## External Dependencies
- **AI Providers**: Two selectable providers via chat toolbar toggle (visible when Kimi key is configured):
  - **Doubao** (ByteDance/Volcengine): `server/doubao-client.ts`, base URL `https://ark.cn-beijing.volces.com/api/v3`, env key `DOUBAO_API_KEY`.
  - **Kimi K2.5** (Moonshot AI): `server/kimi-client.ts`, base URL `https://api.moonshot.ai/v1`, env key `KIMI_API_KEY`, OpenAI-compatible.
  - Toggle stored as `selectedProvider: "doubao" | "kimi"` in `ide-store.ts`. Passed to `/api/manager-chat` and `/api/build-session` as `provider` field. Backend endpoint `GET /api/providers` returns `{ kimi: boolean }`.
- **AI Models**:
  - `doubao-seed-2-0-code-preview-260215` (Doubao Seed 2.0 Code) — Editor, Manager, Verifier, Communicator agents (default).
  - `doubao-seed-2-0-lite-260215` (Doubao Seed 2.0 Lite) — Mentor Agent. Override via `DOUBAO_LITE_MODEL` env var.
  - `kimi-k2.5` (Kimi K2.5) — All agents when Kimi provider is selected.
- **Code Editor**: `@monaco-editor/react`.
- **State Management**: Zustand.
- **UI Components**: Shadcn UI.
- **Icons**: Lucide-react.
- **Resizable Panels**: `react-resizable-panels`.
- **Routing**: wouter.
- **API Client**: `openai` (used with Doubao's API endpoint).