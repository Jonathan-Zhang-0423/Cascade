---
title: Fix plan-mode streaming order & remove agent icons
---
# Fix Plan-Mode Streaming Order & Agent Message Alignment

  ## What & Why

  Two problems addressed together since they both touch ManagerMessageBubble in chat-panel.tsx:

  **Streaming order bug**: When the Manager generates a plan, the current server event order in /api/manager-chat is: raw_token stream → plan_ready (plan card) → communicator_token stream (narration). The narration streams *below* the already-visible plan card. The desired UX is: narration streams first, *then* the plan card drops in underneath.

  **Bot icon and alignment**: Task #58 added a Bot icon to communicator messages and a special two-column layout (flex items-start gap-2 with an icon div). The user does not want bot icons anywhere. All agent-sourced messages (communicator, manager, typing bubbles) should share the same simple left-aligned layout with consistent padding, with no icon elements.

  ## Done looks like

  - When the Manager finishes generating a plan, the Communicator narration streams word-by-word first (typing bubble → streaming text), then the plan card appears below it after narration completes.
  - The narration message stays visible above the plan card — it is not removed when the plan card appears.
  - No Bot icon appears on any message bubble (communicator, manager, or typing bubble).
  - Communicator messages have the same left-aligned padding and text style as all other assistant messages — no icon column, no extra wrapper divs.
  - Both the communicator typing bubble and manager typing bubble use identical layout (no icon variant).
  - The auto-execute trigger in Build Mode still fires correctly.
  - Both streaming validation tests pass after the server-side reorder.

  ## Out of scope

  - Changing the content or format of the Communicator narration for plan_created events.
  - Stage 1 and Stage 2 message responses (plain conversational messages — unaffected).
  - Any changes to Build Mode's agent pipeline (covered by Task #60).

  ## Tasks

  1. **Remove Bot icon and unify message layout** — In ManagerMessageBubble, remove the Bot icon import and all icon-related markup. Communicator messages (source === "communicator") should render with the same simple px-3 text-[13px] leading-relaxed text-foreground layout as plain assistant messages. The communicator typing bubble variant (which added a Bot icon) should be removed — both typing states use the same three-dot bubble markup. Remove the Bot import from the lucide-react import line.

  2. **Reorder server events in /api/manager-chat** — For plan responses, run the Communicator narration stream BEFORE emitting plan_ready. Also emit communicator_narration_starting before the Communicator API call begins (same pattern as build-orchestrator.ts) and add a per-token await setTimeout(0) yield in the communicator loop.

  3. **Update handleManagerSend typing bubble → narration transition** — Wire up communicator_narration_starting in the manager-chat SSE handler so the typing bubble is replaced in-place by the communicator streaming text (same commTypingIdx pattern as the build-session handler from Task #58). Currently the first communicator_token adds a separate message; it should convert the bubble.

  4. **Guard plan card insertion** — Verify that the plan_ready client handler does not remove the communicator narration message (it should only remove streamingMsgIndex, leaving commNarrationMsgIndex intact). Plan card is added after plan_ready fires — narration is fully streamed by then.

  5. **Re-run both streaming validation tests** — Confirm plan-mode-streaming and build-session-streaming both pass.

  ## Relevant files

  - client/src/components/ide/chat-panel.tsx:9 (lucide-react import — remove Bot)
  - client/src/components/ide/chat-panel.tsx:1466-1514 (ManagerMessageBubble typing + communicator rendering)
  - client/src/components/ide/chat-panel.tsx:1720-2017 (handleManagerSend SSE loop)
  - server/routes.ts:459-504 (plan_ready + communicator stream order)
  - server/build-orchestrator.ts:87-113 (callCommunicatorNarration — reference for communicator_narration_starting pattern)
  - tests/plan-mode-streaming.ts
  - tests/build-session-streaming.ts