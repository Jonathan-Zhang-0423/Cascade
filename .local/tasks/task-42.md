---
title: EN / ZH language toggle
---
# EN / ZH Language Toggle

## What & Why
Add a compact EN | 中 toggle to the app header so users can switch the entire UI between English and Chinese. Default is Chinese. The chosen language is persisted in localStorage so it survives page refreshes and new sessions.

This is a UI-language toggle only — the AI agents already auto-detect the human's writing language from their messages and respond accordingly, so no AI prompt changes are needed.

## Done looks like
- A small `EN | 中` pill/button appears in the top-right header on both the Dashboard and the IDE Navbar, next to the theme selector
- Clicking it instantly switches all static UI labels, button text, placeholder text, dialog copy, tooltips, and section headings between English and Chinese
- The selection is remembered across page refreshes (localStorage key `codestart-lang`)
- Default language on first visit is Chinese (中)
- AI agent messages and project content are NOT translated — only the application shell UI

## Out of scope
- Any third-party i18n library (react-i18next, etc.) — a lightweight custom store + dictionary is sufficient
- Translating AI-generated notebook content or chat messages
- Right-to-left layout support
- More than two languages

## Tasks

1. **Language store** — Create a Zustand store (`client/src/stores/language-store.ts`) with `lang: "zh" | "en"`, a `setLang` action, and localStorage persistence under key `codestart-lang`. Default to `"zh"`.

2. **i18n dictionary** — Create `client/src/lib/i18n.ts` exporting a typed `t(key, lang)` helper (or a `useT()` hook) backed by a flat two-language dictionary covering every hardcoded string in the app shell: dashboard, navbar, file-tree context menu, tools dock, code editor empty state, preview panel, console panel, and notebook panel UI labels.

3. **Toggle button component** — Create a small reusable `<LangToggle />` component that reads from the language store and renders an `EN | 中` pill. Add it to the Dashboard header (next to the theme selector) and the IDE Navbar (between the theme selector and Run button).

4. **Wire all components** — Replace every hardcoded English/Chinese string in the following files with `t(key, lang)` calls using the dictionary from step 2. The existing `planCardStrings` in `chat-panel.tsx` should be connected to the global lang store rather than using local auto-detection for the UI shell strings (AI plan step labels, thinking/building badges, etc. that the chat panel already has both translations for). Files: `dashboard.tsx`, `navbar.tsx`, `file-tree.tsx`, `tools-dock.tsx`, `notebook-panel.tsx`, `console-panel.tsx`, `preview-panel.tsx`, `chat-panel.tsx` (shell strings only).

## Relevant files
- `client/src/stores/ide-store.ts`
- `client/src/components/theme-provider.tsx`
- `client/src/lib/themes.ts`
- `client/src/pages/dashboard.tsx`
- `client/src/components/ide/navbar.tsx`
- `client/src/components/ide/file-tree.tsx`
- `client/src/components/ide/tools-dock.tsx`
- `client/src/components/ide/notebook-panel.tsx`
- `client/src/components/ide/console-panel.tsx`
- `client/src/components/ide/preview-panel.tsx`
- `client/src/components/ide/chat-panel.tsx:1-120`