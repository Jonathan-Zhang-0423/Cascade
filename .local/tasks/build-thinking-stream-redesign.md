# Redesign Build Mode thinking stream into a full live display

## What & Why
The build mode thinking display currently shows only the last 80 characters of thinking text as a near-invisible 11px gray line inside ActionLogLive. The user wants a prominent, full-content live stream of the AI's thinking process — gray italic text that updates in real-time as the AI reasons, then collapses into an expandable section when thinking finishes. Narration text follows immediately after. This creates a transparent, engaging build experience where users understand exactly what the AI is doing at every moment.

## Done looks like
- When the user clicks "Start Building" and the AI begins reasoning, the full thinking text streams in real-time — every token visible as it arrives, in gray italic font, clearly readable (not a truncated single line)
- The thinking area auto-scrolls to show the latest content as it streams
- When thinking finishes (narration or tool calls begin), the thinking text smoothly collapses into an expandable "(Thinking)" section that preserves the full content for review
- After thinking collapses, narration text appears showing what the AI is doing
- After the entire build completes, the completion summary shows what was done, which files changed, and any important notes
- The scroll follows the live content automatically so the user never has to manually scroll to see streaming text
- The entire flow works for all AI providers (Doubao, Kimi, MiniMax, GLM)

## Out of scope
- Plan mode thinking display (this task focuses only on build execution)
- Build completion summary redesign (already exists and works)
- Server-side streaming changes (server already emits thinking_token correctly)

## Tasks
1. **Replace the ActionLogLive thinking display** — Remove the truncated single-line display and replace it with a full-content streaming area that shows all thinking text in gray italic font with a max-height container and internal auto-scroll.

2. **Add collapsible thinking section** — When liveThinkingText is cleared (transition to narration or tool calls), convert the accumulated thinking into a collapsible "(Thinking)" section within ActionLogLive that the user can expand to review. Use the existing action log "thinking" entry (which already stores the full text) to drive this collapsed view.

3. **Fix scroll dependency** — Add `liveThinkingText` to the auto-scroll useEffect dependency array so the chat panel auto-scrolls as thinking text streams in.

4. **Verify end-to-end flow across providers** — Ensure the thinking → narration → tool calls → completion flow works correctly for Doubao (reasoning_content), Kimi (reasoning_content), MiniMax (reasoning via tool), and GLM (reasoning_content).

## Relevant files
- `client/src/components/ide/chat-panel.tsx:14-117`
- `client/src/components/ide/chat-panel.tsx:186-260`
- `client/src/components/ide/chat-panel.tsx:1940-1978`
- `client/src/components/ide/chat-panel.tsx:2620-2810`
- `client/src/components/ide/chat-panel.tsx:3260-3300`
