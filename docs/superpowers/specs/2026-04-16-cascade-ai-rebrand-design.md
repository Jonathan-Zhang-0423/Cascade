# Cascade AI Rebrand — Design Spec

## Context

The product is being renamed from "CodeStart" to "Cascade AI". The new logo is three black vertical bars cascading diagonally (top-left to bottom-right), each shorter and offset lower than the previous — evoking a waterfall/cascade. The SVG uses `currentColor` so it renders black in light mode and white in dark mode with no extra CSS.

All product identity references must be updated: UI text, HTML metadata, AI agent system prompts, localStorage keys, API endpoints, file names, and internal identifiers.

---

## SVG Logo

The canonical SVG (viewBox 0 0 800 800), measured from the provided reference image:

```svg
<svg viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="175" y="155" width="56" height="260" fill="currentColor"/>
  <rect x="355" y="275" width="56" height="245" fill="currentColor"/>
  <rect x="540" y="380" width="65" height="255" fill="currentColor"/>
</svg>
```

- No background, no hardcoded color — `fill="currentColor"` only
- Save as `client/src/assets/cascade-logo.svg` (inline React component)
- Replace `attached_assets/CodeStart_Logo_EN_v1_*.png` usage in dashboard
- Replace `client/public/favicon.png` with an SVG favicon

---

## Scope of Changes

### 1. SVG asset
- Create `client/src/assets/CascadeLogo.tsx` — React component wrapping the SVG inline
- Create `client/public/favicon.svg` — standalone SVG favicon (same viewBox, black fill hardcoded for favicon use)

### 2. HTML metadata (`client/index.html`)
- `<title>` → `Cascade AI — Build Apps with AI`
- `<meta name="description">` → keep description, remove "CodeStart"
- `og:title` → `Cascade AI — Build Apps with AI`
- `<link rel="icon">` → point to `/favicon.svg`

### 3. Dashboard header (`client/src/pages/dashboard.tsx`)
- Replace `<img src={logoSrc}>` with `<CascadeLogo>` component
- Remove the PNG import

### 4. AI agent system prompts
- `server/manager-prompt.ts` line 1: `CodeStart IDE` → `Cascade AI`
- `server/editor-prompt.ts` line 41: `CodeStart IDE` → `Cascade AI`
- `server/communicator-prompt.ts` lines 1, 6: `CodeStart IDE` / `CodeStart system` → `Cascade AI`

### 5. localStorage keys
These are user-facing storage keys; changing them will clear existing user data. Since this is a rename, that is acceptable.
- `codestart-project-${id}` → `cascade-project-${id}`
- `codestart-checkpoints-${id}` → `cascade-checkpoints-${id}`
- `codestart-selected-provider` → `cascade-selected-provider`
- `codestart-migrated` → `cascade-migrated`
- `codestart-ide-state` → `cascade-ide-state`
- `codestart-projects` → `cascade-projects`
- `codestart-theme-id` (in `theme-provider.tsx`) → `cascade-theme-id`

Files: `client/src/stores/ide-store.ts`, `client/src/stores/project-store.ts`, `client/src/components/theme-provider.tsx`

### 6. API endpoint & project documentation file
- `/api/generate-codestart` → `/api/generate-cascade` (`server/routes.ts` ~line 1572)
- Virtual project file `/project/codestart.md` → `/project/cascade.md`
  - `server/routes.ts` ~line 1802 (default file list)
  - `client/src/stores/ide-store.ts` (file creation)
  - `client/src/stores/project-store.ts` (file creation)
  - `client/src/components/ide/chat/hooks/useManagerStream.ts` ~line 376 (filter)
  - `client/src/components/ide/chat/hooks/useBuildStream.ts` ~line 395 (filter)
  - `client/src/components/ide/chat/chat-utils.tsx` ~line 546 (`generateCodestart` fn → `generateCascade`)

### 7. CodestartLoader component
- Rename `CodestartLoader.tsx` → `CascadeLoader.tsx`
- Rename component function `CodestartLoader` → `CascadeLoader`
- Update all imports (find all `import.*CodestartLoader`)
- CSS animation keyframes: rename `cs-drop` → `ca-drop`, classes `cs-bar*` → `ca-bar*`

### 8. Internal identifiers
- `__codestart_console__` postMessage type → `__cascade_console__`
  - `client/src/components/ide/preview-panel.tsx` lines 187, 197, 217
  - `server/rn-web-compiler.ts` lines 298, 308, 316
- Temp dir prefix `/tmp/codestart-sessions/` → `/tmp/cascade-sessions/`
  - `server/build-orchestrator.ts` line 214
- Flutter pubspec: `name: codestart_preview` → `cascade_preview`, description → `Cascade AI Flutter Preview`
  - `server/flutter-compiler.ts` line 321–322
- Go module `codestart_run` → `cascade_run`
  - `server/routes.ts` line 1992
- Temp dir prefix `codestart_${tmpId}` → `cascade_${tmpId}`
  - `server/routes.ts` line 1974
- Test temp dir prefix `codestart-test-` → `cascade-test-`
  - `server/tests/file-materialization.test.ts`
- Preview fallback name `"CodeStart Preview"` → `"Cascade AI Preview"`
  - `client/src/lib/preview-adapters.ts` line 130

### 9. Documentation files (non-breaking, informational)
- `CLAUDE.md` line 42: update localStorage key reference
- `Gameplan.md` heading
- `project_overview.md`
- Existing spec/plan docs under `docs/` — leave as historical record (no change needed)

---

## What NOT to Change

- `package.json` `"name"` field (`"rest-express"`) — this is not user-facing
- Any file in `dist/` — regenerated on build
- The PNG assets in `attached_assets/` — keep as archive, just stop referencing them

---

## Verification

1. `npm run dev` — app loads, title shows "Cascade AI", logo renders in header
2. Light/dark theme toggle — logo switches black ↔ white
3. Favicon shows in browser tab (SVG)
4. Create a new project — `cascade.md` is created (not `codestart.md`)
5. Open DevTools → Application → localStorage: all keys use `cascade-` prefix
6. Start a build — console messages use `__cascade_console__` type (check DevTools network/console)
7. AI agent chat — system prompts no longer mention "CodeStart"
