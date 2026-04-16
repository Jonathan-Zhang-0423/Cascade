---
title: Mentor Agent language passthrough
---
# Mentor Agent Language Passthrough

## What & Why
The Coding Notebook (Mentor Agent) always outputs in English even when the user has switched the IDE to Chinese mode. The root cause is that the frontend never sends the `lang` setting to the backend — the three mentor API endpoints (`/api/mentor-analyze`, `/api/mentor-patch`, `/api/mentor-optimize`) only receive `files` (and existing notebook data), so the AI model has no reliable signal about which language to use. The system prompt's current Rule 7 ("infer from the project content") fails whenever project code uses English identifiers and comments, which is the common case for AI-generated projects.

## Done looks like
- When the IDE is in Chinese mode, the Coding Notebook is generated entirely in Chinese (summaries, explanations, walkthroughs, learning tips, mind-map labels, etc.).
- When the IDE is in English mode, the output is in English.
- Switching language and regenerating the notebook produces output in the newly selected language.
- The patch and optimize endpoints also respect the language setting when updating an existing notebook.

## Out of scope
- Automatically regenerating/re-translating a previously cached notebook when the user switches language (the user will need to manually regenerate).
- Translating hardcoded static UI shell strings (already handled in Task #42).

## Tasks
1. **Frontend — send `lang` with every mentor API call** — In `notebook-panel.tsx`, read `lang` from `useLanguageStore.getState()` and include it in the request body for all three calls: `generateNotebook` → `/api/mentor-analyze`, `autoPatchNotebook` → `/api/mentor-patch`, and the optimize call → `/api/mentor-optimize`.

2. **Backend — read `lang` and inject a hard language directive** — In `server/routes.ts`, extract `lang` from the request body for all three mentor endpoints. Pass it into the prompt-building logic as an explicit, unconditional instruction injected at the top of the user message (e.g., "IMPORTANT: Respond entirely in Simplified Chinese. Do not use English." / "IMPORTANT: Respond entirely in English."). This replaces the vague "infer from content" Rule 7 with a definitive override when `lang` is present.

3. **Strengthen system prompt Rule 7** — In `server/mentor-prompt.ts`, update Rule 7 in all three system prompts (`MENTOR_SYSTEM_PROMPT`, `MENTOR_PATCH_PROMPT`, `MENTOR_OPTIMIZE_PROMPT`) to reflect that when an explicit language directive is provided in the user message, it is absolute and overrides all inference. Keep the fallback inference logic for cases where `lang` is absent.

## Relevant files
- `client/src/components/ide/notebook-panel.tsx:377-432`
- `server/routes.ts:698-756`
- `server/mentor-prompt.ts:1-109`
- `client/src/stores/language-store.ts`