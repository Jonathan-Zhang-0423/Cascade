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
  routes.ts                     # API endpoints (POST /api/chat, /api/manager-chat, /api/verifier-chat)
  doubao-client.ts              # Doubao API client (OpenAI SDK pointed at Volcengine)
  vibe-prompt.ts                # Vibe/Editor Agent system prompt + file context builder
  manager-prompt.ts             # Manager Agent system prompt + context builder
  verifier-prompt.ts            # Verifier Agent system prompt + context builder
  storage.ts                    # Data storage interface
shared/
  schema.ts                     # Data schemas
```

## Multi-Project Architecture
- **Dashboard** (`/`): Shows all projects as cards in a grid. Users can create, rename, and delete projects. Clicking a project card opens its IDE.
- **New Project Flow**: "New Project" dialog asks "What do you want to build today? 😉" with a textarea. User describes their idea → project is created with name "New Project" and blank starter files → navigated to IDE → chat panel auto-opens → user's description is auto-sent as the first AI prompt → AI responds with code and auto-names the project via `[[PROJECT_NAME:name]]` marker (stripped from display).
- **IDE** (`/project/:id`): Full IDE scoped to one project. Each project has isolated files, chat history, open tabs, active file, preview file, and theme.
- **Storage**: Project list persisted via Zustand persist middleware (`codestart-projects`). Each project's IDE state stored separately in localStorage (`codestart-project-{id}`).
- **Project switching**: IDE auto-saves state on unmount/navigation. Loading a new project reads its saved state from localStorage or initializes defaults.
- **Pending Prompt**: New projects carry a `pendingPrompt` in their localStorage state. When IDE loads, it reads the pending prompt, auto-opens chat, auto-sends it, then clears it.
- **AI Auto-Naming**: System prompt instructs AI to include `[[PROJECT_NAME:name]]` in first response. Chat panel parses this during streaming and calls `renameProject()`. Marker is stripped from displayed text.
- **Migration**: On first load, if old single-project state (`codestart-ide-state`) exists, it's migrated to a new project entry. Migration is idempotent (guarded by `codestart-migrated` flag).

## AI Integration
- **Provider**: Doubao (ByteDance) via `https://ark.cn-beijing.volces.com/api/v3`
- **Model**: `doubao-seed-2-0-code-preview-260215` (Doubao Seed 2.0 Code, handles both conversation and code generation)
- **API Route**: `POST /api/chat` — accepts messages + file context, returns SSE stream
- **System Prompt**: Encodes Vibe Agent behavioral rules (demand clarity, confirm before building, no jargon, iterative). Agent is scoped to one project at a time.
- **Incremental Code Auto-Apply**: AI outputs code blocks with `file="..."` annotations → as each code block completes during streaming (closing ``` detected), it is immediately applied to the project files and the preview refreshes. This creates a Replit-agent-like experience where files update one-by-one while the AI is still generating. Each applied code block shows a green "Applied ✓" indicator on its header. A checkpoint is created after the stream finishes (not per block). Nested paths auto-create intermediate directories.
- **Code Annotations**: System prompt requires beginner-friendly, no-jargon inline comments on every line of generated code, matching the user's language
- **Syntax Highlighting in Chat**: Code blocks in chat use a single-pass tokenizer (not regex replace chains) with HTML escaping. Colors match the Monaco editor theme exactly (vs-dark/vs-light/hc-black) using inline styles derived from `THEME_COLORS` map in `chat-panel.tsx`. Supports HTML tags/attributes, CSS properties, JS keywords/strings/comments, and line numbers.
- **Structured Agent Output**: System prompt enforces a 3-part response format when code is generated: (1) Thinking — brief reasoning, (2) Code — the code blocks, (3) Changes Summary — a "Here's what I did:" bullet list. The summary section is visually styled in the chat with a bordered card, checkmark icon, and bold markdown rendering. Summary headers are detected via `SUMMARY_HEADERS` array in `chat-panel.tsx`.
- **Emojis**: Agent includes 1-3 emojis in ~90% of responses for warmth
- **API Key**: Stored in `DOUBAO_API_KEY` environment secret

## UI Design
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

## Checkpoint/Rollback System
- **Inline checkpoints**: After AI applies code blocks, a checkpoint marker appears inline in the chat stream (slim horizontal bar with save icon, label, relative time, and Restore button)
- **Auto-creation**: Checkpoints are automatically created every time the AI applies code changes
- **Incremental diffs**: Storage uses reverse diffs for efficiency. The newest checkpoint stores a full file snapshot; older checkpoints store only the reverse diff (what changed). To restore checkpoint N, start from the newest snapshot and apply reverse diffs backward.
- **Separate storage**: Checkpoints stored in `codestart-checkpoints-{projectId}` localStorage key (separate from main project state)
- **Unlimited**: No cap on number of checkpoints. If localStorage quota is exceeded, oldest checkpoints are trimmed and the new oldest gets its snapshot reconstructed from the diff chain.
- **Restore**: Clicking "Restore" on any checkpoint replaces project files with that checkpoint's state, resets open tabs, and refreshes preview. Chat history is preserved (not rolled back).
- **Orphaned markers**: If a checkpoint is trimmed from storage, its chat marker becomes dimmed and the Restore button is hidden.
- **Data model**: `Checkpoint { id, label, timestamp, snapshot?, diff? }` — `snapshot` is `FlatFile[]`, `diff` is `FileDiff[]` with actions add/modify/delete.

## Manager Agent (3-Agent System)
- **Mode Toggle**: Dropdown selector next to the input bar for switching between Build mode and Manager mode; both modes share a single unified chat stream sorted chronologically
- **3 Agents in Manager Mode**:
  1. **Manager Agent** — Plans and breaks down tasks; does NOT write code
  2. **Editor Agent** — Executes coding for each step (uses the Build/Vibe agent via `/api/chat`)
  3. **Verifier Agent** — Validates code after each step; checks runnability and requirement matching
- **Build Mode** still uses only the Editor/Vibe Agent directly (no Manager or Verifier)

### Manager Agent
- **System Prompt**: `server/manager-prompt.ts` — enforces JSON-only output with plan schema including `sub_task_id` and `acceptance_criteria`
- **API Endpoint**: `POST /api/manager-chat` — non-streaming, returns parsed JSON task plan
- **Plan Schema**: `{ summary, steps: ManagerSubTask[], needs_input: string[] }` where `ManagerSubTask = { step, sub_task_id, title, description, acceptance_criteria }`

### Editor Agent (in Manager Mode context)
- When executing plan steps, the prompt is enriched with `[Manager Mode]` context including `sub_task_id`, task description, `acceptance_criteria`, and a strict instruction to preserve all existing code
- Chat displays a friendly "Working on: {title}" message (assistant-style, left-aligned) instead of the raw technical prompt
- Uses the same `/api/chat` streaming endpoint as Build mode

### Verifier Agent
- **System Prompt**: `server/verifier-prompt.ts` — QA engineer that validates code and checks requirement matching + project integrity
- **API Endpoint**: `POST /api/verifier-chat` — non-streaming, accepts `{ sub_task_id, task_description, acceptance_criteria, files, editor_output, files_before }`
- **Output Schema**: `{ sub_task_id, verification_items: [{item, result: pass|fail|warning, details}], requirement_match_percent, error_summary, user_confirmation_needed, suggestion }`
- **Project Integrity Check**: Verifier receives both pre-edit ("files_before") and post-edit ("files") snapshots, compares them to detect regressions — content wiped, features removed, files shrunk when task was only adding content
- **Regression = FAIL**: A step that meets acceptance criteria but destroys existing work is marked as a failure

### Execution Flow (Editor → Verifier → Manager cycle)
1. For each step: Capture file snapshot → Editor executes coding → Verifier validates with before/after comparison
2. Verifier validates the result (runnability + requirement match + project integrity)
3. If verification passes (all items pass/warning, match ≥ 70%) → step marked "done", proceed
4. If verification fails → retry up to 2 times, then request Manager to re-plan
5. If `user_confirmation_needed` items exist → pause execution, show items to user, "Continue" button resumes
6. After all steps verified → completion message shown

### Task Plan UI
- `TaskPlanCard` shows: summary, step list with status indicators, progress count, needs-input items, Execute/Stop/Continue buttons
- **Step statuses**: pending (○), running (spinner), verifying (🔍 pulse), done (✓ + match% badge), failed (✗ + error), needs-input (?)
- **Verification results** shown inline: match percentage badge on done steps, error summary on failed steps

### State
- `chatMode`, `managerPlan`, `managerMessages`, `executingTaskIndex`, `taskStatuses`, `verificationResults`, `isManagerResponding` in `ide-store.ts`
- `taskStatuses` includes: `"pending" | "running" | "verifying" | "done" | "failed" | "needs-input"`
- `verificationResults: Record<string, VerificationResult>` stores per-step verification data
- **Task status keys**: Use `String(task.step)` as keys in `taskStatuses`
- **Backward Compatibility**: Old persisted plans with `sub_tasks` field normalized to `steps` format
- **Persistence**: `chatMode` and `managerMessages` persisted to localStorage per project; debounced at 500ms
- **Stop Execution**: User can halt automated execution at any time

## Features
- Multi-project dashboard with create/rename/delete
- Per-project isolated files, chat history, and preview
- Monaco code editor with theme switching (Dark+, Light+, High Contrast)
- File tree with create, rename, delete, duplicate (via context menu)
- Live HTML preview with multi-file resolution and console output capture
- Console panel showing log/warn/error from preview iframe
- Tools dock for switching between Files panel and AI Chat panel
- AI Chat with Doubao streaming responses and code block Apply buttons
- Manager Agent mode for automated task planning and execution
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
