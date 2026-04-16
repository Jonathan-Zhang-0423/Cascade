# OpenCode Backend Integration — Design Spec

**Date:** 2026-04-11  
**Status:** Approved for implementation  
**Branch:** `feat/opencode-backend`

---

## Problem

CodeStart's current agent pipeline (editor + verifier + fixer agents) produces low-quality code output. The custom LLM loop with hand-crafted tool schemas does not match the intelligence of purpose-built coding agents. OpenCode + oh-my-opencode (OmO) provides a significantly better execution engine (68.3% file edit success vs 6.7% baseline with OmO's hash-anchored edits).

---

## Solution Overview: Full OpenCode Backend (Option A)

Replace the entire CodeStart agent pipeline — manager, editor, fixer, and verifier — with OpenCode + OmO. OmO's internal quality gates (Momus plan review, LSP diagnostics, Sisyphus-Junior completion checks) are sufficient. No CodeStart agents remain.

### Agent Replacement Map

| CodeStart Agent | OmO Equivalent | Decision |
|----------------|----------------|----------|
| Manager agent (planner) | Prometheus (strategic planner) | **Replace** — Prometheus interviews user, produces structured plans, validates via Momus |
| Editor agent (code builder) | Hephaestus / Atlas executor | **Replace** — OmO's hash-anchored edits are far superior |
| Fixer agent (fix cycles) | Sisyphus re-invocation | **Replace** — OmO retries internally |
| Verifier agent (acceptance check) | Momus + LSP diagnostics | **Replace** — OmO's internal quality gates are sufficient |

### Architecture

```
User Request
     │
     ▼
OpenCode + OmO (replaces ALL CodeStart agents)
  ┌─────────────────────────────────────────────────────┐
  │  Prometheus: plan + validate (replaces manager)     │
  │  Sisyphus/Atlas/Hephaestus: execute (replaces editor)│
  │  Momus: plan review; LSP diagnostics during exec    │
  │  (replaces verifier + fixer)                        │
  │                                                     │
  │  1. Write session files to tmpdir on disk            │
  │  2. Write opencode.json + OmO plugin config          │
  │  3. opencode serve (shared process, started once)   │
  │  4. createOpencodeClient({ directory: tmpdir })     │
  │  5. client.session.promptAsync(user request)        │
  │  6. Subscribe to event stream → translate events    │
  │  7. Read files back from disk → BuildSessionState   │
  └─────────────────────────────────────────────────────┘
     │
     ▼
all_complete emitted → client shows result
```

---

## Components

### 1. OpenCode Process Manager (`server/opencode-manager.ts`)

A singleton that starts `opencode serve` once at server startup and keeps it running.

```typescript
// Starts opencode serve subprocess, waits for "server listening" stdout
// Returns { url: string, close(): void }
createOpencodeServer({ cwd: process.cwd() })
```

- Started in `server/index.ts` on startup
- Shared across all build sessions (OpenCode is multi-tenant via the `x-opencode-directory` header)
- Graceful shutdown on SIGTERM

### 2. Session Tmpdir Helper (`server/opencode-session.ts`)

Per-build session, writes files to disk so OpenCode can operate on them.

```typescript
async function writeSessionTmpdir(
  sessionId: string,
  files: Map<string, string>
): Promise<string>  // returns tmpdir path
```

- Creates `/tmp/codestart-{sessionId}/`
- Writes each file from `BuildSessionState.files`
- Writes `opencode.json`:
  ```json
  {
    "permission": { "*": "allow" },
    "plugins": ["oh-my-opencode"]
  }
  ```
- Returns the tmpdir path

```typescript
async function readSessionTmpdir(
  tmpdir: string,
  files: Map<string, string>
): Promise<void>
```

- Reads all files from disk back into the files Map after build completes

### 3. Prompt Builder (`server/opencode-session.ts`)

