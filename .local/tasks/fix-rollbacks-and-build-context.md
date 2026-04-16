# Fix Rollback Buttons & Build Context Loss

## What & Why
Two separate bugs are affecting the Build Mode experience:

1. **Rollback buttons are gone.** `createCheckpoint` is only called at the end of a Vibe/chat-mode exchange — it is never called when a Build Mode session finishes. As a result no rollback marker is ever saved to the checkpoint store after a build, and any historical checkpoints stored in `localStorage` silently vanish when storage is trimmed (the store caps at 200 messages and automatically prunes oldest checkpoints on overflow).

2. **"请开始吧" wipes the previous version.** When the user sends a brief go-ahead phrase (e.g. "请开始吧" / "please start"), the Manager agent interprets it as "start a brand new project from scratch" rather than "begin building on top of my existing work." The manager does receive existing files via `buildManagerContextMessage`, and the prompt has a "Preserving existing code" rule, but that rule is too weak to survive a terse confirmation message. The builder then writes brand-new files, overwriting everything.

## Done looks like
- After every Build Mode session completes successfully, a rollback checkpoint marker appears in the chat panel (in the manager/build message thread) with a Restore button the user can click to undo that build.
- When an existing project has files and the user sends any go-ahead/start phrase (in any language), the Manager explicitly confirms to the user "I'll build on top of your existing project" and its generated plan steps instruct the builder to read and preserve every existing file before modifying it.
- Sending "请开始吧" with an existing project no longer results in files being erased.

## Out of scope
- Retroactively restoring checkpoints that were already lost from localStorage.
- Redesigning the checkpoint UI or adding new rollback UI elements beyond the existing CheckpointMarker.
- Changing how checkpoints work in Vibe/chat mode (that path already works).

## Tasks
1. **Call createCheckpoint after each successful Build Mode session.** In `handleExecutePlan` (inside `chat-panel.tsx`), after the SSE stream signals build completion and files have been applied to the store, call `createCheckpoint` with a label like "Build complete" so a rollback marker is added to the chat timeline. The checkpoint message should appear in `managerMessages` (not just `chatMessages`) so it's visible in the Plan/Build mode conversation thread.

2. **Strengthen the Manager agent's existing-project awareness.** In `server/manager-prompt.ts`, when files are present, add a clearly flagged "EXISTING PROJECT" section to `buildManagerContextMessage` that tells the manager: this project already has code; any plan it creates MUST treat every existing file as sacred, preserve all content unless explicitly asked to replace it, and the Stage 2 confirmation summary must mention "I'll build on top of your existing project." Also tighten the system prompt's "Preserving existing code" rule to say that when any existing files are detected, steps that touch those files must begin with "Read the existing file first and preserve all current content."

3. **Guard against accidental full rewrites in the builder.** In `server/build-orchestrator.ts`, when `session.files` is non-empty, prepend a short warning to `buildBuilderInitialMessage` that explicitly lists all existing file paths and instructs the agent: "These files already contain working code. DO NOT delete or replace their content unless a step specifically says to. Always read each file with read_file before writing it."

## Relevant files
- `client/src/components/ide/chat-panel.tsx:1712-1900,2080-2350`
- `client/src/stores/ide-store.ts:739-785`
- `server/manager-prompt.ts:117-181`
- `server/build-orchestrator.ts:89-130`
