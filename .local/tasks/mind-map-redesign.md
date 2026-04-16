# Mind Map Interactive Redesign

## What & Why
Redesign the Project Mind Map ("思维导图") in My Coding Notebook to support a three-level interactive exploration model: (1) see all files, (2) expand a file to see its functions/features, (3) hover or click sub-nodes for detailed explanations. Currently all nodes are always visible and only support click-to-show-tooltip. The new design gives users a progressive top-down understanding of their project.

## Done looks like
- The section heading reads "思维导图" (Chinese) instead of "Project Mind Map"
- The mind map shows the project name at center with file-name nodes radiating outward. Sub-nodes (children) are **hidden by default**
- **File nodes (branches)**: hovering shows a description box explaining the file's purpose and features; clicking toggles the sub-nodes visible/hidden
- **Sub-nodes (children)**: hovering shows a detailed explanation popup; clicking **pins** the popup so it stays visible after the mouse leaves; clicking the sub-node again unpins it
- The description/explanation popups disappear on mouse-leave (unless pinned via click on sub-nodes)
- The layout dynamically adjusts when children are shown/hidden so nodes don't overlap
- The AI prompt produces a `description` field on each mind map branch (file-level explanation) alongside the existing children

## Out of scope
- Changing the radial layout algorithm or file-type color scheme
- Animated transitions between expand/collapse states (keep it snappy)
- Touch/mobile gesture support

## Tasks
1. **Update data model and AI prompts** — Add a `description` field to `NotebookMindMapBranch` in the store types. Update `MENTOR_SYSTEM_PROMPT`, `MENTOR_PATCH_PROMPT`, and `MENTOR_OPTIMIZE_PROMPT` in `mentor-prompt.ts` to instruct the AI to produce a `description` for each branch. The description should explain the file's purpose/features in 2-3 beginner-friendly sentences.

2. **Rewrite mind-map.tsx interaction model** — Implement the three-level interaction: (a) children hidden by default, only file-name branch nodes shown; (b) hover on branch node → show description popup (positioned near the node, disappears on mouse-leave); (c) click branch node → toggle children visible/hidden, recalculate layout; (d) hover on child node → show explanation popup; (e) click child node → pin/unpin explanation popup. Ensure the layout recalculates dynamically when branches are expanded/collapsed so nodes don't overlap.

3. **Rename section heading** — Change "Project Mind Map" to "思维导图" in `notebook-panel.tsx`. Remove the instruction text "Click on any concept node to see its explanation" and replace with contextually appropriate guidance for the new interaction model.

## Relevant files
- `client/src/components/ide/mind-map.tsx`
- `client/src/components/ide/notebook-panel.tsx`
- `client/src/stores/ide-store.ts:95-119`
- `server/mentor-prompt.ts`
