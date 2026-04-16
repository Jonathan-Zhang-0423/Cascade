# OpenCode Backend Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CodeStart's custom editor + verifier + fixer agent pipeline with OpenCode + oh-my-opencode (OmO), producing dramatically better code output (68.3% file edit success vs 6.7% baseline).

**Architecture:** Per build session, write project files to a tmpdir, create an OpenCode client pointed at that directory, call `client.session.promptAsync(userRequest)` directly (no pre-built plan — Prometheus plans internally), subscribe to SSE events, translate to CodeStart's existing SSE vocabulary, then read the result files back. A singleton `opencode serve` subprocess is started once at server boot and shared across all sessions.

**Tech Stack:** `@opencode-ai/sdk` (OpenCode JS client), `oh-my-opencode` (OmO plugin), `moonshot/kimi-k2.5` (default model, KIMI_API_KEY), `minimax/MiniMax-M2.7` (fallback), `glm/glm-5` (second fallback). All changes on branch `feat/opencode-backend`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/opencode-manager.ts` | **Create** | Singleton `opencode serve` subprocess — start once, share across sessions |
| `server/opencode-session.ts` | **Create** | Per-session: write tmpdir, write `opencode.json`, translate events, read files back |
| `server/build-orchestrator.ts` | **Rewrite** | `runBuildSession()` — now delegates to OpenCode instead of agent loop |
| `server/index.ts` | **Modify** | Add OpenCode singleton startup at server boot |
| `server/routes.ts` | **Modify** | Remove manager/editor/verifier agent imports; `runBuildSession` call stays |
| `client/src/components/ide/chat/hooks/useBuildStream.ts` | **Verify** | Confirm `all_complete.summaryText` path exists (already present per exploration) |

Files that are **deleted** after migration is working:
- `server/editor-prompt.ts` (replaced by OmO)
- `server/verifier-prompt.ts` (replaced by OmO internal quality gates)
- `server/manager-prompt.ts` (replaced by Prometheus — but keep until `/api/manager-chat` is also replaced; out of scope for this plan)

---

## Task 1: Create branch and install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/opencode-backend
```

Expected: `Switched to a new branch 'feat/opencode-backend'`

- [ ] **Step 2: Install OpenCode SDK and OmO plugin**

```bash
npm install @opencode-ai/sdk oh-my-opencode
```

Expected: Both packages added to `node_modules`. Check versions:
```bash
node -e "console.log(require('@opencode-ai/sdk/package.json').version)"
node -e "console.log(require('oh-my-opencode/package.json').version)"
```

- [ ] **Step 3: Verify opencode CLI is available**

```bash
which opencode
```

Expected: `/opt/homebrew/bin/opencode` (or another path). If missing, install: `npm install -g opencode-ai`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @opencode-ai/sdk and oh-my-opencode dependencies"
```

---

## Task 2: Create `server/opencode-manager.ts` — singleton process manager

**Files:**
- Create: `server/opencode-manager.ts`

This module starts `opencode serve` once at server boot (not per-session) and returns its URL. It pre-populates `~/.local/share/opencode/auth.json` with API keys so OpenCode can use them headlessly (no interactive `/connect` prompt).

- [ ] **Step 1: Create `server/opencode-manager.ts`**

```typescript
import { spawn, type ChildProcess } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export interface OpenCodeServer {
  url: string;
  process: ChildProcess;
  close(): void;
}

let _server: OpenCodeServer | null = null;

/**
 * Write API keys to ~/.local/share/opencode/auth.json so opencode serve
 * can authenticate headlessly (no interactive /connect needed).
 */
async function writeAuthJson(): Promise<void> {
  const authDir = join(homedir(), ".local", "share", "opencode");
  await mkdir(authDir, { recursive: true });

  const auth: Record<string, { key: string }> = {};
  if (process.env.KIMI_API_KEY) auth["moonshot"] = { key: process.env.KIMI_API_KEY };
  if (process.env.MINIMAX_API_KEY) auth["minimax"] = { key: process.env.MINIMAX_API_KEY };
  if (process.env.GLM_API_KEY) auth["glm"] = { key: process.env.GLM_API_KEY };

  await writeFile(join(authDir, "auth.json"), JSON.stringify(auth, null, 2));
}

