# CodeStart IDE

## Overview
A browser-based IDE inspired by Replit, featuring a built-in "Vibe Coding Agent" that helps complete beginners build apps through natural language conversation.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI
- **Backend**: Express.js (API routes)
- **State Management**: Zustand
- **Code Editor**: Monaco Editor (`@monaco-editor/react`)
- **AI Provider**: Doubao (ByteDance/Volcengine) via OpenAI-compatible SDK
- **AI Model**: `doubao-seed-2-0-code-preview-260215` (Doubao Seed 2.0 Code) for chat + code generation
- **Routing**: wouter

## Project Structure
```
client/src/
  stores/
    ide-store.ts              # Zustand store (files, tabs, chat, console, theme, activeTool, AI state, CRUD)
  components/
    ide/
      navbar.tsx              # Slim header bar (logo, project name, theme selector, Run button)
      tools-dock.tsx          # Vertical icon dock (Files, AI Chat, Console)
      file-tree.tsx           # File explorer tool panel with CRUD + context menus
      code-editor.tsx         # Monaco editor with tab management
      chat-panel.tsx          # Vibe Agent chat (streaming AI, code blocks, Apply buttons)
      preview-panel.tsx       # Live HTML preview (Webview) with console interceptor
      console-panel.tsx       # Console output panel (log/warn/error/info)
      command-palette.tsx     # Command palette (Ctrl+Shift+P)
    theme-provider.tsx        # Light/dark mode provider
    ui/                       # Shadcn UI components (including resizable panels)
  pages/
    ide.tsx                   # Main IDE layout (resizable dock + tool panels + side-by-side panes)
  App.tsx                     # Root app with routing
server/
  routes.ts                   # API endpoints (POST /api/chat with SSE streaming)
  doubao-client.ts            # Doubao API client (OpenAI SDK pointed at Volcengine)
  vibe-prompt.ts              # Vibe Agent system prompt + file context builder
  storage.ts                  # Data storage interface
shared/
  schema.ts                   # Data schemas
```

## AI Integration (Phase 2)
- **Provider**: Doubao (ByteDance) via `https://ark.cn-beijing.volces.com/api/v3`
- **Model**: `doubao-seed-2-0-code-preview-260215` (Doubao Seed 2.0 Code, handles both conversation and code generation)
- **API Route**: `POST /api/chat` — accepts messages + file context, returns SSE stream
- **System Prompt**: Encodes Vibe Agent behavioral rules (demand clarity, confirm before building, no jargon, iterative)
- **Code Apply Flow**: AI outputs code blocks with `file="..."` annotations → chat renders "Apply" buttons → clicking writes code to IDE filesystem → preview updates automatically
- **API Key**: Stored in `DOUBAO_API_KEY` environment secret

## UI Design (Replit-inspired)
- **Layout**: Tools dock (far left) → Tool panel (files/chat) → Editor pane + Preview pane (side-by-side) → Console (bottom)
- **Resizable panes**: All panels are freely resizable via react-resizable-panels
- **Workspace aesthetic**: Dark sidebar chrome, rounded pane containers with gaps between them
- **Tools dock**: Thin vertical icon strip for switching between Files, AI Chat, Console
- **Panes**: Editor and Preview shown simultaneously, not behind tabs
- **No status bar**: Removed in favor of tools dock approach

## Preview System (Phase 3)
- **Multi-file support**: Preview panel parses HTML for `<script src="...">` and `<link href="...">` references, resolves them from the IDE virtual filesystem, and inlines their contents
- **Console interceptor**: Injected into HTML to capture `console.log/warn/error/info` calls via `postMessage`
- **Fallback**: External URLs (http/https) are left as-is; only local project files are inlined
- **Default template**: `index.html` references `style.css` and `app.js` via standard HTML tags, demonstrating multi-file support

## Features
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
