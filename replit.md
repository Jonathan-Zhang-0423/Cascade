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
    ide-store.ts          # Zustand store for IDE state (files, tabs, chat, theme)
  components/
    ide/
      navbar.tsx          # Top navigation bar (logo, theme picker, run, toggles)
      file-tree.tsx       # Sidebar file explorer with icons
      code-editor.tsx     # Monaco editor with tab management
      chat-panel.tsx      # Vibe Agent chat interface
      preview-panel.tsx   # Live HTML preview via iframe
    ui/                   # Shadcn UI components
  pages/
    ide.tsx               # Main IDE layout page with resizable panels
  App.tsx                 # Root app with routing
server/
  routes.ts               # API endpoints
  storage.ts              # Data storage interface
shared/
  schema.ts               # Data schemas
```

## Development Phases
1. **Phase 1** (COMPLETE): Core IDE shell - layout, Monaco editor, file tree, chat UI
2. **Phase 2** (NOT STARTED): AI agent integration via Vercel AI SDK
3. **Phase 3** (NOT STARTED): WebContainer API for browser-side code execution
4. **Phase 4** (PARTIAL): Polish, themes, responsive design

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
