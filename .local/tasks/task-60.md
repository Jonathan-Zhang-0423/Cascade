---
title: Dual-personality Editor & Verifier; remove Build Communicator
---
# Dual-Personality Editor & Verifier; Remove Build Communicator

  ## What & Why

  In Build Mode, the Communicator Agent narrates what each working agent does — but it fires as a separate API call after each event, adding 5–18 seconds of latency and leaving 60–120 seconds of silence while the Editor actually works. The root issue: the Communicator speaks about the agents' work, but only after the fact.

  This task removes the Communicator Agent from Build Mode entirely and gives the Editor and Verifier their own "narrating voice" — a second personality alongside their technical output, modeled on how the Manager Agent already works today. The Editor will now stream a brief friendly explanation AS it writes code, and the Verifier will stream a friendly verdict summary AS it generates its JSON.

  The Communicator Agent's plan-narration role in Plan Mode (the plan_created event in routes.ts) is NOT changed — it continues to produce the rich [PLAN_SUMMARY]/[STEP_N] structured narration that populates the plan card summary. Only the Build Mode pipeline in build-orchestrator.ts is affected.

  Styling note: narration messages must use plain left-aligned layout with no bot icon (consistent with the alignment clean-up in Task #59). They use the same px-3 text-[13px] leading-relaxed style as all other assistant messages.

  ## Done looks like

  - When a build step starts, the Editor immediately begins streaming: first a 1–2 sentence friendly explanation of what it's about to build, then the code blocks. No separate narration API call, no 5–18s silent gap.
  - That narration text appears in the chat panel with the same plain left-aligned style as all agent messages — no icon, no special column layout.
  - When the Verifier runs (after all steps complete), it streams a friendly 2–3 sentence verdict before its structured JSON verdict. That text also streams into a plain chat bubble.
  - The long 60–120 second silent gap during Editor work is eliminated — the user sees the Editor's own words immediately.
  - The build-session-streaming validation test is updated to assert on narration_token events and passes.

  ## Out of scope

  - Changing the Plan Mode communicator (plan_created narration in routes.ts). That is untouched.
  - Changing the Manager Agent's three-stage conversational flow.
  - Removing communicator-prompt.ts or COMMUNICATOR_AGENT_SYSTEM_PROMPT (still needed by routes.ts for plan_created).
  - Streaming the Verifier's raw JSON to the chat panel.
  - Any bot icon styling — icons are already removed by Task #59; this task must not re-add them.

  ## Tasks

  1. **Update Editor Agent system prompt** — Add a "dual personality" section to EDITOR_AGENT_SYSTEM_PROMPT instructing the Editor to open its response with 1–2 sentences of friendly, beginner-accessible narration in the user's language, before any code block. The narration must be plain prose (no code fences, no markdown headers) so it can be reliably detected as pre-code text.

  2. **Emit narration_token from callEditor** — In the Editor's streaming loop in build-orchestrator.ts, track whether the first code fence (```) has appeared yet. Before the first fence: emit { type: "narration_token", token }. After the first fence: emit { type: "editor_token", token } (unchanged). Use a boolean narrationPhase that flips to false permanently on first ``` occurrence.

  3. **Add Verifier narration** — Update VERIFIER_AGENT_SYSTEM_PROMPT to output a friendly 2–3 sentence verdict summary first (plain prose in the user's language), then a --- separator, then the JSON object. In callVerifier (or its caller), extract text before --- as the narration and return it alongside the parsed JSON. In runBuildSession, after calling callVerifier, emit the narration text as narration_token events with per-token yields.

  4. **Remove all callCommunicatorNarration calls from runBuildSession** — Delete every await callCommunicatorNarration(...) call and the communicator_narration_starting emit from build-orchestrator.ts. The callCommunicatorNarration function and its imports of buildCommunicatorMessage/CommunicatorEvent/COMMUNICATOR_AGENT_SYSTEM_PROMPT may be removed from build-orchestrator.ts (those exports remain in their source files for use by routes.ts).

  5. **Update client handleExecutePlan for narration_token** — In chat-panel.tsx, replace the communicator_narration_starting / communicator_token / communicator_error / communicator_done handlers in the build-session SSE loop with a narration_token handler. The handler accumulates and streams text into a plain assistant chat bubble (no icon). Each new narration sequence gets its own bubble per step: reset the narration accumulator when step_starting fires.

  6. **Update build-session-streaming test** — Change assertions to check for narration_token events instead of communicator_token. Re-run both plan-mode-streaming and build-session-streaming to confirm all checks pass.

  ## Relevant files

  - server/build-orchestrator.ts (full file)
  - server/editor-prompt.ts
  - server/verifier-prompt.ts
  - client/src/components/ide/chat-panel.tsx:2159-2415 (handleExecutePlan build-session SSE loop)
  - tests/build-session-streaming.ts