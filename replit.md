# CodeStart IDE

## Overview
CodeStart IDE is a browser-based integrated development environment inspired by Replit. Its primary purpose is to empower complete beginners to build web applications through natural language conversations with a built-in "Vibe Coding Agent." The platform supports multiple isolated projects, each with its own files, chat history, and live preview. It aims to simplify web development for new users by providing an intuitive, conversational, and guided coding experience.

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
- Light/dark mode and high contrast themes are supported.

**Backend**:
- An Express.js server handles API routes for AI interactions and manages agent communication.

**Core Features & Design Patterns**:
- **Multi-Project System**: Users can manage multiple isolated projects from a dashboard, each with its own files, chat history, and IDE state.
- **AI-Driven Development**: The Vibe Coding Agent guides users through web app creation via natural language. It uses a streaming API for real-time code generation and application.
- **Incremental Code Auto-Apply**: AI-generated code blocks with `file="..."` annotations are automatically applied to the project files as they stream, and the preview updates instantly.
- **Structured AI Output**: The AI agent adheres to a 3-part response format: Thinking, Code, and Changes Summary, with the summary visually styled for clarity.
- **Checkpoint/Rollback System**: Automatic checkpoints are created after AI applies code changes, allowing users to restore previous project states. Checkpoints use reverse diffs for efficient storage.
- **4-Agent System (Manager Mode)** — Build → Review → Fix cycle:
    - **Manager Agent** (`server/manager-prompt.ts`): Professional planner that breaks down tasks into actionable steps (JSON output only). Also generates targeted fix plans via `buildManagerFixPlanMessage` when the Verifier finds issues.
    - **Editor Agent** (`server/editor-prompt.ts`): Professional code executor for Manager Mode — stripped-down, task-focused prompt. In Build Mode, the full Vibe Agent prompt (`server/vibe-prompt.ts`) is used instead.
    - **Verifier Agent** (`server/verifier-prompt.ts`): Performs holistic project-level review after all build steps complete (not per-step). Uses `buildHolisticVerifierMessage` with full before/after file snapshots and plan context. Returns `HolisticReviewResult` with `bugs`, `missing_features`, `regressions`, `overall_status`.
    - **Communicator Agent** (`server/communicator-prompt.ts`): The sole user-facing narrator. Streams real-time progress updates via `/api/communicator-chat` (SSE). Events: `build_starting`, `step_starting`, `step_completed`, `build_complete`, `reviewing`, `review_passed`, `bugs_found`, `fixing`, `needs_input`, `all_complete`.
    - **Execution Flow**: Phase 1 BUILD — Editor executes all steps sequentially (no per-step verification). Phase 2 REVIEW — Verifier does holistic review via `/api/verifier-holistic`. Phase 3 FIX — If bugs found, Manager creates targeted fix plan via `/api/manager-fix-plan`, Editor fixes, Verifier re-reviews. Max 3 fix cycles.
    - **State**: `reviewPhase` (`idle`|`building`|`reviewing`|`review_passed`|`review_failed`|`fixing`), `holisticReview`, `fixCycle` in `ide-store.ts`.
    - **User Confirmation Flow**: When the Verifier flags subjective items needing user input, execution pauses and the Communicator presents the items. Users respond via the confirmation area or main chat input.
- **Live HTML Preview**: The preview panel inlines local project files referenced in HTML, capturing console output via `postMessage`.
- **Command Palette**: Provides quick access to actions via `Ctrl+Shift+P`.

## External Dependencies
- **AI Provider**: Doubao (ByteDance/Volcengine) via an OpenAI-compatible SDK.
- **AI Model**: `doubao-seed-2-0-code-preview-260215` (Doubao Seed 2.0 Code).
- **Code Editor**: `@monaco-editor/react`.
- **State Management**: Zustand.
- **UI Components**: Shadcn UI.
- **Icons**: Lucide-react.
- **Resizable Panels**: `react-resizable-panels`.
- **Routing**: wouter.
- **API Client**: `openai` (used with Doubao's API endpoint).