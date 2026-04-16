# Fix: Chat Agent not applying file changes

## What & Why
When the user asks the Editor Agent (chat mode) to create or modify files, the agent produces a response with code blocks annotated with `file="/project/..."`, which are displayed in the chat UI correctly — but the files are never actually written to the project. The `applyCodeBlock` function exists and works, but it is only called during the Build Session flow (`handleExecutePlan`), not in the regular chat flow (`handleVibeSend`).

## Done looks like
- When the agent in chat mode responds with a code block like ` ```python file="/project/hello.py" `, the file `hello.py` is created (or updated) in the project file tree immediately after the response finishes streaming.
- Existing files that the agent outputs are updated with the new content.
- New files that don't exist yet are created under the correct parent directory.
- The behavior mirrors what already works in Build Session mode.

## Out of scope
- Changes to the Build Session flow (already working correctly).
- Changes to the server-side chat endpoint.
- Changes to how code blocks are rendered in the chat UI.

## Tasks
1. **Apply code blocks after Vibe/chat response** — At the end of `handleVibeSend`, after the full response is accumulated, extract all code blocks using the existing `extractCodeBlocks` helper and call `applyCodeBlock` for each one that has a valid `filePath`. This mirrors what `handleExecutePlan` already does via `code_applied` SSE events.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:150-181,1596-1613,2092-2189`
