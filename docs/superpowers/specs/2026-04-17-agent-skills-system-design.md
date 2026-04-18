# Agent Skills System Design

**Date:** 2026-04-17  
**Status:** Approved

## Context

Cascade AI agents currently have fixed tool sets and framework knowledge packs (injected as system prompt text). There's no way for users to extend what agents know or what they can do. This design adds a **hybrid skill system** that lets both platform developers and end users define:

1. **Knowledge packs** — markdown guidance injected into the agent's system prompt
2. **Tool plugins** — declarative tool definitions that register new callable tools into the agent loop

---

## Architecture

Two layers of extension, unified under a single "skills" concept:

### Knowledge Packs
Markdown files appended to the agent system prompt under `## User Skills` section. Extend the existing `skill-loader.ts` pattern.

### Tool Plugins
JSON-defined tools with a declarative handler. Registered into the agent's `schemas[]` and `handlers{}` at build session start. Handler types are limited to `shell` (sandboxed) and `http` (external API/webhook) — no arbitrary code execution.

### Skill Sources (priority/merge order)
1. **Built-in** — `/server/skills/*.md` and `/server/skills/*.tool.json` (shipped with platform)
2. **Project-local** — `.cascade/skills/` directory in the user's project files (`session.files`)
3. **DB-stored** — user/project skills created via the UI, stored in `userSkills` / `projectSkills` tables

All three sources are merged at build session start. Later sources can override earlier ones by name.

---

## Data Model

New tables in `shared/schema.ts`:

### `userSkills`
Global skills available across all of a user's projects.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `userId` | integer FK | references `users.id` |
| `name` | text | unique per user |
| `description` | text | shown in UI |
| `type` | text | `"knowledge"` or `"tool"` |
| `content` | text | markdown (knowledge) or JSON (tool) |
| `enabled` | boolean | default true |
| `createdAt` | timestamp | |

### `projectSkills`
Project-scoped skills; override or extend user skills.

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `projectId` | integer FK | references `projects.id` |
| `userId` | integer FK | references `users.id` |
| `name` | text | unique per project |
| `description` | text | |
| `type` | text | `"knowledge"` or `"tool"` |
| `content` | text | markdown or JSON |
| `enabled` | boolean | default true |
| `createdAt` | timestamp | |

### Tool Plugin JSON Schema
When `type = "tool"`, the `content` field is a JSON string with this structure:

```json
{
  "name": "run_migration",
  "description": "Runs database migrations in the specified direction",
  "parameters": {
    "type": "object",
    "properties": {
      "direction": {
        "type": "string",
        "enum": ["up", "down"],
        "description": "Migration direction"
      }
    },
    "required": ["direction"]
  },
  "handler": {
    "type": "shell",
    "command": "npm run db:migrate -- {{direction}}"
  }
}
```

**Handler types:**
- `shell` — runs `command` in the existing Docker sandbox; supports `{{paramName}}` template interpolation
- `http` — makes a POST to `url` with the tool args as JSON body; supports custom `headers`

---

## Loading & Injection

### New file: `server/user-skill-loader.ts`

```typescript
export interface LoadedSkills {
  knowledgePacks: string[];       // markdown strings to append to system prompt
  toolSchemas: ToolSchema[];      // tool definitions for agent loop
  toolHandlers: ToolHandlers;     // handler implementations
}

export async function loadUserSkills(
  session: BuildSessionState,
  projectId: number,
  userId: number
): Promise<LoadedSkills>
```

**Steps:**
1. Load built-in skills from `/server/skills/`
2. Scan `session.files` for `.cascade/skills/**` entries
3. Query DB for enabled skills in `userSkills` (for userId) and `projectSkills` (for projectId)
4. Deduplicate by name (project > user > built-in)
5. Parse knowledge packs as markdown strings
6. Parse tool plugins into `ToolSchema` + handler via `buildDeclaredToolHandler()`

### Integration in `build-orchestrator.ts`

At the start of `runBuildSession()`, before composing `builderTools`:

```typescript
const userSkills = await loadUserSkills(session, projectId, userId);

// Inject knowledge packs
session.skillContent = [session.skillContent, ...userSkills.knowledgePacks]
  .filter(Boolean).join("\n\n---\n\n");

// Inject tool plugins
schemas.push(...userSkills.toolSchemas);
Object.assign(handlers, userSkills.toolHandlers);
```

---

## API Endpoints

New routes in `server/routes.ts`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/skills/user` | List user's global skills |
| `POST` | `/api/skills/user` | Create user skill |
| `PUT` | `/api/skills/user/:id` | Update user skill |
| `DELETE` | `/api/skills/user/:id` | Delete user skill |
| `GET` | `/api/skills/project/:projectId` | List project skills |
| `POST` | `/api/skills/project/:projectId` | Create project skill |
| `PUT` | `/api/skills/project/:projectId/:id` | Update project skill |
| `DELETE` | `/api/skills/project/:projectId/:id` | Delete project skill |
| `POST` | `/api/skills/test-tool` | Dry-run a tool plugin in sandbox |

---

## UI

### Skills Panel

A **Skills** tab in the IDE sidebar (alongside the existing tools dock).

**Layout:**
- Grouped list: Built-in / Project Skills / User Skills
- Each item shows: name, description, type badge (knowledge/tool), enabled toggle
- "New Skill" button opens a modal

**New/Edit Skill Modal:**
- Name, description fields
- Type selector: Knowledge Pack | Tool Plugin
- Editor:
  - Knowledge: markdown editor with preview
  - Tool: JSON editor with schema validation inline
- For tool plugins: "Test Tool" button that POSTs to `/api/skills/test-tool`
- Save/Cancel

### Files: 
- `client/src/components/ide/skills-panel.tsx` — main panel
- `client/src/components/ide/skills-modal.tsx` — create/edit modal

---

## Security

- **Shell handler**: commands run in the existing Docker sandbox (`buildShellTools` pattern); same restrictions apply
- **HTTP handler**: only HTTPS URLs allowed; no access to internal network addresses (block RFC1918)
- **Template interpolation**: parameters are shell-escaped before substitution to prevent injection
- **Tool name collisions**: user-defined tools cannot shadow built-in tool names (`write_file`, `read_file`, etc.)

---

## Verification

1. Add a knowledge pack skill via UI → start a build → confirm the skill content appears in the agent's system prompt (check server logs)
2. Add a shell tool plugin (e.g., `echo {{message}}`) → verify agent can call it during a build and receives the output
3. Add a `.cascade/skills/my-guide.md` file to a project → confirm it's picked up and injected
4. Disable a skill via the toggle → confirm it's no longer injected in the next build
5. Test tool name collision guard → confirm user can't shadow `write_file`
6. Test HTTP handler with a webhook → confirm args are POSTed and response returned to agent

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `shared/schema.ts` | Add `userSkills`, `projectSkills` tables |
| `server/user-skill-loader.ts` | New — load + merge all skill sources |
| `server/build-orchestrator.ts` | Inject user skills at session start |
| `server/routes.ts` | Add skills CRUD + test-tool endpoints |
| `client/src/components/ide/skills-panel.tsx` | New — skills UI panel |
| `client/src/components/ide/skills-modal.tsx` | New — create/edit modal |
| `client/src/components/ide/tools-dock.tsx` | Add Skills tab entry |
