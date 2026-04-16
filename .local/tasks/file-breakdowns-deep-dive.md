# 深度解析 — File Breakdowns Deep Dive Redesign

## What & Why
The "File Breakdowns" section in My Coding Notebook currently shows a flat list of files with short descriptions and key concepts. It needs to become a rich, educational deep-dive that mirrors the mind map structure — each file contains the same features shown as child nodes on the mind map, with detailed explanations and actual code snippets rendered in IDE-like blocks.

This is the natural continuation of the mind map: the map gives the overview, "深度解析" lets users zoom in and understand exactly how each feature is built, line by line, with real code from their project.

## Done looks like
- The section is renamed "深度解析" (for Chinese users) / "Deep Dive" (for English users).
- Each file card expands to show its features — the same features that appear as child nodes in the mind map for that file.
- Each feature shows: (1) a plain-language explanation covering what it is, why it matters, and how it works, followed by (2) one or more code blocks in IDE-like monospace format showing the actual relevant code from the project.
- Code blocks are rendered with a dark or muted background, monospace font, and syntax-appropriate styling — individual blocks, not one giant blob.
- Each code block has a plain-language walkthrough that explains what the code does step by step.
- The existing key_concepts and connections sections within each file card are preserved.
- All content follows the strict plain-language rule: every technical term is immediately explained.

## Out of scope
- Syntax highlighting (nice-to-have for later, not required now).
- Changes to the mind map itself.
- Changes to the project summary or learning tips sections.

## Tasks
1. **Update data model** — In `client/src/stores/ide-store.ts`, add a `features` array to `NotebookFileBreakdown`. Each feature has: `label` (string, the feature name matching mind map child label), `explanation` (string, what/why/how in plain language), and `code_blocks` (array of `{ code: string, walkthrough: string }` — the actual code snippet and its step-by-step explanation).

2. **Update mentor prompts** — In `server/mentor-prompt.ts`, update the `file_breakdowns` JSON schema in all three prompts (main, patch, optimize) to include the new `features` array. Instruct the mentor to align features with the mind map children, include real code from the user's project files, and write step-by-step walkthroughs for each code block. Emphasize that code_blocks must contain actual code from the files, not generic examples.

3. **Redesign frontend rendering** — In `client/src/components/ide/notebook-panel.tsx`, redesign the file breakdowns section: rename heading to "深度解析", render each feature as a sub-section within the expanded file card, display code blocks in styled monospace containers (dark/muted background, rounded corners, clear font), and place walkthrough text between/around code blocks. Keep key_concepts and connections.

## Relevant files
- `client/src/stores/ide-store.ts`
- `server/mentor-prompt.ts`
- `client/src/components/ide/notebook-panel.tsx:506-607`
