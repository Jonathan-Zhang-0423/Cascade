---
title: Mind map pop-out: centered floating pane (80vh × 60vw)
---
# Mind Map Pop-out Floating Pane

  ## What & Why
  When the user clicks the maximize/enlarge icon on the mind map in My Coding Notebook, it should pop out as a centered floating pane — 80% of the page height and 60% of the page width — sitting above the page content. The pane must have a solid, contrasting background (not transparent) so it clearly reads as a distinct panel separated from the content behind it.

  The current implementation uses `fixed inset-4` which is viewport-filling (not centered/sized), and the pane background is transparent (`bg-muted/20`), making it look like the mind map is floating directly over the page rather than inside a proper panel.

  ## Done looks like
  - Clicking the maximize icon opens a floating pane centered on the screen (not inline with the scroll flow).
  - The pane is 80vh tall and 60vw wide, centered horizontally and vertically.
  - The pane has a solid, contrasting background color (e.g. `bg-card` or `bg-background`) with a visible border and drop shadow, so it clearly reads as a separate panel.
  - A semi-transparent dark backdrop appears behind the pane; clicking it closes the pane.
  - The X / close button inside the pane also dismisses it.
  - The inline mind map in the notebook stays at its normal fixed height (500px) and does not change.
  - All mind map interactions (pan, zoom, branch expand/collapse, hover tooltips, pinned nodes) work normally inside the pane.
  - Pressing Escape also closes the pane.

  ## Out of scope
  - Any changes to other notebook sections or the notebook layout.
  - Changes to mind map data, AI analysis, or branch logic.

  ## Tasks
  1. **Resize and center the portal pane** — Change the fullscreen portal container from `fixed inset-4` to a centered `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[80vh]` so it is 60% wide × 80% tall and centered on the viewport.
  2. **Add contrasting background to the pane** — The portal pane wrapper div should use a solid background (e.g. `bg-card` or `bg-background`) with `border border-border`, `rounded-xl`, and `shadow-2xl` so it clearly appears as a distinct panel. The inner canvas div (`canvasDiv`) keeps its own `bg-muted/20` or `bg-background` styling.

  ## Relevant files
  - `client/src/components/ide/mind-map.tsx:640-680`