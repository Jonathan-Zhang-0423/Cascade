---
title: Fix rn-expo project creation overwriting template files with web files
---
# Fix rn-expo project creation overwriting template files with web files

## What & Why
When creating a React Native (Expo) project, the server correctly generates framework-specific template files (App.tsx, app.json, package.json, etc.). However, the client's `createProject()` in `project-store.ts` immediately sends a `PUT /api/projects/${id}/files` with hardcoded `BLANK_FILES` (index.html, style.css, app.js) for ALL frameworks, overwriting the correct template files. This causes Expo Snack to show "Invalid files no entry point found" because it can't find App.tsx, and the AI gets confused seeing web files for a React Native project. This also affects SwiftUI, Kotlin, and Flutter projects.

## Done looks like
- Creating an rn-expo project shows proper React Native files (App.tsx, app.json, etc.) in the editor and Expo Snack preview works
- No "Invalid files no entry point found" error in the Expo Snack preview
- The editor opens the correct entry file for each framework (App.tsx for rn-expo, ContentView.swift for swiftui, etc.)
- Existing broken rn-expo projects (with web files) are repaired when opened

## Out of scope
- Changing the server-side template definitions
- Modifying the Expo Snack URL generation or preview rendering
- Manager/build session reconnection (fixed in Tasks #134, #135)

## Tasks

1. **Stop client from overwriting server template files** — In `project-store.ts` `createProject()`, skip the `PUT /api/projects/${id}/files` call with BLANK_FILES for non-web frameworks. The server already creates the correct template files via `getTemplateFiles(framework)` in the POST handler. Only web projects should send BLANK_FILES (or skip for all since server handles web templates too).

2. **Make local state initialization framework-aware** — The `getDefaultProjectState()` always uses `BLANK_FILES` and opens `index.html`. For non-web frameworks, either use a minimal placeholder or empty files, and set the correct default open/active file path (`App.tsx` for rn-expo, `ContentView.swift` for swiftui, etc.) using `getMainEntryFile(framework)` from `preview-adapters.ts`.

3. **Fix loadProject file selection for non-web frameworks** — In `ide-store.ts` `loadProject()`, the file selection logic (line 739) always prioritizes `.html` files: `allPaths.find(p => p.endsWith(".html"))`. For non-web frameworks, it should use `getMainEntryFile(framework)` to find the correct entry file. This requires knowing the project's framework when loading — check the project store.

4. **Repair existing broken rn-expo projects** — Add a repair check: when loading a project via `loadProject`, if the project is `rn-expo` but the server files only contain web files (no App.tsx), trigger re-initialization of template files on the server side by calling the existing template endpoint or a new repair endpoint.

## Relevant files
- `client/src/stores/project-store.ts:211-247`
- `client/src/stores/project-store.ts:29-90`
- `client/src/stores/ide-store.ts:639-753`
- `client/src/lib/preview-adapters.ts:53-67`
- `server/routes.ts:1681-1716`
- `server/templates/index.ts`
- `server/templates/rn-expo-template.ts`