/**
 * Start opencode serve once. Resolves when the server is ready.
 * Returns the server URL and a close() function.
 */
export async function startOpencodeServer(): Promise<OpenCodeServer> {
  if (_server) return _server;

  await writeAuthJson();

  return new Promise((resolve, reject) => {
    const proc = spawn("opencode", ["serve"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let resolved = false;

    proc.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      console.log("[opencode]", line.trim());

      // opencode serve prints something like: "server listening on http://localhost:XXXXX"
      const match = line.match(/listening on (https?:\/\/[^\s]+)/i)
        ?? line.match(/server.*?(https?:\/\/localhost:\d+)/i);
      if (match && !resolved) {
        resolved = true;
        _server = {
          url: match[1],
          process: proc,
          close() {
            proc.kill("SIGTERM");
            _server = null;
          },
        };
        resolve(_server);
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      // stderr may also carry the listening message
      const match = line.match(/listening on (https?:\/\/[^\s]+)/i)
        ?? line.match(/server.*?(https?:\/\/localhost:\d+)/i);
      if (match && !resolved) {
        resolved = true;
        _server = {
          url: match[1],
          process: proc,
          close() {
            proc.kill("SIGTERM");
            _server = null;
          },
        };
        resolve(_server);
      }
    });

    proc.on("error", (err) => {
      if (!resolved) reject(new Error(`Failed to start opencode serve: ${err.message}`));
    });

    proc.on("exit", (code) => {
      _server = null;
      if (!resolved) reject(new Error(`opencode serve exited with code ${code} before becoming ready`));
    });

    // 30-second timeout
    setTimeout(() => {
      if (!resolved) {
        proc.kill();
        reject(new Error("opencode serve did not become ready within 30 seconds"));
      }
    }, 30_000);
  });
}

/**
 * Get the running server (must call startOpencodeServer first).
 */
export function getOpencodeServer(): OpenCodeServer {
  if (!_server) throw new Error("OpenCode server not started. Call startOpencodeServer() first.");
  return _server;
}
```

- [ ] **Step 2: Type-check the new file**

```bash
cd /Users/jonathanzhang/Desktop/CodeStart/CodeStart && npx tsc --noEmit --skipLibCheck 2>&1 | grep opencode-manager
```

Expected: no errors for `opencode-manager.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/opencode-manager.ts
git commit -m "feat: add opencode-manager singleton process manager"
```

---

## Task 3: Create `server/opencode-session.ts` — per-session helpers

**Files:**
- Create: `server/opencode-session.ts`

This file handles three things per build session:
1. Write project files + `opencode.json` to a tmpdir
2. Read result files back into the `Map<string, string>`
3. Translate OpenCode SSE events to CodeStart SSE events

- [ ] **Step 1: Create `server/opencode-session.ts`**

```typescript
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { existsSync, readdirSync, statSync } from "fs";
import { tmpdir as osTmpdir } from "os";
import { join, relative } from "path";

export type SseEmit = (data: Record<string, unknown>) => void;

// ─── Tmpdir helpers ──────────────────────────────────────────────────────────

/**
 * Write session files and opencode.json to /tmp/codestart-{sessionId}/.
 * Returns the tmpdir path.
 */
export async function writeSessionTmpdir(
  sessionId: string,
  files: Map<string, string>,
): Promise<string> {
  const dir = join(osTmpdir(), `codestart-${sessionId}`);
  await mkdir(dir, { recursive: true });

  // Write all project files
  for (const [filePath, content] of files.entries()) {
    const abs = join(dir, filePath);
    const parentDir = abs.substring(0, abs.lastIndexOf("/"));
    await mkdir(parentDir, { recursive: true });
    await writeFile(abs, content, "utf8");
  }

  // Determine model from env or use default hierarchy
  const model = process.env.OPENCODE_MODEL
    ?? (process.env.KIMI_API_KEY ? "moonshot/kimi-k2.5"
      : process.env.MINIMAX_API_KEY ? "minimax/MiniMax-M2.7"
      : "glm/glm-5");

  // Write opencode.json config
  const opencodeConfig = {
    $schema: "https://opencode.ai/config.json",
    permission: { "*": "allow" },
    plugins: ["oh-my-opencode"],
    model,
    agents: {
      default: "hephaestus",
    },
  };
  await writeFile(join(dir, "opencode.json"), JSON.stringify(opencodeConfig, null, 2), "utf8");

  return dir;
}

/**
 * Read all files from tmpdir back into the files Map.
 * Skips opencode.json, .sisyphus/ directory, and hidden files/dirs.
 */
export async function readSessionTmpdir(
  dir: string,
  files: Map<string, string>,
): Promise<void> {
  const SKIP = new Set(["opencode.json", ".sisyphus", "node_modules", ".git"]);

  function walk(current: string): string[] {
    const entries = readdirSync(current);
    const results: string[] = [];
    for (const entry of entries) {
      if (SKIP.has(entry) || entry.startsWith(".")) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...walk(full));
      } else {
        results.push(full);
      }
    }
    return results;
  }

  if (!existsSync(dir)) return;

  for (const absPath of walk(dir)) {
    const relPath = relative(dir, absPath);
    try {
      const content = await readFile(absPath, "utf8");
      files.set(relPath, content);
    } catch {
      // Binary files — skip
    }
  }
}

