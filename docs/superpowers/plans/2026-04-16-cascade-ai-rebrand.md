# Cascade AI Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename all product identity from "CodeStart" to "Cascade AI" across the full stack, replacing the logo with a theme-adaptive SVG of three cascading bars.

**Architecture:** Create a new inline SVG React component (`CascadeLogo`) using `currentColor` for automatic light/dark adaptation; rename `CodestartLoader` to `CascadeLoader`; do a systematic find-and-replace of all string identifiers (localStorage keys, API endpoints, virtual filenames, system prompts, internal prefixes) across client and server.

**Tech Stack:** React/TypeScript (client), Express/TypeScript (server), Zustand (state), Vite (build), Drizzle/Postgres (DB — no schema changes needed)

---

## File Map

| Action | File |
|--------|------|
| Create | `client/src/assets/CascadeLogo.tsx` |
| Create | `client/public/favicon.svg` |
| Rename + edit | `client/src/components/ide/chat/CodestartLoader.tsx` → `CascadeLoader.tsx` |
| Modify | `client/index.html` |
| Modify | `client/src/pages/dashboard.tsx` |
| Modify | `client/src/stores/ide-store.ts` |
| Modify | `client/src/stores/project-store.ts` |
| Modify | `client/src/components/theme-provider.tsx` |
| Modify | `client/src/components/ide/chat/chat-utils.tsx` |
| Modify | `client/src/components/ide/chat/hooks/useManagerStream.ts` |
| Modify | `client/src/components/ide/chat/hooks/useBuildStream.ts` |
| Modify | `client/src/components/ide/preview-panel.tsx` |
| Modify | `client/src/lib/preview-adapters.ts` |
| Modify | `server/manager-prompt.ts` |
| Modify | `server/editor-prompt.ts` |
| Modify | `server/communicator-prompt.ts` |
| Modify | `server/routes.ts` |
| Modify | `server/build-orchestrator.ts` |
| Modify | `server/rn-web-compiler.ts` |
| Modify | `server/flutter-compiler.ts` |
| Modify | `CLAUDE.md` |

---

### Task 1: Create CascadeLogo SVG component and favicon

**Files:**
- Create: `client/src/assets/CascadeLogo.tsx`
- Create: `client/public/favicon.svg`

- [ ] **Step 1: Create the React SVG component**

Create `client/src/assets/CascadeLogo.tsx`:

```tsx
import React from "react";

interface CascadeLogoProps {
  className?: string;
  width?: number;
  height?: number;
}

export function CascadeLogo({ className, width = 40, height = 40 }: CascadeLogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 800 800"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="175" y="155" width="56" height="260" fill="currentColor" />
      <rect x="355" y="275" width="56" height="245" fill="currentColor" />
      <rect x="540" y="380" width="65" height="255" fill="currentColor" />
    </svg>
  );
}
```

- [ ] **Step 2: Create the SVG favicon**

Create `client/public/favicon.svg`:

```svg
<svg viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="175" y="155" width="56" height="260" fill="#111111"/>
  <rect x="355" y="275" width="56" height="245" fill="#111111"/>
  <rect x="540" y="380" width="65" height="255" fill="#111111"/>
</svg>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/assets/CascadeLogo.tsx client/public/favicon.svg
git commit -m "feat: add CascadeLogo SVG component and favicon"
```

---

### Task 2: Update HTML metadata and dashboard header

**Files:**
- Modify: `client/index.html`
- Modify: `client/src/pages/dashboard.tsx`

- [ ] **Step 1: Update index.html**

In `client/index.html`, make these replacements:

