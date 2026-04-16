# Fix All Remaining Token Truncation Issues

## What & Why

After a partial fix in task #37, two truncation problems remain:

### Problem 1 — Communicator cut off mid-message ("现在" bug)
`/api/communicator-chat` uses `max_tokens: 150` for all non-plan events.  
150 tokens (~75 Chinese characters) is enough for a single short sentence.  
However, certain events carry much heavier content:
- `bugs_found` — must narrate a list of bugs with descriptions (easily 200–500 tokens)
- `build_complete` — summary of all completed steps
- `all_complete` — full sign-off

When the 150 token ceiling is hit mid-stream, the SSE connection closes and the frontend displays a truncated message like "现在..." with nothing after it. This is the confirmed root cause of the "interrupted again half-way" symptom.

### Problem 2 — Verifier holistic not at maximum
Task #37 raised `/api/verifier-holistic` from 500 → 4096, but the user explicitly asked for the model's maximum (16,384). For large projects with many bugs this can still truncate.

The Doubao `doubao-seed-2-0-code-preview-260215` model supports **16,384 max output tokens** and a ~128K context window.

## Done looks like
- Communicator messages never appear truncated mid-sentence in the chat panel
- `bugs_found`, `build_complete`, `all_complete` events always render completely
- Verifier holistic reviews always complete for projects of any size
- No regression on the communicator's speed (token budget only affects the ceiling, not how long short messages take)

## Out of scope
- Changing communicator prompt content or message style
- Changing editor, mentor, or manager token limits
- AB-test verifier endpoint at line 944 (not in main build flow)

## Changes required (all in `server/routes.ts`)

1. **Communicator — raise non-plan events**: Line 576  
   `const maxTokens = event.event === "plan_created" ? 500 : 150;`  
   → `const maxTokens = event.event === "plan_created" ? 1024 : 512;`

2. **Verifier holistic — raise to model maximum**: Line 357  
   `max_tokens: 4096`  
   → `max_tokens: 16384`

3. **Update `replit.md` line 45**: Reflect the new actual caps.

## Relevant files
- `server/routes.ts:576` — communicator maxTokens calculation
- `server/routes.ts:357` — verifier-holistic max_tokens
- `replit.md:45` — documents max_tokens caps per agent
