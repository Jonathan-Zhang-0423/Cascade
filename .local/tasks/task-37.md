---
title: Fix verifier & fix-plan token truncation — max out to 16,384
---
# Fix Verifier & Fix-Plan Token Truncation

## What & Why
The holistic verifier and the manager fix-plan endpoints both have `max_tokens: 500`, which is far too low for their outputs. When a project has more than 2-3 bugs to report, the JSON response gets truncated mid-character (confirmed in production logs: response cut off inside `"file": "/project`). The server then returns `"Verifier did not return valid JSON"`, the client treats the review as null, and the communicator tells the user the review "encountered a small issue" — then enters a fix cycle with no actual bug data to fix.

The same truncation risk exists on `/api/manager-fix-plan`: if the fix plan JSON is cut off, the client receives no steps to execute and the repair cycle silently fails.

## Done looks like
- Verifier reviews complete successfully on projects with 5+ bugs — the full JSON (overall_status, bugs[], missing_features[], regressions[], summary) arrives without truncation
- The communicator correctly reports specific bugs found instead of the "small issue" fallback
- Manager fix-plan responses complete successfully and include all repair steps

## Out of scope
- Changing the verifier or manager prompt content
- Changing any other endpoint's token limits
- Changing how the client handles null review responses

## Tasks
1. **Raise verifier token limit** — In `server/routes.ts` at `/api/verifier-holistic`, change `max_tokens: 500` to `max_tokens: 4096`.
2. **Raise fix-plan token limit** — In `server/routes.ts` at `/api/manager-fix-plan`, change `max_tokens: 500` to `max_tokens: 4096`.

## Relevant files
- `server/routes.ts:362` — verifier-holistic max_tokens (currently 500)
- `server/routes.ts:419` — manager-fix-plan max_tokens (currently 500)