# CodeStart IDE

## Overview
A browser-based IDE inspired by Lovable and Replit, featuring a built-in "Vibe Coding Agent" that helps complete beginners build apps through natural language conversation.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI
- **Backend**: Express.js (API routes)
- **State Management**: Zustand
- **Code Editor**: Monaco Editor (`@monaco-editor/react`)
- **Resizable Panels**: `react-resizable-panels`
- **Routing**: wouter

## Project Structure
```
client/src/
  stores/
    ide-store.ts              # Zustand store (files, tabs, chat, console, theme, CRUD)
  components/
    ide/
      navbar.tsx              # Top nav (logo, theme, sidebar/console/chat toggles)
      file-tree.tsx           # Sidebar file explorer with CRUD + context menus
      code-editor.tsx         # Monaco editor with tab management
      chat-panel.tsx          # Vibe Agent chat interface
      preview-panel.tsx       # Live HTML preview with console interceptor
      console-panel.tsx       # Console output panel (log/warn/error/info)
      status-bar.tsx          # Bottom status bar (branch, lang, encoding, errors)
      command-palette.tsx     # Command palette (Ctrl+Shift+P)
    theme-provider.tsx        # Light/dark mode provider
    ui/                       # Shadcn UI components
  pages/
    ide.tsx                   # Main IDE layout with resizable panels + shortcuts
  App.tsx                     # Root app with routing
server/
  routes.ts                   # API endpoints
  storage.ts                  # Data storage interface
shared/
  schema.ts                   # Data schemas
```

## Features
- Monaco code editor with theme switching (Dark+, Light+, High Contrast)
- File tree with create, rename, delete, duplicate (via context menu)
- Live HTML preview with console output capture
- Console panel showing log/warn/error from preview iframe
- Status bar with git branch, error counts, file language info
- Command palette (Ctrl+Shift+P) for quick actions
- Keyboard shortcuts: Ctrl+S (save), Ctrl+B (sidebar), Ctrl+J (console)
- Breadcrumb navigation above editor
- Chat panel with Vibe Agent placeholder

## Running
```
npm run dev
```
Starts Express backend + Vite dev server on port 5000.

## Key Dependencies
- `@monaco-editor/react` - VS Code editor component
- `zustand` - Lightweight state management
- `react-resizable-panels` - Resizable panel layout
- `lucide-react` - Icons
