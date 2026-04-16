# My Coding Notebook — Mentor Agent & Learner Space

## Overview
Add a "My Coding Notebook" feature that helps beginners understand their code. A new Mentor Agent analyzes the project codebase and generates educational content: a friendly summary of what each file does, how files connect, key programming concepts used, and an interactive mind map visualizing the project structure.

The feature lives in a new "Learner Space" view, accessible via a workspace/learner-space toggle at the top of the IDE.

## Architecture

### Backend (2 new files + 1 modified)

**New: `server/mentor-prompt.ts`**
- System prompt defining the Mentor Agent personality: warm, educational, emoji-rich (~90%), simplified language
- Prompt instructs the model to analyze provided project files and return structured JSON:
  ```json
  {
    "project_summary": "...",
    "file_breakdowns": [
      {
        "file": "/project/index.html",
        "what_it_does": "...",
        "key_concepts": [
          { "term": "HTML", "explanation": "..." }
        ],
        "connections": ["/project/style.css", "/project/app.js"]
      }
    ],
    "mind_map": {
      "central_node": "...",
      "branches": [
        {
          "label": "...",
          "file": "...",
          "children": [{ "label": "...", "explanation": "..." }]
        }
      ]
    },
    "learning_tips": ["...", "..."]
  }
  ```

**New: `server/doubao-client.ts` (modify)**
- Add a second model constant: `DOUBAO_LITE_MODEL = process.env.DOUBAO_LITE_MODEL || "doubao-seed-2-0-lite"` for the Mentor Agent
- The existing `DOUBAO_MODEL` (code-preview) remains unchanged for all other agents

**Modified: `server/routes.ts`**
- New endpoint: `POST /api/mentor-analyze`
  - Receives: `{ files: [{path, content}] }` — the full project file tree
  - Sends all file contents + system prompt to Doubao Seed 2.0 Lite (non-streaming, `max_tokens: 4096`)
  - Returns the structured JSON notebook content
  - Uses `parseAIJson` for safe parsing with raw fallback

### Frontend (3 new files + 2 modified)

**New: `client/src/components/ide/notebook-panel.tsx`**
- The main "My Coding Notebook" UI component
- Sections:
  1. **Project Summary** — friendly overview of what the project does
  2. **File Breakdowns** — expandable cards for each file with "what it does", key concepts with tooltips/explanations, and which other files it connects to
  3. **Mind Map** — visual node graph showing how files relate (rendered with a lightweight library like `reactflow` or a simple custom SVG/canvas renderer)
  4. **Learning Tips** — callout cards with educational tips
- Has a "Refresh Notebook" button that re-triggers the Mentor Agent analysis
- Shows a loading skeleton while the Mentor Agent is analyzing
- Stores notebook content in the IDE store (persisted to localStorage with the project)

**New: `client/src/components/ide/mind-map.tsx`**
- Renders the mind map data as a visual tree/graph
- Central node = project name, branches = files, leaves = concepts
- Interactive: click nodes to see explanations
- Uses simple SVG rendering with CSS animations (no heavy dependencies)
- Color-coded by file type (HTML = orange, CSS = blue, JS = yellow, etc.)

**Modified: `client/src/pages/ide.tsx`**
- Add a workspace toggle at the top: "Project Workspace" | "Learner Space"
- New state: `activeSpace: "workspace" | "learner"` in IDE store
- When "Learner Space" is selected, the main workspace area (editor + preview) is replaced by the NotebookPanel
- The ToolsDock and Navbar remain visible in both spaces

**Modified: `client/src/stores/ide-store.ts`**
- New state fields:
  - `activeSpace: "workspace" | "learner"` — which space is active
  - `notebookContent: NotebookContent | null` — cached Mentor Agent output
  - `isNotebookLoading: boolean` — loading state
  - `notebookError: string | null` — error state
- New actions:
  - `setActiveSpace(space)` — switch between workspace and learner space
  - `setNotebookContent(content)` — store the Mentor Agent's analysis
  - `generateNotebook()` — triggers the API call with current project files
- NotebookContent interface matching the JSON structure above
- Notebook content persisted to localStorage alongside other project data

### Incremental Updates
- When the user switches to Learner Space, if `notebookContent` is null or stale (files have changed since last analysis), automatically trigger a refresh
- A visual indicator shows when the notebook is outdated (files changed since last generation)
- The "Refresh Notebook" button allows manual re-generation at any time

### UX Flow
1. User builds their project in the normal Project Workspace
2. User clicks "Learner Space" toggle in the IDE header
3. The workspace transitions to show the Coding Notebook
4. If this is the first visit (or files changed), the Mentor Agent automatically analyzes the codebase
5. A friendly loading state shows while analysis runs ("Your mentor is reading through your code...")
6. The notebook renders with project summary, file breakdowns, mind map, and learning tips
7. User can click file cards to expand details, interact with the mind map, and read learning tips
8. User switches back to "Project Workspace" to continue building

### Key Files
- `server/mentor-prompt.ts` (new)
- `server/doubao-client.ts` (modify — add lite model)
- `server/routes.ts` (modify — add /api/mentor-analyze)
- `client/src/components/ide/notebook-panel.tsx` (new)
- `client/src/components/ide/mind-map.tsx` (new)
- `client/src/stores/ide-store.ts` (modify — add notebook state)
- `client/src/pages/ide.tsx` (modify — add space toggle + conditional rendering)

### Dependencies
- No new npm packages required. Mind map will be rendered with custom SVG.
- Uses existing Doubao API client with new lite model constant.

### Verification
1. Create a project, build some code with the agent
2. Switch to Learner Space — notebook should auto-generate
3. Verify project summary is friendly and educational
4. Verify file breakdowns explain each file in beginner terms
5. Verify mind map renders with nodes for each file and concept connections
6. Verify learning tips are relevant and encouraging
7. Switch back to Project Workspace — everything preserved
8. Make code changes, switch back to Learner Space — notebook refreshes with updated content
