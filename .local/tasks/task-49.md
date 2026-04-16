---
title: Conversational plan mode improvements
---
# Conversational Plan Mode Improvements

## What & Why
Our plan mode currently jumps straight to a structured task card on the first message, even for vague or exploratory requests. Lovable's plan mode first asks clarifying questions, can stay purely conversational, and when a plan is produced it renders as a rich readable document — not just a task list. Three gaps to close:

1. **Conversational before plan** — manager should ask 1–2 focused questions on the first message of every new project unless the request is already complete and detailed.
2. **Rich markdown plan document** — add a "View Plan Document" button to the plan card that opens a full-screen readable document view of the plan (overview, key decisions, what & why, done looks like, out of scope, then the step list as prose).
3. **Pure exploration** — manager should handle free-form exploratory conversations (brainstorming, questions, comparisons) without feeling pressured to produce a plan at the end.

## Done looks like
- Sending a first vague message ("build me something cool") produces a friendly question back, not a plan card.
- Sending a detailed, specific message ("build me a snake game in HTML/CSS/JS with arrow key controls and a score counter") still produces a plan directly.
- Every plan card has a "View Plan" button (document icon) that opens a full-screen panel showing the plan as a formatted document with sections and prose.
- The manager happily answers exploratory questions ("what's the difference between React and Vue?") without forcing a plan.

## Out of scope
- Direct in-line editing of the plan markdown (Lovable feature #1 from the comparison — a separate task).
- Saving the plan to a file on disk.
- Diagrams or architecture charts.
- Any changes to the execution pipeline (Editor, Verifier, Communicator agents).

## Tasks

1. **Manager prompt: first-message clarification rule** — Add a rule that on the very first message of a new conversation (no prior assistant messages), the manager MUST respond with Mode 1 (conversation) and include at least one focused clarifying question, unless the request already specifies: what to build, the main features, and the visual/interaction style. Expand the Mode 1 / Mode 2 decision criteria with concrete examples.

2. **Manager prompt: richer plan content** — Add an `overview` field to the Mode 2 JSON output schema (a 3–5 sentence prose paragraph covering approach, key decisions, and any important constraints/assumptions). Update the prompt field guidelines accordingly. Update the `ManagerPlan` interface in `shared/schema` or `ide-store.ts` to include `overview?: string`.

3. **Manager prompt: exploration-friendly tone** — Explicitly state that a conversation can end with clarity or a direction — there is no obligation to produce a plan. Add example triggers for pure exploration (comparing approaches, explaining concepts, reviewing existing code).

4. **Full-screen plan document view** — Add a "View Plan" icon button to the plan card header. When clicked, open a full-screen overlay/panel that renders the plan as a formatted markdown document: title (plan summary), then `overview` section, then `what_and_why`, `done_looks_like`, `out_of_scope` as headed sections, then the numbered step list as prose (step title + description). Use the narrated variants of fields when available.

## Relevant files
- `server/manager-prompt.ts`
- `client/src/stores/ide-store.ts:39-50`
- `client/src/components/ide/chat-panel.tsx:929-1067`