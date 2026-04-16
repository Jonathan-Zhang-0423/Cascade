# Fix Plan Mode Raw JSON Output Regression

## Problem
After Task #4's performance optimization, Plan Mode displays raw JSON in the chat instead of rendering proper plan cards. The Manager endpoint's `max_tokens` heuristic (`looksLikeBuildRequest` regex) is too narrow — it misclassifies many valid build requests as conversation, applies a 100-token cap, truncates the plan JSON mid-stream, causes `parseAIJson` to fail, and the raw truncated JSON falls through to be displayed as a plain message.

Example user input that triggers the bug: any request not matching the narrow keyword list (e.g., "我想添加一个功能" — "添加" isn't in the regex).

## Root Cause
In `server/routes.ts` lines 177-181:
```typescript
const looksLikeBuildRequest = /\b(build|create|make|implement|add|写|做|创建|搭建|帮我)\b/i.test(lastUserMsg);
const managerMaxTokens = looksLikeBuildRequest ? 800 : 100;
```
The 100-token cap is too low to contain even a minimal plan JSON response. When the heuristic fails to match, the response is truncated.

## Fix
Remove the `looksLikeBuildRequest` heuristic and the dynamic token logic. Replace with a single `max_tokens: 800` for all `/api/manager-chat` requests. This is safe for both conversation responses (which are typically short and stop naturally before hitting 800) and plan responses (which need the full budget).

### Changes
- **`server/routes.ts`**: Remove lines 179-181 (`lastUserMsg`, `looksLikeBuildRequest`, `managerMaxTokens`). Set `max_tokens: 800` directly in the API call.
- **`replit.md`**: Update the Performance Optimizations section to reflect Manager=800 (single value, no heuristic).

## Verification
1. In Plan mode, send a Chinese build request like "我想添加用户注册登录功能" → should display a proper plan card, not raw JSON
2. In Plan mode, send a conversational question like "What features should I add?" → should display a normal chat response
3. In Plan mode, send an English build request like "Build a todo list" → should display a proper plan card
