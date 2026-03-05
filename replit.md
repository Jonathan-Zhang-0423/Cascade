# CodeStart IDE

## Overview
A browser-based IDE inspired by Replit, featuring a built-in "Vibe Coding Agent" that helps complete beginners build web apps through natural language conversation. Supports multiple isolated projects, each with their own files, chat history, and preview.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI
- **Backend**: Express.js (API routes)
- **State Management**: Zustand with manual localStorage persistence (per-project)
- **Code Editor**: Monaco Editor (`@monaco-editor/react`)
- **AI Provider**: Doubao (ByteDance/Volcengine) via OpenAI-compatible SDK
- **AI Model**: `doubao-seed-2-0-code-preview-260215` (Doubao Seed 2.0 Code) for chat + code generation
- **Routing**: wouter

## Project Structure
```
client/src/
  stores/
    project-store.ts            # Zustand store for project list (persisted to localStorage)
    ide-store.ts                # Zustand store for per-project IDE state (files, tabs, chat, console, theme)
  components/
    ide/
      navbar.tsx                # Header bar (back button, logo, project name, theme, Run button)
      tools-dock.tsx            # Vertical icon dock (Files, AI Chat, Console)
      file-tree.tsx             # File explorer tool panel with CRUD + context menus
      code-editor.tsx           # Monaco editor with tab management
      chat-panel.tsx            # Vibe Agent chat (streaming AI, code blocks, Apply buttons)
      preview-panel.tsx         # Live HTML preview (Webview) with console interceptor
      console-panel.tsx         # Console output panel (log/warn/error/info)
      command-palette.tsx       # Command palette (Ctrl+Shift+P)
    theme-provider.tsx          # Light/dark mode provider
    ui/                         # Shadcn UI components (resizable panels, dialog, alert-dialog, etc.)
  pages/
    dashboard.tsx               # Project dashboard — lists all projects, create/rename/delete
    ide.tsx                     # Main IDE layout (resizable dock + tool panels + side-by-side panes)
  App.tsx                       # Root app with routing (/ = dashboard, /project/:id = IDE)
server/
  routes.ts                     # API endpoints (POST /api/chat with SSE streaming)
  doubao-client.ts              # Doubao API client (OpenAI SDK pointed at Volcengine)
  vibe-prompt.ts                # Vibe Agent system prompt + file context builder
  storage.ts                    # Data storage interface
shared/
  schema.ts                     # Data schemas
```

## Multi-Project Architecture
- **Dashboard** (`/`): Shows all projects as cards in a grid. Users can create, rename, and delete projects. Clicking a project card opens its IDE.
- **IDE** (`/project/:id`): Full IDE scoped to one project. Each project has isolated files, chat history, open tabs, active file, preview file, and theme.
- **Storage**: Project list persisted via Zustand persist middleware (`codestart-projects`). Each project's IDE state stored separately in localStorage (`codestart-project-{id}`).
- **Project switching**: IDE auto-saves state on unmount/navigation. Loading a new project reads its saved state from localStorage or initializes defaults.
- **Migration**: On first load, if old single-project state (`codestart-ide-state`) exists, it's migrated to a new project entry. Migration is idempotent (guarded by `codestart-migrated` flag).

## AI Integration
- **Provider**: Doubao (ByteDance) via `https://ark.cn-beijing.volces.com/api/v3`
- **Model**: `doubao-seed-2-0-code-preview-260215` (Doubao Seed 2.0 Code, handles both conversation and code generation)
- **API Route**: `POST /api/chat` — accepts messages + file context, returns SSE stream
- **System Prompt**: Encodes Vibe Agent behavioral rules (demand clarity, confirm before building, no jargon, iterative). Agent is scoped to one project at a time.
- **Code Apply Flow**: AI outputs code blocks with `file="..."` annotations → chat renders "Apply" buttons → clicking writes code to IDE filesystem → preview updates automatically. Nested paths auto-create intermediate directories.
- **Code Annotations**: System prompt requires beginner-friendly, no-jargon inline comments on every line of generated code, matching the user's language
- **Emojis**: Agent includes 1-3 emojis in ~90% of responses for warmth
- **API Key**: Stored in `DOUBAO_API_KEY` environment secret

## UI Design (Replit-inspired)
- **Layout**: Tools dock (far left) → Tool panel (files/chat) → Editor pane + Preview pane (side-by-side) → Console (bottom)
- **Resizable panes**: All panels are freely resizable via react-resizable-panels
- **Workspace aesthetic**: Dark sidebar chrome, rounded pane containers with gaps between them
- **Tools dock**: Thin vertical icon strip for switching between Files, AI Chat, Console
- **Panes**: Editor and Preview shown simultaneously, not behind tabs

## Preview System
- **Multi-file support**: Preview panel parses HTML for `<script src="...">` and `<link href="...">` references, resolves them from the IDE virtual filesystem, and inlines their contents
- **Dynamic preview file**: Users can preview any HTML file (not just index.html) via the Run button or file tree context menu
- **Console interceptor**: Injected into HTML to capture `console.log/warn/error/info` calls via `postMessage`
- **Fallback**: External URLs (http/https) are left as-is; only local project files are inlined

## Features
- Multi-project dashboard with create/rename/delete
- Per-project isolated files, chat history, and preview
- Monaco code editor with theme switching (Dark+, Light+, High Contrast)
- File tree with create, rename, delete, duplicate (via context menu)
- Live HTML preview with multi-file resolution and console output capture
- Console panel showing log/warn/error from preview iframe
- Tools dock for switching between Files panel and AI Chat panel
- AI Chat with Doubao streaming responses and code block Apply buttons
- Command palette (Ctrl+Shift+P) for quick actions
- Keyboard shortcuts: Ctrl+S (save), Ctrl+B (sidebar), Ctrl+J (console)
- Resizable panels for all IDE sections
- Stop button to abort AI responses mid-stream
- Run button previews active HTML file; right-click "Preview" option on HTML files in file tree

## Running
```
npm run dev
```
Starts Express backend + Vite dev server on port 5000.

## Key Dependencies
- `@monaco-editor/react` - VS Code editor component
- `openai` - OpenAI-compatible SDK (used for Doubao API)
- `react-resizable-panels` - Resizable panel layout
- `zustand` - Lightweight state management
- `lucide-react` - Icons
