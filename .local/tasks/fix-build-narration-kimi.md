# Fix Build Narration Visibility (Kimi Provider)

  ## What & Why
  When using Kimi K2.5, the build runs silently with zero chat messages during execution. Kimi's "thinking" mode puts all reasoning into an internal `reasoning_content` field — not `delta.content` — so no `narration_token` events fire from the AI text output. The only narration that appears comes from tool-call side effects ("Writing: /project/app.js"), which is too sparse for users to notice.

  Two complementary fixes:
  1. **Immediate step-progress messages**: On every `step_starting` SSE event, inject a manager message into the chat showing "Step N/M: title" — this fires from orchestrator metadata (no AI text needed) and gives instant feedback regardless of provider.
  2. **Surface Kimi's reasoning**: In the agent loop, emit `reasoning_content` chunks as a new `thinking_token` SSE event type. The client handles these by prepending a collapsible "(thinking…)" block into the narration message — so users can watch Kimi reason in real time.

  ## Done looks like
  - Clicking Build immediately shows a message like "Step 1/3: Add HTML structure" in the chat as each step starts
  - With Kimi selected, the chat progressively fills with Kimi's reasoning text (prefixed or styled differently from final narration)
  - With Doubao selected, behavior is unchanged — Doubao already narrates via delta.content
  - The build agent status indicator (thinking/working) cycles correctly as before

  ## Out of scope
  - Changing the Kimi model or disabling its thinking mode
  - Modifying the verifier or fixer agent prompts
  - Any changes to the plan-mode SSE path

  ## Tasks
  1. **Server: emit thinking_token from reasoning_content** — In `runAgentLoop`, emit each `reasoning_content` chunk as `{ type: "thinking_token", token }` so the client can display it. Keep this as a separate event type from `narration_token` to allow distinct UI treatment.

  2. **Client: step_starting injects a step-progress message** — In `handleExecutePlan`'s SSE "always runs" block, when `type === "step_starting"`, after calling `resetNarration()`, pre-seed `commAccumulated` with "Step N/M: title" and immediately call `addManagerMessage` (guarded by `isCurrentProject`) and set `commMsgIndex`, so subsequent narration/thinking tokens append to this message.

  3. **Client: handle thinking_token events** — In the SSE loop, add a `thinking_token` handler: accumulate tokens into a "thinking" prefix string; when the first thinking token arrives, prepend it to the step message. Style thinking content with a dimmed/italic CSS class to distinguish it from narration text. Clear the thinking prefix when `step_starting` resets narration.

  ## Relevant files
  - `server/agent-loop.ts:76-93`
  - `client/src/components/ide/chat-panel.tsx:2154-2265`
  - `server/agent-tools.ts:118-165`
  