```html
<!-- line 6: change title -->
<title>Cascade AI — Build Apps with AI</title>

<!-- line 7: update description meta -->
<meta name="description" content="A browser-based IDE with a built-in AI coding agent. Turn your ideas into working code through natural conversation." />

<!-- line 8: update og:title -->
<meta property="og:title" content="Cascade AI — Build Apps with AI" />

<!-- line 9: og:description unchanged — no CodeStart reference -->

<!-- line 12: update favicon to SVG -->
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

Remove the `og:image` line that references `/favicon.png` (or update it to `/favicon.svg`).

- [ ] **Step 2: Update dashboard header**

In `client/src/pages/dashboard.tsx`:

Remove the PNG import (line 33):
```tsx
// DELETE this line:
import logoSrc from "@assets/CodeStart_Logo_EN_v1_1773815402242.png";
```

Add the new import at the top of the imports section:
```tsx
import { CascadeLogo } from "@/assets/CascadeLogo";
```

Find the `<img>` tag using `logoSrc` (around line 146–147) and replace it:
```tsx
// BEFORE:
<img src={logoSrc} alt="CodeStart" className="h-9 w-36" />

// AFTER:
<CascadeLogo width={36} height={36} />
```

- [ ] **Step 3: Run the dev server and verify visually**

```bash
npm run dev
```

Open http://localhost:5000 — confirm:
- Browser tab title reads "Cascade AI — Build Apps with AI"
- Browser tab favicon shows three cascading bars
- Dashboard header shows the SVG logo (black in light mode)

- [ ] **Step 4: Commit**

```bash
git add client/index.html client/src/pages/dashboard.tsx
git commit -m "feat: update HTML metadata and dashboard logo to Cascade AI"
```

---

### Task 3: Rename CodestartLoader to CascadeLoader

**Files:**
- Rename + edit: `client/src/components/ide/chat/CodestartLoader.tsx` → `CascadeLoader.tsx`
- Find all imports to update

- [ ] **Step 1: Find all files that import CodestartLoader**

```bash
grep -r "CodestartLoader" client/src --include="*.tsx" --include="*.ts" -l
```

Note every file listed — you'll update each one in Step 3.

- [ ] **Step 2: Create CascadeLoader.tsx with updated internals**

Create `client/src/components/ide/chat/CascadeLoader.tsx` with the same content as `CodestartLoader.tsx`, but:
- Rename the component function: `CodestartLoader` → `CascadeLoader`
- Rename CSS keyframe: `cs-drop` → `ca-drop`
- Rename CSS classes: `cs-bar` → `ca-bar`, `cs-bar-l` → `ca-bar-l`, `cs-bar-m` → `ca-bar-m`, `cs-bar-r` → `ca-bar-r`
- Update the comment at the top: `CascadeLoader — branded loading animation matching the Cascade AI logo.`

Example of the keyframe rename (the exact animation values stay the same — just rename the identifier):
```tsx
// BEFORE:
@keyframes cs-drop { ... }
.cs-bar { animation: cs-drop ... }

// AFTER:
@keyframes ca-drop { ... }
.ca-bar { animation: ca-drop ... }
```

- [ ] **Step 3: Update all import sites**

For each file found in Step 1, change:
```tsx
// BEFORE:
import { CodestartLoader } from "./CodestartLoader";
// or relative variant

// AFTER:
import { CascadeLoader } from "./CascadeLoader";
```

And at every usage site change `<CodestartLoader` → `<CascadeLoader`.

- [ ] **Step 4: Delete the old file**

```bash
git rm client/src/components/ide/chat/CodestartLoader.tsx
```

- [ ] **Step 5: TypeScript check**

```bash
npm run check
```

Expected: no errors related to CodestartLoader or CascadeLoader.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: rename CodestartLoader to CascadeLoader"
```

---

### Task 4: Update localStorage keys

**Files:**
- Modify: `client/src/stores/ide-store.ts`
- Modify: `client/src/stores/project-store.ts`
- Modify: `client/src/components/theme-provider.tsx`

- [ ] **Step 1: Update ide-store.ts**

In `client/src/stores/ide-store.ts`, replace all occurrences:

