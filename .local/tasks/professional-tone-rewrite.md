# Agent Tone & Feature Consolidation

## What & Why
Three related changes to simplify the agent system and establish a professional tone:
1. **Tone shift**: The Communicator and Manager agents currently use a "beginner hand-holding" tone. Shift to a professional, friendly, clear tone — like a software engineer colleague.
2. **Replace Vibe Agent with Editor Agent in Build Mode**: The Vibe Agent (direct chat coding mode) is redundant. In Build Mode, the Editor Agent will take over — receiving user instructions directly and implementing them without a plan-confirm cycle. The Editor gets the same professional, user-facing tone. Delete the Vibe Agent entirely.
3. **Remove all educational features**: Delete the Mentor Agent, Coding Notebook (notebook panel, mind map), and all related UI, routes, prompts, and store state.

## Done looks like
- The Communicator speaks like a professional dev giving concise status updates — technical terms used naturally, no "explain like I'm 5" translations, no mandatory emojis
- The Manager communicates like a senior engineer scoping work — professional, clear, assumes competence
- In Build Mode, the user's messages go to the Editor Agent (instead of the Vibe Agent). The Editor implements instructions directly using its tool-calling workflow (read_file, write_file, etc.) without requiring a plan confirmation step. The Editor narrates what it's doing in a professional tone matching the user's language
- The "Plan Mode" toggle remains in the chat input — it switches between Manager (plan mode) and Editor (build mode)
- The Coding Notebook tab, mind map, notebook panel, and all mentor-related UI are fully removed from the IDE
- The `/api/chat` (vibe) endpoint is replaced by routing Build Mode messages through the Editor Agent's existing infrastructure
- The `/api/mentor-analyze`, `/api/mentor-patch`, `/api/mentor-optimize` endpoints are removed
- `server/vibe-prompt.ts` and `server/mentor-prompt.ts` files are deleted

## Out of scope
- Changes to the Editor's tool-calling mechanics or build orchestration logic
- Changes to the Verifier agent
- Changes to the structured output formats (plan cards, completion cards still use [PLAN_SUMMARY], [HEADLINE] etc.)

## Tasks
1. **Rewrite Communicator prompt** — Change identity from "friendly narrator for beginners" to "professional engineer giving clear status updates." Remove "never use technical terms" rules, "explain like I'm 5" tone, mandatory emoji rules, and file-name-hiding rules. Keep structured output formats but update examples to professional language. Allow natural use of technical terms and file names.

2. **Adjust Manager prompt tone** — Shift from "warm, supportive for beginners" to "professional senior engineer collaborating with the user." Keep the three-stage flow (Explore/Confirm/Plan) intact but update tone guidelines to be direct, clear, and professional. Reduce emoji to optional. Drop patronizing over-caution.

3. **Update Editor prompt for Build Mode chat** — Add a professional, friendly user-facing tone so the Editor can communicate with users directly in Build Mode. The Editor should narrate its actions clearly in the user's language, respond to follow-up instructions, and implement changes without requiring a plan. Keep all existing tool-calling and coding rules intact.

4. **Replace Vibe Agent with Editor in Build Mode** — Delete `server/vibe-prompt.ts`. Rewire the Build Mode chat flow: instead of calling `/api/chat` (Vibe), route Build Mode messages to the Editor Agent's existing endpoint/infrastructure. The Editor receives user instructions and implements them directly using its tools. Update the chat panel to send Build Mode messages to the Editor instead of the Vibe Agent. Remove vibe-specific state from stores. Update LLM monitor to reflect the Editor source instead of "VIBE".

5. **Remove all educational/Mentor features** — Delete `server/mentor-prompt.ts`. Remove `/api/mentor-analyze`, `/api/mentor-patch`, `/api/mentor-optimize` endpoints from `server/routes.ts`. Delete `client/src/components/ide/notebook-panel.tsx` and `client/src/components/ide/mind-map.tsx`. Remove notebook/mentor state from `client/src/stores/ide-store.ts`. Remove the Coding Notebook tab from `client/src/components/ide/navbar.tsx` and `client/src/pages/ide.tsx`. Clean up i18n keys related to notebook/mentor in `client/src/lib/i18n.ts`.

## Relevant files
- `server/communicator-prompt.ts`
- `server/manager-prompt.ts`
- `server/editor-prompt.ts`
- `server/vibe-prompt.ts`
- `server/mentor-prompt.ts`
- `server/routes.ts:657-730`
- `server/routes.ts:984-1213`
- `server/mobile-prompt-supplements.ts`
- `server/agent-loop.ts`
- `server/build-orchestrator.ts`
- `client/src/components/ide/chat-panel.tsx`
- `client/src/components/ide/notebook-panel.tsx`
- `client/src/components/ide/mind-map.tsx`
- `client/src/components/ide/navbar.tsx`
- `client/src/components/ide/llm-monitor.tsx`
- `client/src/stores/ide-store.ts`
- `client/src/stores/llm-monitor-store.ts`
- `client/src/pages/ide.tsx`
- `client/src/lib/i18n.ts`
