# Fix Notebook Syntax Highlighting (Iteration 2)

## What & Why

Syntax highlighting in My Coding Notebook code blocks still isn't working after the async-import revert. Deep investigation revealed:

1. Prism's component files (e.g. `prism-css.js`) use an IIFE pattern `(function(Prism2){...})(Prism)` where `Prism` is a bare global reference. Vite's esbuild pre-bundling preserves this global reference (confirmed by inspecting `node_modules/.vite/deps/prismjs_components_prism-css.js`).

2. The Vite dep cache was last rebuilt at 03:32 UTC (before the static→dynamic import change). This stale cache could be causing the issue.

3. Even if the cache is cleared, Prism's reliance on `window.Prism` as a global is fragile in Vite's ESM-served dev environment where modules are isolated.

## Done looks like

- Code blocks in My Coding Notebook show colored syntax highlighting for CSS, HTML, JavaScript, Python, and all other supported languages
- The fix is robust and doesn't depend on fragile global variable wiring
- No regressions to the plain-text fallback

## Out of scope

- Changing the visual theme or color scheme of code blocks
- Adding new language support beyond what's currently imported

## Tasks

1. **Clear Vite dep cache and test** — Delete `node_modules/.vite`, restart dev server, check if syntax highlighting now works. If it does, stop here.

2. **If still broken: Replace Prism with highlight.js** — Install `highlight.js`, rewrite `prism.ts` to use `hljs` with synchronous `registerLanguage()` calls (proper ESM, no global dependency), update `SyntaxHighlightedCode` to call `hljs.highlight()`, switch the CSS theme import to a highlight.js theme, and remove the `prismjs` dependency. This completely sidesteps the Prism/Vite IIFE compatibility issue.

## Relevant files

- `client/src/lib/prism.ts`
- `client/src/components/ide/notebook-panel.tsx:49-101`
