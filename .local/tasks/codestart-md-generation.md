# Auto-generate codestart.md + server-side project persistence

## What & Why
Two related improvements in one task:
1. When a user creates a new project, the agent automatically generates a `codestart.md` file — a living document describing the project's architecture, dependencies, and key decisions. It is updated as the project evolves through builds and chats.
2. All project files (HTML, CSS, JS, and codestart.md) are persisted server-side in the PostgreSQL database, so projects survive browser localStorage loss and are accessible across devices — similar to how Replit stores files on its servers.

## Done looks like
- Every new project has a `codestart.md` file in its file tree from the moment it's created
- After the Manager Agent finishes planning, codestart.md is populated with real, project-specific content including:
  - `## Overview` — what the project is and what it does
  - `## User Preferences` — any expressed preferences from the prompt (language, framework, style, constraints)
  - `## System Architecture` — frontend approach, backend, core features, design patterns
  - `## External Dependencies` — libraries, APIs, or services in the plan
  - Additional agent-chosen sections with meaningful names specific to the project (e.g. `## Authentication Model`, `## Data Flow`) — not a generic catch-all label
- codestart.md is refreshed after each subsequent build step or chat where the architecture or dependencies meaningfully change
- All project files (the full file tree) are saved to the PostgreSQL database on every change, not just to localStorage
- When loading a project, files are fetched from the server first; localStorage is used as a fallback for offline/legacy support
- Projects and their files are available on any device or browser, as long as the user is on the same deployment
- The file tree and editor continue to work exactly as before from the user's perspective — the persistence change is transparent

## Out of scope
- User authentication / per-user project isolation (projects remain unscoped to a specific logged-in user for now)
- User-facing UI controls for manually regenerating or resetting codestart.md
- Real-time collaboration or multi-tab sync

## Tasks
1. **Extend the database schema for projects and files** — Add tables to `shared/schema.ts` for storing projects (id, name, emoji, createdAt) and project files (projectId, path, content). Generate the corresponding insert/select types.

2. **Implement server-side storage for projects and files** — Add methods to `server/storage.ts` and routes to `server/routes.ts` for creating a project, saving/updating files, and loading a full project by ID. Keep routes thin and validate with Zod schemas.

3. **Sync frontend file writes to the server** — Update `client/src/stores/ide-store.ts` so that whenever files are created, updated, or deleted, the changes are sent to the server API in addition to being saved in localStorage. On project load, fetch the file tree from the server and use it as the source of truth, falling back to localStorage if the server has no record.

4. **Sync project metadata to the server** — Update `client/src/stores/project-store.ts` so that creating or renaming a project also writes to the server. The project list on the dashboard should be loaded from the server, with localStorage as a fallback.

5. **Add codestart.md as a default project file** — Include `codestart.md` with stub section headers in `BLANK_FILES` so it exists in every new project's file tree from the start.

6. **Generate codestart.md content after initial planning** — After the Manager Agent returns a plan in `/api/manager-chat`, make an AI call to produce the full codestart.md content. The agent writes four fixed sections plus any additional project-specific sections it deems important, each with a meaningful name. The result is written back into the project file tree and persisted to the server.

7. **Keep codestart.md updated on subsequent builds and chats** — After each build step or meaningful chat response, have the agent re-evaluate and update codestart.md if the project's architecture, dependencies, or notable attributes have changed.

## Relevant files
- `shared/schema.ts`
- `server/storage.ts`
- `server/routes.ts`
- `server/manager-prompt.ts`
- `client/src/stores/project-store.ts`
- `client/src/stores/ide-store.ts`
- `client/src/components/ide/file-tree.tsx`
- `client/src/components/ide/chat-panel.tsx`
