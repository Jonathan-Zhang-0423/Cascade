---
title: Fix feature data shape mismatch between AI output and frontend
---
---
title: "Fix feature data shape mismatch between AI output and frontend"
---

# Fix feature data shape mismatch between AI output and frontend

## What & Why
The AI model (Doubao Lite) returns features in a different shape than what the frontend expects. The data IS being generated — it's just structured wrong. This causes every feature card to show "Details pending" even though the AI sent useful content.

**AI returns:**
- `code_block` (singular string with markdown-fenced code) instead of `code_blocks` (array of objects)
- `walkthrough` at the feature level instead of inside each code_block object
- Missing `explanation` field entirely

**Frontend expects:**
- `explanation` (string)
- `code_blocks` (array of `{code, language, walkthrough}`)

## Root Cause
The AI model is interpreting the prompt schema loosely — using singular `code_block` with markdown syntax instead of the structured `code_blocks` array. This is a common LLM behavior where the model paraphrases field names or simplifies nested structures.

## Done looks like
- Server-side normalization transforms the AI's actual output into the expected shape before sending to the client
- Features display their explanation text and syntax-highlighted code blocks correctly
- The normalization handles all observed AI output variations gracefully
- Prompt is further refined with field name emphasis to reduce the need for normalization

## Tasks
1. **Add server-side feature normalization** — In `server/routes.ts`, after `parseAIJson()` and before sending the response, normalize each feature in `file_breakdowns`:
   - If `code_block` (singular) exists but `code_blocks` (plural) doesn't, parse the markdown-fenced code from `code_block`, extract the language from the fence tag, strip the fences to get raw code, and construct a proper `code_blocks` array
   - If `walkthrough` exists at the feature level but not inside code_blocks, move it into each code_block
   - If `explanation` is missing, use the `walkthrough` from the feature level as the explanation (or generate a fallback)
   - Apply this normalization in all three endpoints: mentor-analyze, mentor-patch, mentor-optimize

2. **Refine prompt field names** — In `server/mentor-prompt.ts`, add explicit emphasis that the field MUST be `"code_blocks"` (plural, array) NOT `"code_block"` (singular), and that each code block must be a separate JSON object, not markdown-fenced text. Add a warning like: "⚠️ The field name is code_blocks (with an 's'), and it is an ARRAY of objects. Do NOT use code_block (without 's'). Do NOT use markdown code fences inside the code field."

## Relevant files
- `server/routes.ts` (mentor-analyze, mentor-patch, mentor-optimize response handling)
- `server/mentor-prompt.ts` (all three prompts)
- `client/src/components/ide/notebook-panel.tsx` (FeatureCard, for reference)