# Richer Mind Map Sub-node Explanations & Click Fix

## What & Why
Two improvements to the mind map in My Coding Notebook:

1. **Sub-node explanations are too brief.** The mentor prompt currently asks for "2-4 sentences" per child node. Explanations need to be more structured and educational, covering: why this feature exists, why it matters, what it does to the overall project, and how it is built — with code snippets in markdown format where useful.

2. **Clicks on nodes are intermittently unresponsive.** The drag-detection threshold is 4px of Manhattan distance (`|dx| + |dy| > 4`). Any natural hand tremor of 2px in each direction during a click crosses this threshold and silently blocks the `onClick` handler. The fix is to raise the threshold and use Euclidean distance.

## Done looks like
- Each child node's explanation (visible when the node is clicked/pinned) covers all four dimensions: why it exists, why it matters, what it does to the project, and how it is built — at least 4-6 sentences.
- Where appropriate, the explanation includes a short code snippet in markdown code block format (e.g., a relevant function, selector, or HTML tag) with a plain-language walkthrough.
- Clicking on branch nodes and child nodes works reliably without requiring perfectly still hands. Dragging the canvas does not accidentally suppress clicks.
- All existing interactions (hover descriptions, click to expand, click to pin, pan, zoom) continue to work.

## Out of scope
- Changes to the visual layout of sub-node popups.
- Changes to any section of the notebook other than the mind map child explanations.
- Changes to the mind map layout algorithm.

## Tasks
1. **Expand the mentor prompt for child node explanations** — In `server/mentor-prompt.ts`, update the child `"explanation"` field description in the main prompt, the patch prompt, and the optimize prompt. The new instruction should require the explanation to address: (a) what this feature/function is and why it was created, (b) why it matters to the project, (c) what it does technically, (d) how it is built — plus a short markdown code snippet with a line-by-line or concept-level walkthrough where helpful. Target 4-8 sentences plus optional code block.

2. **Fix the drag threshold to prevent blocked clicks** — In `client/src/components/ide/mind-map.tsx`, change the drag detection condition from `Math.abs(dx) + Math.abs(dy) > 4` to `Math.sqrt(dx * dx + dy * dy) > 8`. This uses proper Euclidean distance and a higher threshold, so minor hand tremor during a click is no longer misidentified as a drag.

## Relevant files
- `server/mentor-prompt.ts`
- `client/src/components/ide/mind-map.tsx:324`
