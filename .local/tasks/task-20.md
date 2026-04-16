---
title: Fix syntax highlighting in Coding Notebook
---
# Fix Notebook Syntax Highlighting

## What & Why

Syntax highlighting in My Coding Notebook code blocks stopped working due to a two-layer bug:

**Layer 1 (regression from previous session):** `prism.ts` was changed to use static `import` statements for all Prism language grammars. Static ESM imports are hoisted and run *before* any module body code. This means `window.Prism = Prism` (which the Prism component IIFEs rely on to register themselves) is set *after* the component files have already run — so every grammar file receives `undefined` instead of the Prism instance. No languages ever register, and all code blocks render as plain unstyled text.

**Layer 2 (pre-existing timing issue now exposed):** Even after reverting to async imports, the `SyntaxHighlightedCode` component computes the highlighted HTML *synchronously at render time*. Because the notebook panel is now always mounted (cached content renders instantly), `SyntaxHighlightedCode` can render before the async language files have finished loading, resulting in plain text that never updates.

## Done looks like

- Code blocks in My Coding Notebook show colored syntax highlighting for CSS, HTML, JavaScript, Python, and all supported languages
- Highlighting appears as soon as the notebook content renders (or within a brief moment on first load)
- No regression to the plain-text fallback

## Out of scope

- Changing the Prism theme or color scheme
- Adding new language support beyond what is already imported

## Tasks

1. **Revert prism.ts to async dynamic imports** — Restore the original async `loadPrismLanguages()` pattern, keeping `window.Prism = Prism` in the module body (before the async call) so it is set synchronously before any component IIFE runs. Export a `prismReadyPromise` from the module.

2. **Make SyntaxHighlightedCode reactive to Prism load state** — Change the component to use `useState` (initially holding escaped plain text) and `useEffect` (waiting on `prismReadyPromise`, then computing and setting the highlighted HTML). This ensures cached notebooks that render instantly will still receive highlighting once languages finish loading.

## Relevant files

- `client/src/lib/prism.ts`
- `client/src/components/ide/notebook-panel.tsx:30-90`