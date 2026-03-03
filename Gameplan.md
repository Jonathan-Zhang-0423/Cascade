# VibeCode IDE - Development Gameplan

## Project Overview
A **browser-based IDE** inspired by Lovable and Replit, targeting complete beginners with no programming experience. The core differentiator is a built-in **"Vibe Coding Agent"** that turns plain-English ideas into working code through friendly conversation.

---

## Core Product Requirements

### The IDE (Frontend)
- Modern, clean interface (Lovable/Replit inspired)
- **Monaco Editor** (VS Code engine) for code editing
- Switchable VS Code color themes (Dark+, Light+, Monokai, High Contrast)
- File tree sidebar for managing files/folders
- Live preview panel for viewing output
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
- [x] File tree with folder/file management
- [x] Theme switching (Dark+, Light+, High Contrast)
- [x] Light/dark mode toggle for UI
- [x] Preview panel with live HTML rendering
- [x] Chat panel placeholder UI with welcome message

### Phase 2: Vibe Coding Agent (Prompt & AI Integration) - NOT STARTED
- [ ] Set up Vercel AI SDK in API routes
- [ ] Build chat panel UI: message history, input, send button
- [ ] Hardcode Vibe Agent system prompt with rules
- [ ] Connect chat to AI model (streaming responses)
- [ ] Agent follows all behavioral rules (clarity, confirmation, no jargon, iterative)

### Phase 3: Execution & Preview - NOT STARTED
- [ ] Integrate WebContainer API
- [ ] Write agent-generated code to WebContainer filesystem
- [ ] Live preview tab showing WebContainer output
- [ ] Hot-reload preview on code changes

### Phase 4: Polish & Themes - PARTIALLY STARTED
- [x] VS Code theme switcher (3 themes)
- [ ] Additional themes (Monokai, Solarized, etc.)
- [ ] Full file tree CRUD (create, rename, delete)
- [ ] Responsive/mobile layout
- [ ] Keyboard shortcuts
- [ ] Settings panel
- [ ] UI animations and micro-interactions

---

## Architecture Overview

```
client/src/
  stores/ide-store.ts       - Zustand state (files, tabs, chat, theme)
  components/ide/
    navbar.tsx               - Top nav (logo, theme, toggles)
    file-tree.tsx            - Explorer sidebar
    code-editor.tsx          - Monaco + tab management
    chat-panel.tsx           - Vibe Agent chat UI
    preview-panel.tsx        - Live HTML preview
  components/theme-provider.tsx - Light/dark mode provider
  pages/ide.tsx              - Main IDE layout (resizable panels)
  App.tsx                    - Root with routing + providers
```

---

## Key Decisions Made
1. Using `react-resizable-panels` for the 3-panel IDE layout
2. Dark mode as default (matches IDE conventions)
3. Zustand for state management (lightweight, no boilerplate)
4. srcDoc-based iframe preview (simple, no server needed initially)
5. Monaco with JetBrains Mono font and bracket colorization