/**
 * Remove tmpdir after session is complete.
 */
export async function cleanupSessionTmpdir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {}
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

/**
 * Build the prompt to send to OpenCode.
 * Prometheus (OmO's planner) handles all planning internally —
 * we pass the raw user request directly with no pre-structured steps.
 */
export function buildOpencodePrompt(userRequest: string): string {
  return userRequest;
}

// ─── Event translator ────────────────────────────────────────────────────────

/**
 * Translate an OpenCode SSE event to a CodeStart SseEmit call.
 *
 * OpenCode event shapes (from @opencode-ai/sdk):
 *   { type: "session.status", properties: { status: "running" | "idle" | "error" } }
 *   { type: "part.created", properties: { part: { type: "text", content: string } } }
 *   { type: "file.edited", properties: { file: string } }
 *   { type: "session.error", properties: { error: { message: string } } }
 *   { type: "message.updated" }  — internal, skip
 */
export function translateOpencodeEvent(
  ocEvent: Record<string, unknown>,
  emit: SseEmit,
  sessionContext: { editedFiles: Set<string>; started: boolean },
): "continue" | "idle" | "error" {
  const type = ocEvent.type as string | undefined;
  const props = (ocEvent.properties ?? ocEvent) as Record<string, unknown>;

  if (!type) return "continue";

  switch (type) {
    case "session.status": {
      const status = (props.status as string) ?? "";
      if (status === "running" && !sessionContext.started) {
        sessionContext.started = true;
        emit({ type: "step_starting", stepNumber: 1, stepTitle: "Building with OpenCode", totalSteps: 1 });
      }
      if (status === "idle") return "idle";
      if (status === "error") return "error";
      break;
    }

    case "part.created": {
      const part = props.part as Record<string, unknown> | undefined;
      if (part?.type === "text" && typeof part.content === "string" && part.content.trim()) {
        emit({ type: "narration_token", token: part.content });
      }
      break;
    }

    case "file.edited": {
      const file = props.file as string | undefined;
      if (file) {
        sessionContext.editedFiles.add(file);
        emit({ type: "code_applied", file });
      }
      break;
    }

    case "session.error": {
      const err = props.error as Record<string, unknown> | undefined;
      const message = (err?.message as string) ?? "OpenCode session error";
      emit({ type: "build_error", message });
      return "error";
    }

    case "message.updated":
      // Internal — skip
      break;

    default:
      // Unknown event — ignore
      break;
  }

  return "continue";
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/jonathanzhang/Desktop/CodeStart/CodeStart && npx tsc --noEmit --skipLibCheck 2>&1 | grep opencode-session
```

Expected: no errors for `opencode-session.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/opencode-session.ts
git commit -m "feat: add opencode-session tmpdir helpers and event translator"
```

---

## Task 4: Rewrite `server/build-orchestrator.ts`

**Files:**
- Modify: `server/build-orchestrator.ts`

Replace the entire `runBuildSession()` body. Keep the exported types (`BuildSessionState`, `BuildPlan`, `BuildStep`, `BufferedEvent`, `SseEmit`, `BuildFile`). Remove all agent-loop imports.

- [ ] **Step 1: Read the current file to understand what types to keep**

Open `server/build-orchestrator.ts`. The types to keep (lines 17–62):
- `BuildFile`, `BuildStep`, `BuildPlan`, `BufferedEvent`, `BuildSessionState`, `SseEmit`

- [ ] **Step 2: Replace the entire file**

```typescript
import { createClient } from "@opencode-ai/sdk";
import { storage } from "./storage";
import {
  writeSessionTmpdir,
  readSessionTmpdir,
  cleanupSessionTmpdir,
  buildOpencodePrompt,
  translateOpencodeEvent,
} from "./opencode-session";
import { getOpencodeServer } from "./opencode-manager";

export interface BuildFile {
  path: string;
  content: string;
}

export interface BuildStep {
  step: number;
  sub_task_id?: string;
  title: string;
  description: string;
  acceptance_criteria?: string;
  required_files?: string[];
}

export interface BuildPlan {
  summary?: string;
  steps?: BuildStep[];
  sub_tasks?: BuildStep[];
}

export interface BufferedEvent {
  eventId: number;
  data: Record<string, unknown>;
}

export interface BuildSessionState {
  id: string;
  projectId?: string;
  aborted: boolean;
  files: Map<string, string>;
  plan: BuildPlan;
  userRequest: string;
  userLang: string;
  taskStatuses?: Record<string, string>;
  userConfirmation?: string;
  skillContent?: string;
  provider?: string;
  framework?: string;
  events: BufferedEvent[];
  nextEventId: number;
  done: boolean;
  doneAt?: number;
  sseWriters: Set<(data: string) => void>;
}

export type SseEmit = (data: Record<string, unknown>) => void;

function filesMapToArray(files: Map<string, string>): BuildFile[] {
  return Array.from(files.entries()).map(([path, content]) => ({ path, content }));
}

export async function runBuildSession(
  session: BuildSessionState,
  emit: SseEmit,
): Promise<void> {
  const { userRequest } = session;
  const initialFiles = filesMapToArray(session.files);

  let tmpdir: string | null = null;

  try {
    // 1. Write session files + opencode.json to disk
    tmpdir = await writeSessionTmpdir(session.id, session.files);

    // 2. Create OpenCode client pointed at tmpdir
    const server = getOpencodeServer();
    const client = createClient({ url: server.url, directory: tmpdir });

    // 3. Create OpenCode session
    const ocSession = await client.session.create();

    // 4. Subscribe to events
    const editedFiles = new Set<string>();
    const sessionContext = { editedFiles, started: false };

    // 5. Subscribe to event stream (non-blocking — events arrive while prompt runs)
    const unsubscribe = client.event.subscribe((ocEvent: Record<string, unknown>) => {
      if (session.aborted) return;
      const result = translateOpencodeEvent(ocEvent, emit, sessionContext);
      if (result === "idle") {
        // Will be caught below when promptAsync resolves
      }
    });

    // 6. Send the user request — raw, no pre-built plan
    const prompt = buildOpencodePrompt(userRequest);
    try {
      await client.session.promptAsync(ocSession.id, prompt);
    } finally {
      unsubscribe();
    }

    if (session.aborted) {
      emit({ type: "done" });
      return;
    }

    // 7. Read result files back from disk
    await readSessionTmpdir(tmpdir, session.files);

    // 8. Emit all_complete
    const beforeMap = new Map(initialFiles.map((f) => [f.path, f.content]));
    const finalFiles = filesMapToArray(session.files);
    const changedFiles = finalFiles
      .filter((f) => !beforeMap.has(f.path) || beforeMap.get(f.path) !== f.content)
      .map((f) => f.path);

    emit({
      type: "all_complete",
      changedFiles,
      summary: session.plan.summary ?? userRequest,
      summaryText: "",
    });

    if (session.projectId) {
      storage.updateProjectBuildResult(session.projectId, {
        changedFiles,
        summary: session.plan.summary ?? userRequest,
        completedAt: Date.now(),
      }).catch(() => {});
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "build_error", message });
  } finally {
    // 9. Clean up tmpdir
    if (tmpdir) await cleanupSessionTmpdir(tmpdir);
    emit({ type: "done" });
  }
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/jonathanzhang/Desktop/CodeStart/CodeStart && npx tsc --noEmit --skipLibCheck 2>&1 | grep -v "node_modules"
```

Expected: Errors only from unrelated files, not from `build-orchestrator.ts`. If `@opencode-ai/sdk` types are missing, add `"skipLibCheck": true` to `tsconfig.json` (likely already present).

- [ ] **Step 4: Commit**

```bash
git add server/build-orchestrator.ts
git commit -m "feat: replace runBuildSession agent loop with OpenCode executor"
```

---

## Task 5: Wire OpenCode singleton into `server/index.ts`

**Files:**
- Modify: `server/index.ts`

Start `opencode serve` at server boot, before routes are registered. Graceful shutdown on SIGTERM.

- [ ] **Step 1: Modify `server/index.ts`**

Read the current file first (it's 104 lines). Make these changes:

Add import at the top (after `import { createServer } from "http";`):
```typescript
import { startOpencodeServer } from "./opencode-manager";
```

Inside the `async ()` IIFE, before `await registerRoutes(httpServer, app);` (line 65), add:
```typescript
  // Start OpenCode serve subprocess once — shared across all build sessions
  const opencodeServer = await startOpencodeServer();
  console.log(`[opencode] server ready at ${opencodeServer.url}`);

  process.on("SIGTERM", () => {
    opencodeServer.close();
    process.exit(0);
  });
```

So the IIFE body becomes:
```typescript
(async () => {
  // Start OpenCode serve subprocess once — shared across all build sessions
  const opencodeServer = await startOpencodeServer();
  console.log(`[opencode] server ready at ${opencodeServer.url}`);

  process.on("SIGTERM", () => {
    opencodeServer.close();
    process.exit(0);
  });

  await registerRoutes(httpServer, app);

  // ... rest unchanged
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/jonathanzhang/Desktop/CodeStart/CodeStart && npx tsc --noEmit --skipLibCheck 2>&1 | grep index.ts
```

Expected: no errors for `index.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: start opencode serve singleton at server boot"
```

---

## Task 6: Clean up `server/routes.ts` imports

**Files:**
- Modify: `server/routes.ts`

The routes file imports `EDITOR_AGENT_SYSTEM_PROMPT`, `VERIFIER_AGENT_SYSTEM_PROMPT`, and the agent-loop pieces that are now replaced. Remove them. The manager agent (`/api/manager-chat`) is out of scope for this plan and stays unchanged.

- [ ] **Step 1: Remove editor and verifier prompt imports (lines 19-34 of routes.ts)**

In `server/routes.ts`, find and remove these import blocks:

```typescript
import {
  EDITOR_AGENT_SYSTEM_PROMPT,
  EDITOR_CHAT_SYSTEM_PROMPT,
  buildEditorContextMessage,
  buildEditorChatContextMessage,
} from "./editor-prompt";
```

```typescript
import {
  VERIFIER_AGENT_SYSTEM_PROMPT,
  buildHolisticVerifierMessage,
} from "./verifier-prompt";
```

Keep the `MANAGER_AGENT_SYSTEM_PROMPT` imports, `runAgentLoop`, `buildManagerTools` — the `/api/manager-chat` endpoint still uses them.

- [ ] **Step 2: Type-check to see what else breaks**

```bash
cd /Users/jonathanzhang/Desktop/CodeStart/CodeStart && npx tsc --noEmit --skipLibCheck 2>&1 | grep routes.ts
```

If `EDITOR_CHAT_SYSTEM_PROMPT`, `buildEditorContextMessage`, `buildHolisticVerifierMessage` etc. are still used elsewhere in routes.ts (e.g., `/api/editor-chat`), do NOT remove those imports — only remove the ones that produce "unused import" errors or that are truly only used by the deleted build pipeline.

- [ ] **Step 3: Fix any remaining unused-import errors**

For each error like `'X' is declared but its value is never read`, remove the specific named import from its import block. Keep the whole import if any other named export from that file is still used.

- [ ] **Step 4: Type-check passes cleanly for routes.ts**

```bash
cd /Users/jonathanzhang/Desktop/CodeStart/CodeStart && npx tsc --noEmit --skipLibCheck 2>&1 | grep routes.ts
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "chore: remove unused editor/verifier agent imports from routes.ts"
```

---

## Task 7: Smoke test — end-to-end build session

**Files:** (read-only verification)

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/jonathanzhang/Desktop/CodeStart/CodeStart && npm run dev
```

Watch the console for:
```
[opencode] server ready at http://localhost:XXXXX
```

If it fails with "opencode serve did not become ready within 30 seconds", check:
- `which opencode` works
- `opencode serve` can be run manually without error

- [ ] **Step 2: Open the browser**

Navigate to `http://localhost:5000`. Open browser DevTools → Network tab → filter by `EventSource`.

- [ ] **Step 3: Send a minimal build request via UI**

In the CodeStart UI, start a new project, type a simple request like "Create a React counter app", and press Run.

Watch the Network tab SSE stream. You should see events in this order:
1. `step_starting` — `{ stepNumber: 1, stepTitle: "Building with OpenCode" }`
2. `narration_token` — text from OmO's Prometheus/Hephaestus narration
3. `code_applied` — one event per file written by Hephaestus
4. `all_complete` — `{ changedFiles: [...], summary: "...", summaryText: "" }`
5. `done`

- [ ] **Step 4: Verify files appear in editor**

After build completes, check the file tree in CodeStart. The files written by OpenCode should appear.

- [ ] **Step 5: Confirm no calls to old endpoints**

In DevTools Network tab, confirm no requests to `/api/communicator-chat` or old agent endpoints.

---

## Task 8: Handle `@opencode-ai/sdk` API shape mismatches

**Files:**
- Modify: `server/opencode-session.ts`, `server/build-orchestrator.ts` (as needed)

The `@opencode-ai/sdk` API shape documented in the spec (`client.session.create()`, `client.session.promptAsync()`, `client.event.subscribe()`) is based on the spec design. The actual SDK may have different method names. This task fixes any mismatches found in Task 7.

- [ ] **Step 1: Check actual SDK exports**

```bash
node -e "const sdk = require('@opencode-ai/sdk'); console.log(Object.keys(sdk))"
```

```bash
node -e "
const { createClient } = require('@opencode-ai/sdk');
const c = createClient({ url: 'http://localhost:1', directory: '/tmp' });
console.log('session methods:', Object.keys(c.session || {}));
console.log('event methods:', Object.keys(c.event || {}));
"
```

- [ ] **Step 2: Read the SDK's TypeScript definitions**

```bash
cat node_modules/@opencode-ai/sdk/dist/index.d.ts 2>/dev/null | head -100
# or
find node_modules/@opencode-ai/sdk -name "*.d.ts" | head -5 | xargs head -50
```

- [ ] **Step 3: Update `build-orchestrator.ts` with correct method names**

Based on what Step 1-2 reveals, update the `runBuildSession` body with the actual SDK API. Common variants:
- `client.session.create()` → may be `client.createSession()`
- `client.session.promptAsync()` → may be `client.chat()` or `client.send()`
- `client.event.subscribe()` → may be `client.events()` or SSE stream returned from `promptAsync`

If `promptAsync` returns an async iterable of events (rather than a separate subscription), restructure like:
```typescript
for await (const ocEvent of client.session.chat(ocSession.id, prompt)) {
  if (session.aborted) break;
  translateOpencodeEvent(ocEvent, emit, sessionContext);
}
```

- [ ] **Step 4: Type-check and re-run smoke test**

```bash
cd /Users/jonathanzhang/Desktop/CodeStart/CodeStart && npx tsc --noEmit --skipLibCheck 2>&1 | grep -v node_modules
```

Then re-run the smoke test from Task 7 and confirm events arrive correctly.

- [ ] **Step 5: Commit**

```bash
git add server/build-orchestrator.ts server/opencode-session.ts
git commit -m "fix: adjust opencode-sdk API calls to match actual SDK shape"
```

---

## Task 9: Handle `opencode.json` model env override

**Files:**
- Modify: `server/opencode-session.ts`

The spec requires `OPENCODE_MODEL` env var to override the model. Verify the fallback hierarchy works correctly.

- [ ] **Step 1: Verify the model selection logic in `writeSessionTmpdir`**

The current logic in `opencode-session.ts`:
```typescript
const model = process.env.OPENCODE_MODEL
  ?? (process.env.KIMI_API_KEY ? "moonshot/kimi-k2.5"
    : process.env.MINIMAX_API_KEY ? "minimax/MiniMax-M2.7"
    : "glm/glm-5");
```

This is correct. Verify by checking the `.env` file:
```bash
grep -E "KIMI_API_KEY|MINIMAX_API_KEY|GLM_API_KEY|OPENCODE_MODEL" /Users/jonathanzhang/Desktop/CodeStart/CodeStart/.env 2>/dev/null
```

- [ ] **Step 2: Confirm auth.json includes the right key**

After server starts, check:
```bash
cat ~/.local/share/opencode/auth.json
```

Expected: a JSON object with `"moonshot": { "key": "sk-..." }` (plus any other keys that are set).

- [ ] **Step 3: No code changes needed if keys are set**

If `KIMI_API_KEY` is in `.env`, the model defaults to `moonshot/kimi-k2.5` and auth.json has the key. No changes required.

If `KIMI_API_KEY` is missing, update `.env` to add it and re-test.

---

## Task 10: Final cleanup — remove dead files

**Files:**
- Delete: `server/editor-prompt.ts` (if no longer imported anywhere)
- Delete: `server/verifier-prompt.ts` (if no longer imported anywhere)

Do NOT delete `server/manager-prompt.ts` — the `/api/manager-chat` endpoint still uses it.

- [ ] **Step 1: Check if editor-prompt.ts is still imported**

```bash
grep -r "editor-prompt" /Users/jonathanzhang/Desktop/CodeStart/CodeStart/server/ --include="*.ts" | grep -v "node_modules"
```

If output is empty → safe to delete.

- [ ] **Step 2: Check if verifier-prompt.ts is still imported**

```bash
grep -r "verifier-prompt" /Users/jonathanzhang/Desktop/CodeStart/CodeStart/server/ --include="*.ts" | grep -v "node_modules"
```

If output is empty → safe to delete.

- [ ] **Step 3: Delete unused files**

Only delete files confirmed unused in Steps 1-2:
```bash
# Only if grep returned empty for that file:
rm server/editor-prompt.ts
rm server/verifier-prompt.ts
```

- [ ] **Step 4: Type-check after deletion**

```bash
cd /Users/jonathanzhang/Desktop/CodeStart/CodeStart && npx tsc --noEmit --skipLibCheck 2>&1 | grep -v node_modules
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove editor-prompt and verifier-prompt — replaced by OpenCode"
```

---

## Verification Checklist

After all tasks complete:

1. **Server starts cleanly**: `npm run dev` shows `[opencode] server ready at http://localhost:XXXXX`
2. **Build session works**: Send a request → see `step_starting` → `narration_token` → `code_applied` → `all_complete` → `done` in SSE stream
3. **Files appear in editor**: After build, CodeStart's file tree shows files written by Hephaestus
4. **No old agent calls**: No requests to `/api/communicator-chat` in Network tab
5. **Auth is set**: `cat ~/.local/share/opencode/auth.json` shows `moonshot` key
6. **Model config correct**: `opencode.json` in tmpdir (visible in server logs) contains `"model": "moonshot/kimi-k2.5"`
7. **Rollback**: `git checkout main` returns to old agent pipeline

---

## Notes on `@opencode-ai/sdk` API

The actual SDK API shape must be verified in Task 8. The methods used in Task 4 (`createClient`, `client.session.create`, `client.session.promptAsync`, `client.event.subscribe`) are based on the spec and OpenCode documentation. The SDK may expose a slightly different interface — Task 8 is specifically allocated to handle this mismatch.

If the SDK doesn't support a `directory` option on `createClient`, the directory is passed via the `x-opencode-directory` HTTP header instead:
```typescript
const client = createClient({ url: server.url });
// Then pass directory per-request:
await client.session.create({ headers: { "x-opencode-directory": tmpdir } });
```
