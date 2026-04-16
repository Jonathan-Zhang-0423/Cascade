---
title: Fix mind map fullscreen mode and section formatting
---
# Fix Mind Map Fullscreen & Section Format

## What & Why
Two issues in the My Coding Notebook page:

1. **Fullscreen mode is broken.** Clicking the Maximize button doesn't properly expand the mind map to cover the screen. Three bugs are responsible:
   - The CSS class combination (`fixed inset-0 m-4 w-[calc(100%-2rem)] h-[calc(100%-2rem)]`) is over-constrained — all four insets + explicit width/height + margin at once causes browsers to drop the margins, placing the element at (0,0) with no gap.
   - Ancestor elements in the IDE panel layout likely have CSS `transform` properties (common for animated panels), which traps `position: fixed` relative to the ancestor instead of the viewport.
   - The transform-recalculation `useEffect` reads container dimensions immediately when `isFullscreen` changes, before the browser has finished laying out the new fixed element.

2. **思维导图 section has extra box styling** that doesn't match 项目总览, File Breakdowns, and Learning Tips, which all use plain `<section>` wrappers with no outer border/background.

## Done looks like
- Clicking the Maximize2 button expands the mind map to fill the entire browser window with ~1rem margin on all sides, rendered on top of all other content regardless of ancestor transforms
- The mind map SVG automatically rescales to fit the fullscreen container when it opens
- Pan, zoom, node hover/click, and the X close button all work correctly in fullscreen mode
- The 思维导图 section heading and spacing visually matches the other notebook sections (plain section tag, no outer card box, `mb-3` on h2)
- Zero TypeScript errors

## Out of scope
- Changes to pan/zoom behavior itself
- Changes to node layout algorithm

## Tasks
1. **Fix fullscreen overlay using React Portal** — Replace the CSS-based fullscreen approach with `ReactDOM.createPortal()` rendering the mind map canvas into `document.body`. The portal div should use `fixed inset-4 z-[9999]` (no conflicting width/height). Use `requestAnimationFrame` in the transform-recalculate effect so dimensions are read after browser layout settles.

2. **Fix section formatting** — Remove the `rounded-xl border border-border bg-card p-5` className from the 思维导图 `<section>` wrapper and change its `<h2>` margin from `mb-4` to `mb-3` to match all other notebook sections.

## Relevant files
- `client/src/components/ide/mind-map.tsx:391-405`
- `client/src/components/ide/notebook-panel.tsx:496-507`