| Old | New |
|-----|-----|
| `"codestart-project-${projectId}"` | `"cascade-project-${projectId}"` |
| `"codestart-checkpoints-${projectId}"` | `"cascade-checkpoints-${projectId}"` |
| `"codestart-selected-provider"` | `"cascade-selected-provider"` |

Run to verify no old keys remain:
```bash
grep -n "codestart-" client/src/stores/ide-store.ts
```
Expected: no output.

- [ ] **Step 2: Update project-store.ts**

In `client/src/stores/project-store.ts`, replace all occurrences:

| Old | New |
|-----|-----|
| `"codestart-migrated"` | `"cascade-migrated"` |
| `"codestart-ide-state"` | `"cascade-ide-state"` |
| `"codestart-projects"` | `"cascade-projects"` |

Run to verify:
```bash
grep -n "codestart-" client/src/stores/project-store.ts
```
Expected: no output.

- [ ] **Step 3: Update theme-provider.tsx**

In `client/src/components/theme-provider.tsx`, find around line 18:
```tsx
// BEFORE:
const STORAGE_KEY = "codestart-theme-id";

// AFTER:
const STORAGE_KEY = "cascade-theme-id";
```

- [ ] **Step 4: Verify no codestart- keys remain in client stores**

```bash
grep -rn "codestart-" client/src/stores/ client/src/components/theme-provider.tsx
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add client/src/stores/ide-store.ts client/src/stores/project-store.ts client/src/components/theme-provider.tsx
git commit -m "feat: rename localStorage keys from codestart- to cascade-"
```

---

### Task 5: Rename virtual project file codestart.md → cascade.md

**Files:**
- Modify: `server/routes.ts`
- Modify: `client/src/stores/ide-store.ts`
- Modify: `client/src/stores/project-store.ts`
- Modify: `client/src/components/ide/chat/hooks/useManagerStream.ts`
- Modify: `client/src/components/ide/chat/hooks/useBuildStream.ts`
- Modify: `client/src/components/ide/chat/chat-utils.tsx`

- [ ] **Step 1: Update server/routes.ts**

Find the default file list (~line 1802) — change:
```ts
// BEFORE:
"/project/codestart.md"

// AFTER:
"/project/cascade.md"
```

Also find ~line 1591 where the system prompt mentions `codestart.md`:
```ts
// BEFORE: (in the generate-codestart endpoint system prompt)
"codestart.md file"

// AFTER:
"cascade.md file"
```

- [ ] **Step 2: Update ide-store.ts file creation**

In `client/src/stores/ide-store.ts`, find where `/project/codestart.md` is created (around lines 395–398):
```ts
// BEFORE:
.updateFileContent("/project/codestart.md", ...)

// AFTER:
.updateFileContent("/project/cascade.md", ...)
```

- [ ] **Step 3: Update project-store.ts file creation**

In `client/src/stores/project-store.ts`, find where `/project/codestart.md` is referenced (around lines 67–70) and change to `/project/cascade.md`.

- [ ] **Step 4: Update stream hooks filters**

In `client/src/components/ide/chat/hooks/useManagerStream.ts` (~line 376):
```ts
// BEFORE:
.filter(f => f.path !== "/project/codestart.md")

// AFTER:
.filter(f => f.path !== "/project/cascade.md")
```

In `client/src/components/ide/chat/hooks/useBuildStream.ts` (~line 395):
```ts
// BEFORE:
.filter(f => f.path !== "/project/codestart.md")

// AFTER:
.filter(f => f.path !== "/project/cascade.md")
```

- [ ] **Step 5: Update chat-utils.tsx**

In `client/src/components/ide/chat/chat-utils.tsx`:

Rename the exported function (~line 546):
```tsx
// BEFORE:
export function generateCodestart(params: {...}) {

// AFTER:
export function generateCascade(params: {...}) {
```

Update the fetch call (~line 551):
```tsx
// BEFORE:
fetch("/api/generate-codestart", ...)

// AFTER:
fetch("/api/generate-cascade", ...)
```

