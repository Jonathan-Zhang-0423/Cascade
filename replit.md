# CodeStart IDE

## Overview
A browser-based IDE inspired by Replit, featuring a built-in "Vibe Coding Agent" that helps complete beginners build apps through natural language conversation.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI
- **Backend**: Express.js (API routes)
- **State Management**: Zustand
- **Code Editor**: Monaco Editor (`@monaco-editor/react`)
- **Routing**: wouter

## Project Structure
```
client/src/
  stores/
    ide-store.ts              # Zustand store (files, tabs, chat, console, theme, activeTool, CRUD)
  components/
    ide/
      navbar.tsx              # Slim header bar (logo, project name, theme selector, Run button)
      tools-dock.tsx          # Vertical icon dock (Files, AI Chat, Console, Theme toggle)
      file-tree.tsx           # File explorer tool panel with CRUD + context menus
      code-editor.tsx         # Monaco editor with tab management
      chat-panel.tsx          # Vibe Agent chat tool panel
      preview-panel.tsx       # Live HTML preview (Webview) with console interceptor
      console-panel.tsx       # Console output panel (log/warn/error/info)
      command-palette.tsx     # Command palette (Ctrl+Shift+P)
    theme-provider.tsx        # Light/dark mode provider
    ui/                       # Shadcn UI components
  pages/
    ide.tsx                   # Main IDE layout (tools dock + tool panels + side-by-side panes)
  App.tsx                     # Root app with routing
server/
  routes.ts                   # API endpoints
  storage.ts                  # Data storage interface
shared/
  schema.ts                   # Data schemas
```

## UI Design (Replit-inspired)
- **Layout**: Tools dock (far left) → Tool panel (files/chat) → Editor pane + Preview pane (side-by-side) → Console (bottom)
- **Workspace aesthetic**: Dark sidebar chrome, rounded pane containers with gaps between them
- **Tools dock**: Thin vertical icon strip for switching between Files, AI Chat, Console
- **Panes**: Editor and Preview shown simultaneously, not behind tabs
- **No status bar**: Removed in favor of tools dock approach

## Features
- Monaco code editor with theme switching (Dark+, Light+, High Contrast)
- File tree with create, rename, delete, duplicate (via context menu)
- Live HTML preview with console output capture (side-by-side with editor)
- Console panel showing log/warn/error from preview iframe
- Tools dock for switching between Files panel and AI Chat panel
- Command palette (Ctrl+Shift+P) for quick actions
- Keyboard shortcuts: Ctrl+S (save), Ctrl+B (sidebar), Ctrl+J (console)
- Chat panel with Vibe Agent placeholder

## Running
```
npm run dev
```
Starts Express backend + Vite dev server on port 5000.

## Key Dependencies
- `@monaco-editor/react` - VS Code editor component
- `zustand` - Lightweight state management
- `lucide-react` - Icons