Since Prometheus (OmO's planner) handles planning internally, we pass the raw user request directly — no need to pre-structure steps.

```typescript
function buildOpencodePrompt(userRequest: string): string
```

Format:
```
{userRequest}
```

Prometheus interviews internally (if needed), plans, validates, then Hephaestus executes. No pre-built step list needed from CodeStart's side.

### 4. OpenCode Event Translator (`server/opencode-session.ts`)

Maps OpenCode's SSE events to CodeStart's existing SSE event vocabulary.

| OpenCode Event | CodeStart Event | Notes |
|----------------|-----------------|-------|
| `session.status` (running) | `step_starting` | Emit once at start |
| `file.edited` | `code_applied` | Per file write |
| `part.created` (text) | `narration_token` | Agent text output |
| `message.updated` | — | Internal, skip |
| `session.idle` | trigger verifier | Build phase complete |
| `session.error` | `build_error` | Forward error message |

### 5. Updated `runBuildSession()` (`server/build-orchestrator.ts`)

The high-level flow becomes:

```
1. emit step_starting (Prometheus planning phase begins)
2. writeSessionTmpdir(session.id, session.files)
3. client = createOpencodeClient({ directory: tmpdir })
4. ocSession = await client.session.create()
5. subscribe to client.event.subscribe()
6. await client.session.promptAsync(ocSession.id, userRequest)  ← raw request, no pre-built plan
7. wait for session.idle event (OmO planned + built + quality-checked internally)
8. readSessionTmpdir(tmpdir, session.files)
9. cleanup tmpdir
10. emit all_complete — done
```

No verifier loop. No fix cycles. OmO handles all quality gates internally.

---

## Dependencies

```bash
npm install opencode-ai @opencode-ai/sdk
npm install oh-my-opencode
```

The `opencode` CLI must be available as a shell command. The SDK's `createOpencodeServer()` spawns it as a subprocess.

---

## Configuration

`opencode.json` written per tmpdir:
```json
{
  "permission": { "*": "allow" },
  "plugins": ["oh-my-opencode"],
  "model": "moonshot/kimi-k2.5",
  "agents": {
    "default": "hephaestus"
  }
}
```

- `permission: { "*": "allow" }` — suppresses interactive confirmation prompts
- `hephaestus` (OmO) — the deep executor agent with hash-anchored edits
- **Model selection — Chinese providers only, no US providers:**
  - `moonshot/kimi-k2.5` — Kimi K2.5 from Moonshot AI (latest). Uses `KIMI_API_KEY` (already configured in CodeStart). **Default choice.**
  - `minimax/MiniMax-M2.7` — MiniMax M2.7 (latest). Uses `MINIMAX_API_KEY` (already configured). Fallback option.
  - `glm/glm-5` — GLM-5 from Zhipu AI (latest). Uses `GLM_API_KEY` (already configured). Second fallback.
  - Model is overridable via `OPENCODE_MODEL` env var
- OpenCode provider credentials are stored in `~/.local/share/opencode/auth.json` (set via `/connect` command or env vars)

---

## What Does NOT Change

- All SSE event names consumed by the client (existing events still emitted)
- `useBuildStream.ts` — minimal changes (remove verifier/bug_found handling)
- Checkpoint + file persistence logic
- The `BuildSessionState` interface (files Map stays)

## What Is Removed / Replaced

- Manager agent + `/api/manager-chat` → replaced by OmO's Prometheus
- Editor agent + `runAgentLoop` build phase → replaced by OmO's Hephaestus/Atlas
- Fixer agent loop → replaced by OmO's internal retry
- Verifier agent loop → replaced by OmO's Momus + LSP diagnostics
- `useManagerStream.ts` — removed or repurposed for OpenCode planning events
- `server/manager-prompt.ts` — removed
- `server/editor-prompt.ts` — removed
- `server/verifier-prompt.ts` — removed

---

## Rollback

All changes on branch `feat/opencode-backend`. To revert: `git checkout main`.

---

## Verification

1. Start server: `npm run dev`
2. Send a build request — OmO should handle planning + building internally
3. Watch SSE events in browser network tab: `step_starting`, `narration_token`, `code_applied`, `all_complete`, `done`
4. Verify files in editor match what was built
5. Check console for OpenCode subprocess output
6. Confirm no calls to old `/api/manager-chat` or `/api/communicator-chat` endpoints
