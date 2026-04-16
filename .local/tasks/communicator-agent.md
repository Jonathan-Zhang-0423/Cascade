# Add Communicator Agent & Refactor Agent Personalities

## What & Why
Add a 4th agent (Communicator) to the Manager Mode multi-agent system. The Communicator is the sole user-facing narrator — it translates the technical JSON outputs of the Manager, Editor, and Verifier agents into friendly, plain-language progress updates streamed to the user. The 3 backend agents (Manager, Editor, Verifier) should be stripped of all friendly personality and emoji usage, becoming purely technical/professional since they only talk to each other. All warmth, encouragement, emojis, and beginner-friendly tone moves to the Communicator agent, which inherits the personality from `vibe-prompt.ts`.

## Done looks like
- A new Communicator Agent prompt file exists with the full friendly personality (warm, encouraging, emoji-rich, no-jargon, beginner-friendly)
- A new `/api/communicator-chat` streaming endpoint exists that takes agent event context and returns a friendly narration
- Manager prompt is purely professional — no emojis, no "celebrate ideas", no friendly personality section; outputs only structured JSON
- Verifier prompt is purely professional — no emojis, no "thorough but kind" personality; outputs only structured JSON
- Editor prompt (when used in Manager Mode) receives a professional, task-focused system prompt without friendly personality
- During plan execution, each key moment calls the Communicator to generate a friendly streaming message visible to the user:
  - After Manager creates a plan → Communicator summarizes it
  - Before each step executes → Communicator announces what's happening
  - After Editor completes a step → Communicator reports what was done
  - After Verifier checks → Communicator reports the result
  - When user confirmation is needed → Communicator presents it clearly
  - On all-steps-complete → Communicator celebrates
- Build Mode (Vibe Agent direct chat) is completely unchanged
- The overall UX feels like one friendly narrator is guiding the user through the entire automated build process

## Out of scope
- Changes to Build Mode / Vibe Agent direct chat behavior
- Changes to the project file system, persistence, or store structure beyond what's needed for Communicator messages
- Version control / git integration mentioned in the spec (not currently implemented)

## Tasks
1. **Create Communicator Agent prompt** — New `server/communicator-prompt.ts` with the full friendly personality inherited from `vibe-prompt.ts`, tailored for narrating multi-agent progress. Include a context builder function that packages agent events into a prompt.

2. **Strip friendliness from Manager prompt** — Remove the personality section, emoji references, "celebrate ideas", "friend talking" language. Keep it purely professional: structured JSON output only, no conversational flair.

3. **Strip friendliness from Verifier prompt** — Remove "friendly QA", emoji usage, "celebrate", "gently suggest". Make it a strict, professional QA evaluator that outputs only structured JSON.

4. **Create a professional Editor system prompt for Manager Mode** — When the Editor is called during Manager Mode step execution, it should use a stripped-down, professional prompt (no emojis, no "celebrate small wins", no teaching tone). The existing `vibe-prompt.ts` remains unchanged for Build Mode.

5. **Add `/api/communicator-chat` streaming endpoint** — New endpoint in `server/routes.ts` that accepts an event type and context payload, calls the Communicator Agent via Doubao AI with streaming, and returns SSE chunks. Event types: `plan_created`, `step_starting`, `step_completed`, `step_verified`, `step_failed`, `needs_input`, `all_complete`.

6. **Integrate Communicator into the Manager Mode execution flow** — Update `chat-panel.tsx` to call the Communicator endpoint at each key moment during `handleExecutePlan` and `handleSendManagerMessage`. Replace the current hardcoded messages ("Working on: {title}", "All steps completed!", retry messages) with streamed Communicator narrations displayed as assistant messages in the manager message list.

7. **Wire Editor to use professional prompt in Manager Mode** — Update the `/api/chat` endpoint or the `executeSubTask` function to pass a flag indicating Manager Mode context, so the backend uses the professional Editor prompt instead of the full Vibe Agent prompt.

## Relevant files
- `server/vibe-prompt.ts`
- `server/manager-prompt.ts`
- `server/verifier-prompt.ts`
- `server/routes.ts`
- `client/src/components/ide/chat-panel.tsx:1095-1399`
- `client/src/stores/ide-store.ts:210-250,760-775`
