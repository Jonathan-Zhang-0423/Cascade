---
title: Dual-Tone Agents + Richer Completion Summary
---
# Task 40: Dual-Tone Agents + Richer Completion Summary

## What & Why
Two separate improvements in this task:

**A — Dual-tone Manager:** Currently the Manager uses a dry, structured tone in all responses. When speaking to users in conversational mode (asking clarifying questions, exploring ideas), it should sound like the Communicator — warm, encouraging, beginner-friendly. When generating plans or communicating with Editor/Verifier (internal, agent-to-agent mode), it keeps the current professional, precise tone. Same dual-tone principle is articulated in the prompts for Editor and Verifier so it's established as a pattern for when those agents gain user-facing surfaces.

**B — Richer completion summary:** The current `all_complete` Communicator message is generic. It should tell the user specifically what changed — which parts of their project are new or updated — and why it matters, by receiving the list of changed files and using it to generate a narrative.

## Done looks like
- Manager's conversational responses (Mode 1) are warm, encouraging, and jargon-free — matching the Communicator's voice
- Manager's plan output (Mode 2) and internal messages remain precise and technical
- Editor and Verifier prompts include a clear "dual-tone" principle section for future use
- The `all_complete` Communicator message specifically names what was built (e.g. "I've built your game's page layout, added the movement controls, and styled the board"), derived from the changed files list
- Changed files are computed by diffing the pre-build snapshot against the post-build file state and passed to the Communicator

## Out of scope
- Changing any build execution logic
- Server-side orchestration (Task 41)
- Plan card redesign (Task 39)

## Changes required

### 1. `server/manager-prompt.ts`
In the system prompt's **Mode 1 (Conversation)** section, add:
```
## User-Facing Tone (Mode 1 only)
When responding in Mode 1 (message), you are speaking directly to the user — a complete beginner. Use the same warm, friendly, encouraging tone as the Communicator:
- Speak in plain language, no technical jargon
- Use 1-2 emojis naturally per message
- Be patient and supportive — celebrate their ideas
- Short paragraphs, easy to read
- Never make the user feel bad about an unclear request

The precise, technical tone is reserved for Mode 2 (plan output) and any agent-to-agent communication.
```

Also add a brief "Dual-tone principle" header noting that Mode 1 = user-facing (warm), Mode 2 = agent-facing (technical).

### 2. `server/editor-prompt.ts` (or wherever the Editor prompt lives)
Add a "Dual-tone principle" comment section:
```
## Dual-tone principle
- Agent-facing (instructions from Manager, output to Verifier): precise, technical, structured
- User-facing (if ever narrating directly to user): warm, encouraging, jargon-free — like the Communicator
```

### 3. `server/verifier-prompt.ts` (or wherever the Verifier prompt lives)
Same dual-tone principle section as Editor.

### 4. `server/communicator-prompt.ts`
- Add `changedFiles?: string[]` to `CommunicatorEvent` interface
- Update `buildCommunicatorMessage` for `all_complete`: include the changed files list in the context
- Update the `all_complete` section in `COMMUNICATOR_AGENT_SYSTEM_PROMPT`: instruct the Communicator to use the changed files to produce a specific, narrative summary ("I've built your X, added Y, and styled Z") rather than a generic "everything is done" message

### 5. `client/src/components/ide/chat-panel.tsx`
In `handleExecutePlan`, after the build loop passes (the `if (passed)` block at line ~2099):
- Compute `changedFiles`: diff `preBuildSnapshotRef.current` against `flattenFiles(useIDEStore.getState().files)` — collect file paths where content changed or files are new
- Pass `changedFiles` to `callCommunicator({ event: "all_complete", ..., changedFiles })`

## Relevant files
- `server/manager-prompt.ts`
- `server/communicator-prompt.ts`
- `server/editor-prompt.ts` (or equivalent)
- `server/verifier-prompt.ts` (or equivalent)
- `client/src/components/ide/chat-panel.tsx` — all_complete event in handleExecutePlan