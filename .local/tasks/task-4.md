---
title: Agent pipeline performance optimization
---
# Agent Pipeline Performance Optimization

## What & Why
The AI agent pipeline is slow during both Plan Mode conversations and Build Mode execution. Root cause analysis identified 6 bottlenecks, with the biggest being ~19 sequential blocking Communicator API calls during plan execution (adding 40-95 seconds of pure overhead). This task implements targeted optimizations to dramatically reduce response times.

## Done looks like
- Plan execution feels noticeably faster — narration no longer blocks code generation
- Simple Plan Mode conversations respond faster with max_tokens caps
- Streaming code output feels smoother with throttled UI updates
- No regressions in functionality — all agent features still work correctly

## Out of scope
- Changing the AI model or provider
- Reducing the number of agent roles (Manager, Editor, Verifier, Communicator)
- Changing the fundamental architecture of the 4-agent system
- Caching or memoizing AI responses

## Tasks
1. **Make Communicator calls non-blocking** — Convert `callCommunicator` from blocking `await` to fire-and-forget for informational events (`step_starting`, `step_completed`, `build_starting`, `build_complete`, `reviewing`, `review_passed`, `bugs_found`, `fixing`, `all_complete`). Only keep `await` for events that need a result before proceeding (`needs_input`). This alone should cut 40-95 seconds from a typical build.

2. **Add max_tokens limits to all API endpoints** — Set appropriate `max_tokens` on each Doubao API call: ~150 for Communicator (1-3 sentences), ~100 for Manager conversation mode, ~800 for Manager plan mode, ~500 for Verifier, ~500 for Manager fix plan. This prevents over-generation and speeds up short responses.

3. **Filter Manager conversation history** — When sending messages to `/api/manager-chat`, exclude Communicator narration messages (source: "communicator") from the conversation history. Only send actual user messages and plan/assistant responses. This reduces token count and speeds up Manager responses.

4. **Throttle streaming UI updates** — Batch `updateLastAssistantMessage` calls to ~16ms intervals (60fps) instead of every SSE chunk. Throttle `extractCodeBlocks` regex parsing to only run when a code fence marker is detected in the new chunk content, rather than on every chunk.

5. **Send only relevant files to Editor** — When executing a plan subtask, parse the step description for file path references and only send those files (plus index.html as fallback) instead of all project files. Fall back to sending all files if no paths are detected.

## Relevant files
- `server/routes.ts`
- `server/doubao-client.ts`
- `client/src/components/ide/chat-panel.tsx:1136-1214`
- `client/src/components/ide/chat-panel.tsx:1274-1396`
- `client/src/components/ide/chat-panel.tsx:1467-1716`