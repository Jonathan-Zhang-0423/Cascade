---
title: Route plan card content through Communicator Agent for user-facing localization
---
---
title: "Ensure Manager Agent outputs plan content in the user's language"
---

# Ensure Manager Agent outputs plan content in the user's language

## What & Why
The Manager Agent's system prompt says "Respond in the same language as the user" but this instruction is too weak — the AI often outputs plan JSON fields (`summary`, step `title`, `description`, `acceptance_criteria`) in English even when the user types in Chinese. The plan card then displays English content despite the UI labels being correctly localized. The fix must strengthen the prompt instructions to make language matching mandatory for ALL output fields, including structured JSON.

## Done looks like
- When a user types in Chinese (e.g. "帮我做一个贪吃蛇游戏"), the Manager Agent returns plan JSON where `summary`, step `title`s, step `description`s, `acceptance_criteria`, and `needs_input` items are ALL in Chinese
- When a user types in English, the plan content stays in English
- The fix mode prompt (`MANAGER_FIX_MODE_SYSTEM_PROMPT`) follows the same rule
- No frontend changes needed — this is purely a server-side prompt improvement

## Implementation Details

### 1. Strengthen language instruction in `MANAGER_AGENT_SYSTEM_PROMPT` (server/manager-prompt.ts)

In the existing prompt, the instruction "Respond in the same language as the user" appears in the Conversation Guidelines (line 51) and General Rules (line 85). These are easy to overlook by the AI, especially for structured JSON output.

Add a prominent, explicit instruction near the top of the prompt (right after the JSON format examples) that specifically calls out language matching for plan fields:

Add to the **Task Plan Rules** section (after existing rules around line 76):
```
### Language matching (CRITICAL)
- ALL output text must be in the same language as the user's message.
- This includes EVERY field in the JSON response: summary, step title, step description, acceptance_criteria, needs_input items, and conversational content.
- If the user writes in Chinese, your summary, titles, descriptions, and acceptance_criteria MUST all be in Chinese.
- If the user writes in English, everything must be in English.
- Only file paths and code-related identifiers (like variable names or HTML tags) stay in English.
- ⚠️ Do NOT mix languages — if the user writes in Chinese, do not output English titles or descriptions.
```

Also strengthen the existing "Respond in the same language" notes (lines 51, 85) to be more explicit.

### 2. Strengthen language instruction in `MANAGER_FIX_MODE_SYSTEM_PROMPT`

The fix mode prompt (line 89) has a similar weak instruction at line 125: "Respond in the same language as the bug report / original user request." 

Add a similar explicit language-matching rule to the Rules section of the fix mode prompt.

## Relevant files
- `server/manager-prompt.ts` — `MANAGER_AGENT_SYSTEM_PROMPT` and `MANAGER_FIX_MODE_SYSTEM_PROMPT`