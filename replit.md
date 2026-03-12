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
- **4-Agent System (Manager Mode)**:
    - **Manager Agent** (`server/manager-prompt.ts`): Professional planner that breaks down tasks into actionable steps (JSON output only, no friendly personality).
    - **Editor Agent** (`server/editor-prompt.ts`): Professional code executor for Manager Mode — stripped-down, task-focused prompt. In Build Mode, the full Vibe Agent prompt (`server/vibe-prompt.ts`) is used instead.
    - **Verifier Agent** (`server/verifier-prompt.ts`): Professional QA evaluator that validates code runnability, requirement matching, and project integrity (JSON output only, no friendly personality).
    - **Communicator Agent** (`server/communicator-prompt.ts`): The sole user-facing narrator. Inherits the warm, friendly, emoji-rich personality from the Vibe Agent. Streams real-time progress updates to the user via `/api/communicator-chat` (SSE). Called at every key stage: `plan_created`, `step_starting`, `step_completed`, `step_verified`, `step_failed`, `needs_input`, `retry`, `all_complete`.
    - **Prompt Architecture**: The 3 backend agents (Manager, Editor, Verifier) are purely professional/technical — they communicate with each other through structured JSON only. All friendly, beginner-facing communication flows through the Communicator Agent.
    - **User Confirmation Flow**: When the Verifier flags subjective items needing user input, execution pauses and the Communicator presents the items in friendly language. Users respond via the confirmation area or main chat input; their response is passed to the Editor as context when re-executing the step. State: `pendingConfirmation`, `userConfirmationInput` in `ide-store.ts`.
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