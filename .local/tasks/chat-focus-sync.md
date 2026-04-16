# Fix Chat Input Focus Sync

## What & Why
The chat input box uses CSS `focus-within` to show a focus ring. When the user clicks between the textarea and the buttons in the bottom row, focus briefly transfers between elements, causing the ring to flicker off and on in an unsynchronised way. The textarea area and the button row appear to have mismatched focus states.

## Done looks like
- Clicking anywhere inside the chat input box (textarea OR buttons) shows a stable, smooth focus ring with no flicker
- The ring only disappears when the user clicks outside the entire input box
- No visual difference between clicking the textarea area vs. the buttons area

## Out of scope
- Changing the visual style of the focus ring itself

## Tasks
1. **Replace CSS focus-within with React focus state** — Add an `isFocused: boolean` state to ChatPanel. Add `onFocus` and `onBlur` handlers on the outer wrapper div that use `relatedTarget` to check whether focus is moving within the container or outside it (only set `isFocused = false` when `relatedTarget` is null or outside the container). Apply the border/shadow/bg focus classes conditionally using `cn()` based on `isFocused` instead of CSS `focus-within:` variants.

## Relevant files
- `client/src/components/ide/chat-panel.tsx:2257-2329`