Update the file update call (~line 568):
```tsx
// BEFORE:
.updateFileContent("/project/codestart.md", d.content)

// AFTER:
.updateFileContent("/project/cascade.md", d.content)
```

- [ ] **Step 6: Find and update all callers of generateCodestart**

```bash
grep -rn "generateCodestart" client/src --include="*.tsx" --include="*.ts"
```

For each call site found, rename `generateCodestart` → `generateCascade`.

- [ ] **Step 7: TypeScript check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: rename codestart.md to cascade.md throughout"
```

---

### Task 6: Rename the API endpoint /api/generate-codestart

**Files:**
- Modify: `server/routes.ts`

- [ ] **Step 1: Rename the route handler in server/routes.ts**

Find ~line 1572:
```ts
// BEFORE:
app.post("/api/generate-codestart", ...)

// AFTER:
app.post("/api/generate-cascade", ...)
```

- [ ] **Step 2: Verify no other references remain**

```bash
grep -rn "generate-codestart" server/ client/
```
Expected: no output (chat-utils.tsx was already updated in Task 5).

- [ ] **Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "feat: rename API endpoint to /api/generate-cascade"
```

---

### Task 7: Update AI agent system prompts

**Files:**
- Modify: `server/manager-prompt.ts`
- Modify: `server/editor-prompt.ts`
- Modify: `server/communicator-prompt.ts`

- [ ] **Step 1: Update manager-prompt.ts**

In `server/manager-prompt.ts` line 1:
```ts
// BEFORE:
You are a professional project planning assistant inside CodeStart IDE.

// AFTER:
You are a professional project planning assistant inside Cascade AI.
```

- [ ] **Step 2: Update editor-prompt.ts**

In `server/editor-prompt.ts` line 41:
```ts
// BEFORE:
You are a professional full-stack development engineer inside CodeStart IDE.

// AFTER:
You are a professional full-stack development engineer inside Cascade AI.
```

- [ ] **Step 3: Update communicator-prompt.ts**

In `server/communicator-prompt.ts` lines 1 and 6:
```ts
// BEFORE (line 1):
You are the Communicator Agent inside CodeStart IDE

// AFTER:
You are the Communicator Agent inside Cascade AI

// BEFORE (line 6):
You are part of the CodeStart system.

// AFTER:
You are part of the Cascade AI system.
```

- [ ] **Step 4: Verify no CodeStart references remain in prompts**

```bash
grep -n "CodeStart" server/manager-prompt.ts server/editor-prompt.ts server/communicator-prompt.ts
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add server/manager-prompt.ts server/editor-prompt.ts server/communicator-prompt.ts
git commit -m "feat: update AI agent system prompts to Cascade AI"
```

---

### Task 8: Update internal console message type and preview fallback

**Files:**
- Modify: `client/src/components/ide/preview-panel.tsx`
- Modify: `server/rn-web-compiler.ts`
- Modify: `client/src/lib/preview-adapters.ts`

- [ ] **Step 1: Update preview-panel.tsx**

In `client/src/components/ide/preview-panel.tsx`, replace all occurrences of `'__codestart_console__'` with `'__cascade_console__'` (lines 187, 197, 217):

```bash
grep -n "__codestart_console__" client/src/components/ide/preview-panel.tsx
```

For each occurrence:
```ts
// BEFORE:
type: '__codestart_console__'

// AFTER:
type: '__cascade_console__'
```

- [ ] **Step 2: Update rn-web-compiler.ts**

In `server/rn-web-compiler.ts`, replace all occurrences of `'__codestart_console__'` with `'__cascade_console__'` (lines 298, 308, 316):

```bash
grep -n "__codestart_console__" server/rn-web-compiler.ts
```

Replace each occurrence:
```ts
// BEFORE:
type: '__codestart_console__'

// AFTER:
type: '__cascade_console__'
```

