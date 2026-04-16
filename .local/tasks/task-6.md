---
title: Fix Plan Mode message truncation
---
# Fix Plan Mode Message Truncation

## Problem
Plan Mode conversation responses get cut off mid-sentence because `max_tokens: 800` is too low, especially for Chinese text where each character consumes more tokens.

## Fix
In `server/routes.ts`, increase `max_tokens` for the `/api/manager-chat` endpoint from 800 to 4096. This allows the model to generate complete responses without truncation. Short conversational replies will still stop naturally (the model emits a stop token), so a higher cap has no downside — it only prevents premature cutoff.

### Changes
- **`server/routes.ts`**: Change `max_tokens: 800` → `max_tokens: 4096` in the `/api/manager-chat` endpoint.
- **`replit.md`**: Update the max_tokens documentation line to reflect Manager=4096.

## Verification
1. In Plan mode, send a request that triggers a long response in Chinese
2. Verify the response completes fully without being cut off mid-sentence
3. Short conversational replies should still work normally (model stops on its own)