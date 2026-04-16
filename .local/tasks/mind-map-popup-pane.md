# Mind Map Pop-out Floating Pane

## What & Why
When the user clicks the maximize/enlarge icon on the mind map in My Coding Notebook, it should pop out as a centered floating pane — 80% of the page height and 60% of the page width — sitting above the page content with a semi-transparent backdrop. This replaces the current in-place height-expansion behavior, which doesn't feel like a true pop-out.

## Done looks like
- Clicking the maximize icon opens a floating pane centered on the screen (not inline with the scroll flow).
- The pane is 80vh tall and 60vw wide, centered horizontally and vertically.
- A semi-transparent dark backdrop appears behind the pane; clicking it closes the pane.
- The X / close button inside the pane also dismisses it.
- The inline mind map in the notebook stays at its normal fixed height (500px) — it does not grow or change.
- All mind map interactions (pan, zoom, branch expand/collapse, hover tooltips, pinned nodes) work normally inside the pane.
- Pressing Escape also closes the pane.
- Smooth open/close feel (short opacity + scale transition).

## Out of scope
- Any changes to other notebook sections or the notebook layout.
- Changes to mind map data, AI analysis, or branch logic.

## Tasks
1. **Re-introduce portal rendering** — Re-add `createPortal` from `react-dom` and a second ref for the pane container. Render the floating pane (fixed, centered, 60vw × 80vh) and backdrop via the portal so it escapes ancestor overflow/transform constraints.
2. **Restore inline container** — The inline container div should always render at its normal 500px height regardless of pane state; remove the current `height: isFullscreen ? "80vh" : 500` approach.
3. **Re-wire interactions** — Ensure the wheel listener and zoomIn/zoomOut use the correct ref (pane ref when open, inline ref otherwise). Keep Escape key handler to close the pane.

## Relevant files
- `client/src/components/ide/mind-map.tsx`