- [ ] **Step 3: Update preview-adapters.ts**

In `client/src/lib/preview-adapters.ts` line 130:
```ts
// BEFORE:
params.set("name", name || "CodeStart Preview");

// AFTER:
params.set("name", name || "Cascade AI Preview");
```

- [ ] **Step 4: Verify no old type remains**

```bash
grep -rn "__codestart_console__" client/ server/
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ide/preview-panel.tsx server/rn-web-compiler.ts client/src/lib/preview-adapters.ts
git commit -m "feat: rename __codestart_console__ to __cascade_console__"
```

---

### Task 9: Update server-side internal identifiers

**Files:**
- Modify: `server/build-orchestrator.ts`
- Modify: `server/routes.ts`
- Modify: `server/flutter-compiler.ts`

- [ ] **Step 1: Update build-orchestrator.ts session path**

In `server/build-orchestrator.ts` line 214:
```ts
// BEFORE:
`/tmp/codestart-sessions/${session.id}`

// AFTER:
`/tmp/cascade-sessions/${session.id}`
```

- [ ] **Step 2: Update routes.ts internal identifiers**

In `server/routes.ts`:

~line 1974 — temp dir prefix:
```ts
// BEFORE:
`codestart_${tmpId}`

// AFTER:
`cascade_${tmpId}`
```

~line 1992 — Go module name:
```ts
// BEFORE:
module codestart_run

// AFTER:
module cascade_run
```

- [ ] **Step 3: Update flutter-compiler.ts**

In `server/flutter-compiler.ts` lines 321–322:
```ts
// BEFORE:
name: codestart_preview
description: CodeStart Flutter Preview

// AFTER:
name: cascade_preview
description: Cascade AI Flutter Preview
```

- [ ] **Step 4: Verify no codestart_ identifiers remain in server**

```bash
grep -rn "codestart" server/ --include="*.ts"
```
Expected: no output (test files are addressed in next task).

- [ ] **Step 5: Commit**

```bash
git add server/build-orchestrator.ts server/routes.ts server/flutter-compiler.ts
git commit -m "feat: rename internal server identifiers to cascade"
```

---

### Task 10: Update test files and CLAUDE.md

**Files:**
- Modify: `server/__tests__/file-materialization.test.ts` (or wherever the test lives)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update test temp dir prefix**

Find the test file:
```bash
grep -rn "codestart-test-" server/
```

In that file, replace `codestart-test-` with `cascade-test-` in every occurrence.

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md` line 42, update the localStorage key reference:
```md
<!-- BEFORE: -->
localStorage under `codestart-project-${projectId}`

<!-- AFTER: -->
localStorage under `cascade-project-${projectId}`
```

- [ ] **Step 3: Final sweep — verify no CodeStart or codestart references remain**

```bash
grep -rn "CodeStart\|codestart" client/src server/ --include="*.ts" --include="*.tsx" client/index.html CLAUDE.md
```

Review any remaining hits. Anything in `dist/` or `attached_assets/` can be ignored. Fix any unexpected hits before committing.

- [ ] **Step 4: TypeScript check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Cascade AI rebrand — update tests and CLAUDE.md"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npm run dev` — server starts without errors
- [ ] Browser tab title: "Cascade AI — Build Apps with AI"
- [ ] Browser tab favicon: three cascading bars (SVG)
- [ ] Dashboard header: SVG logo visible in black (light mode)
- [ ] Toggle to dark mode — logo turns white
- [ ] Create a new project — check DevTools → Application → localStorage: all keys start with `cascade-`
- [ ] In a new project, check the file tree — `cascade.md` exists (not `codestart.md`)
- [ ] Start a build step — open DevTools console and verify postMessage events use `__cascade_console__`
- [ ] Open the Manager chat and inspect the network request — system prompt should say "Cascade AI", not "CodeStart IDE"
- [ ] `npm run build` — production build succeeds without errors
