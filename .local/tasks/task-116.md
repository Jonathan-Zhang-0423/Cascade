---
title: Fix Manager Live Streaming Yield for Token-by-Token Display
---
# Fix Manager Live Streaming Yield

## What & Why
The manager mode's thinking and narration text updates don't appear to stream live — text shows up all at once rather than token-by-token. This is because the SSE handler calls `setMgrLiveThinkingText()` and `setMgrLiveNarrationText()` without yielding to the event loop between tokens. React batches the state updates within the same microtask and only renders the final accumulated text.

The build mode handler already solves this with `await new Promise<void>(r => setTimeout(r, 0))` after each state update, giving React a chance to re-render between tokens.

## Done looks like
- During manager streaming, thinking text streams in token-by-token with visible progressive rendering (matching build mode behavior)
- Narration text also streams progressively  
- The brain icon with "THINKING" label appears immediately when the first thinking token arrives

## Out of scope
- Build mode streaming (already works correctly)
- Any other manager mode UI changes

## Tasks
1. **Add event loop yield after thinking_token state update** — Add `await new Promise<void>(r => setTimeout(r, 0))` after `setMgrLiveThinkingText()` in the manager SSE handler.

2. **Add event loop yield after raw_token state update** — Add `await new Promise<void>(r => setTimeout(r, 0))` after `setMgrLiveNarrationText()` in the manager SSE handler.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:2291-2304`