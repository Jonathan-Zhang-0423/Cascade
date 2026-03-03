# CodeStart IDE - Development Gameplan

## Project Overview
A **browser-based IDE** inspired by Lovable and Replit, targeting complete beginners with no programming experience. The core differentiator is a built-in **"Vibe Coding Agent"** that turns plain-English ideas into working code through friendly conversation.

---

## Core Product Requirements

### The IDE (Frontend)
- Modern, clean interface (Lovable/Replit inspired)
- **Monaco Editor** (VS Code engine) for code editing
- Switchable VS Code color themes (Dark+, Light+, Monokai, High Contrast)
- File tree sidebar for managing files/folders (with CRUD operations)
- Live preview panel for viewing output
- Console/Output panel for viewing logs, errors, warnings
- Status bar showing file info, git branch, error counts
- Command palette for quick actions (Ctrl+Shift+P)
- Keyboard shortcuts for common operations
- **WebContainer API** for browser-side code execution (no backend servers)

### The Vibe Coding Agent (AI Brain)
Lives inside the IDE as a chat panel. Key behaviors:
1. **Demand Clarity** - Asks questions if user requests are vague
2. **Confirm Before Building** - Summarizes plan and asks for confirmation
3. **No Jargon** - Uses analogies for explanations
4. **Iterative** - Invites tweaking after generating code

---

## Tech Stack (Mandatory)
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (React) + TypeScript |
| Styling | Tailwind CSS + Shadcn UI |
| State | Zustand |
| Editor | @monaco-editor/react |
| Runtime | @webcontainer/api |
| Auth/Data | Supabase (future) |
| AI | Vercel AI SDK (GPT-4o / Claude 3.5) |
| Deploy | Vercel-ready |

> **Note:** Current implementation uses Express + Vite (Replit template). Migration to Next.js can happen in a later phase if needed.

---

## Development Phases

### Phase 1: Project Init & Core IDE Shell - COMPLETE
- [x] Project setup with TypeScript and Tailwind CSS
- [x] Basic layout: navbar, resizable sidebar, Monaco editor, chat panel
- [x] Monaco Editor loading default "Hello World" HTML
- [x] File tree with folder/file management and CRUD operations
- [x] Theme switching (Dark+, Light+, High Contrast)
- [x] Light/dark mode toggle for UI
- [x] Preview panel with live HTML rendering
- [x] Chat panel placeholder UI with welcome message
- [x] Console panel with log capture from preview iframe
- [x] Status bar with file info, git branch, error/warning counts
- [x] Command palette (Ctrl+Shift+P)
- [x] Keyboard shortcuts (Ctrl+S, Ctrl+B, Ctrl+J)
- [x] Breadcrumb navigation
- [x] File CRUD: create, rename, delete, duplicate via context menu

### Phase 2: Vibe Coding Agent (Prompt & AI Integration) - NOT STARTED
- [ ] Set up Vercel AI SDK in API routes
- [ ] Build chat panel UI: message history, input, send button
- [ ] Hardcode Vibe Agent system prompt with rules
- [ ] Connect chat to AI model (streaming responses)
- [ ] Agent follows all behavioral rules (clarity, confirmation, no jargon, iterative)

### Phase 3: Execution & Preview - PARTIALLY STARTED
- [x] Preview panel with iframe + console capture
- [ ] Integrate WebContainer API
- [ ] Write agent-generated code to WebContainer filesystem
- [ ] Live preview tab showing WebContainer output
- [ ] Hot-reload preview on code changes

### Phase 4: Polish & Themes - PARTIALLY STARTED
- [x] VS Code theme switcher (3 themes)
- [x] Command palette
- [x] File CRUD operations
- [x] Keyboard shortcuts
- [x] Status bar
- [ ] Additional themes (Monokai, Solarized, etc.)
- [ ] Responsive/mobile layout
- [ ] Settings panel
- [ ] Search across files
- [ ] UI animations and micro-interactions

---

## Architecture Overview

```
client/src/
  stores/ide-store.ts            - Zustand state (files, tabs, chat, console, theme, CRUD)
  components/ide/
    navbar.tsx                    - Top nav (logo, theme, toggles for sidebar/console/chat)
    file-tree.tsx                 - Explorer sidebar with CRUD + context menus
    code-editor.tsx               - Monaco + tab management
    chat-panel.tsx                - Vibe Agent chat UI
    preview-panel.tsx             - Live HTML preview with console interceptor
    console-panel.tsx             - Console output (log/warn/error/info)
    status-bar.tsx                - Bottom status bar (branch, lang, encoding, errors)
    command-palette.tsx           - Command palette (Ctrl+Shift+P)
  components/theme-provider.tsx   - Light/dark mode provider
  pages/ide.tsx                   - Main IDE layout (resizable panels + keyboard shortcuts)
  App.tsx                         - Root with routing + providers
```

---

## Key Decisions Made
1. Using `react-resizable-panels` for the multi-panel IDE layout
2. Dark mode as default (matches IDE conventions)
3. Zustand for state management (lightweight, no boilerplate)
4. srcDoc-based iframe preview with postMessage console bridge
5. Monaco with JetBrains Mono font and bracket colorization
6. Console captures logs from iframe via injected script interceptor
7. Context menus for file operations using shadcn ContextMenu
