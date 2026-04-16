---
title: Fix build persistence & thinking stream performance
---
# Fix Build Session Persistence & Thinking Stream Performance

## What & Why
Two user-reported issues: (1) Build sessions still stop abruptly when leaving a project — the server-side session continues but the client fails to reconnect or loses state, and (2) the AI thinking/narration stream has excessive latency before the first token appears — caused by sequential blocking operations (DB query, skill detection, skill loading, context compression) that all run one after another BEFORE the LLM streaming request is initiated.

## Done looks like
- User can start a build (execute plan), navigate away from the project, and return to find the build still running or completed with all results visible
- The first thinking token arrives noticeably faster — pre-LLM blocking operations are parallelized so only the LLM's own time-to-first-token remains as latency
- The build session reconnection flow works reliably end-to-end

## Out of scope
- Changing AI model providers or model selection
- Modifying the agent loop iteration limits, tool schemas, or thinking budgets
- Restructuring the overall SSE architecture

## Tasks

1. **Parallelize pre-LLM blocking operations in manager-chat** — Currently four sequential `await` calls block before the LLM request: (a) `storage.getProject()` for framework detection, (b) `detectSkillFromText()` which reads the skills directory and does regex matching, (c) `loadSkill()` which reads a skill file from disk, (d) `compressMessages()` which makes a synchronous non-streaming LLM call for long conversations. These are largely independent and should run in parallel using `Promise.all` where possible. Specifically: framework detection + skill detection + compression should all start concurrently. Skill loading depends on detection result but can overlap with compression. This alone should cut 3-15 seconds off worst-case latency.

2. **Make context compression non-blocking for the main LLM call** — `compressMessages()` makes a synchronous (non-streaming) LLM call to Doubao when conversation history exceeds 10 messages and 25k tokens. This is the single biggest latency contributor (3-15s). Either: (a) run compression concurrently with prompt assembly so it only adds latency if it takes longer than prompt building, or (b) move compression to happen asynchronously after the stream opens but initiate the LLM call with uncompressed messages first, then use compressed on subsequent iterations. The simplest fix is (a) — `Promise.all` for compression alongside framework/skill detection.

3. **Fix manager-chat session decoupling from POST response** — The `POST /api/manager-chat` handler runs the entire agent loop within the request handler. When the client disconnects mid-stream, the `res.write` calls in the SSE writer fail silently (caught by try/catch), but if the underlying streaming response from the LLM provider throws on `for await...of` iteration due to the closed response object, the entire handler can error out. Add a guard so the agent loop continues gracefully even when all SSE writers have been removed.

4. **Fix build reconnection fallback when saved session ID is unknown** — When the user returns to a project, the reconnection useEffect checks localStorage for a saved build session ID and fetches its status. If the server returns 404 (session expired from memory), the client resets UI state but does NOT fall through to check `GET /api/build-session/active/:projectId`. This means if the server still has the session under a different lookup, the client misses it. Fix: after a 404 on the saved session ID, also try the active-project endpoint before giving up.

5. **Handle completed build sessions on reconnect** — When a build completed while the user was away, the `GET /api/build-session/active/:projectId` endpoint can return a done session with `active: false, done: true`. The client reconnection code should connect to the stream endpoint for completed sessions to replay the buffered `all_complete` and `done` events, showing the user the build result rather than silently discarding it.

## Relevant files
- `server/routes.ts:685-910`
- `server/agent-loop.ts:50-92`
- `server/context-compressor.ts`
- `server/skill-loader.ts:104-126`
- `server/retry.ts`
- `server/build-orchestrator.ts:241-290`
- `client/src/components/ide/chat/hooks/useBuildStream.ts:61-95,579-700,1359-1423`
- `client/src/components/ide/chat/hooks/useManagerStream.ts:66-105`