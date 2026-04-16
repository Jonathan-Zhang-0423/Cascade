---
title: Smart confirmation flow before plan generation
---
# Smart Confirmation Before Planning

## What & Why
The manager agent jumps straight to generating a plan card for any build request, even vague ones, without checking its understanding with the user first. The user wants the agent to always follow a smarter three-stage flow: (1) explore unclear requirements by asking focused questions, (2) once it has enough to form a plan, present a plain-language best-guess summary and ask for confirmation, and (3) generate the actual plan card only after the user confirms. This makes the agent feel genuinely intelligent — it shows what it understood, leaves room for correction, and only commits to a plan when the user is on board. This behavior applies universally: first message, mid-conversation, or returning user.

## Done looks like
- A vague first message ("help me build a score system", "做个游戏") receives a concrete best-guess summary ("I think you want X with features Y and Z — does that sound right?"), not a raw question list and not a plan card
- A detailed first message ("build me a Snake game with arrow keys, score counter, and increasing speed") also receives a brief confirmation ("Got it — Snake in HTML/CSS/JS with arrow keys, live score, and speed ramp. Ready to plan?") before the plan card appears
- After the user confirms or makes small corrections, the agent generates the plan card automatically without requiring "go ahead" or "create plan"
- If the user changes or corrects the summary ("add a leaderboard"), the agent updates its understanding and re-confirms before planning
- The behavior is consistent across first message and mid-conversation turns

## Out of scope
- Changing the plan card UI, modal, or streaming behavior
- Communicator, editor, or verifier agents
- Any client-side changes (this is purely a prompt + routing change)

## Tasks

1. **Rewrite `MANAGER_AGENT_SYSTEM_PROMPT` with three-stage flow** — Replace the current FIRST MESSAGE RULE and Mode 1/Mode 2 binary with an explicit three-stage universal flow:
   - **Stage 1 — Explore** (requirements unclear): Ask 1-2 focused questions. Output `type: "message"`. Only use this when key information (what to build, main features, or style) is genuinely missing.
   - **Stage 2 — Confirm** (requirements clear enough): Present a warm, specific best-guess summary of what the agent proposes to build, and ask "Does this sound right?" or similar. Output `type: "message"`. This stage is MANDATORY before any plan — even if the user's first message is highly detailed.
   - **Stage 3 — Plan** (user confirmed): Output the full `type: "plan"` JSON. This stage is ONLY reached when the user has explicitly confirmed the Stage 2 summary in the current conversation (e.g., "yes", "looks good", "go ahead", "sounds right", "just do it"). Never output a plan without prior confirmation in the same conversation thread.
   - Include concrete examples in the prompt: show the ideal agent response for (a) a vague first message, (b) a detailed first message, (c) a user confirming, (d) a user correcting the summary.
   - The Stage 2 message must be warm, specific, and natural — not a bulleted list. It should read like "Here's what I'm thinking: [summary]. Does that match what you have in mind?" in the user's language.

2. **Remove the old first-message detection logic from `server/routes.ts`** — Delete the `hasNoPriorAssistant` block and its ⚠️ FIRST MESSAGE DETECTED system injection. The universal Stage 1/2/3 flow in the prompt makes this redundant.

3. **Ensure auto-plan on confirmation** — The Stage 3 rule must be explicit enough that the model generates the plan JSON immediately when it detects confirmation, without hedging or adding extra conversational text before the JSON.

## Relevant files
- `server/manager-prompt.ts`
- `server/routes.ts`