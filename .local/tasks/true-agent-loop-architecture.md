# True Agent Loop Architecture Rewrite

## What & Why

CodeStart's agents are not real agents. Each is a single LLM call that emits structured text (JSON, markdown code blocks) which our code then parses and acts on. The orchestration logic — which agent to call, in what order, how many times — lives entirely in our server code, not in the model. The model responds and waits.

The learn-claude-code repository defines the real pattern: **the model drives the loop**. It is given a set of tools, it calls them, the harness executes them and feeds results back, and the model continues — autonomously — until it decides it is done (`stop_reason != "tool_use"`). The model explores, adapts, and self-corrects without us scripting every step.

This task rewrites the entire server-side agent pipeline to match this pattern:

- A generic **Agent Loop Engine** replaces scripted one-shot LLM calls
- **Tool calls** replace regex-based code extraction and JSON-in-response parsing
- The **Builder** agent writes files, reads its own output, and signals completion via tools
- The **Verifier** agent reads files directly and submits a structured verdict via tool
- The **Manager** agent submits its plan via a `submit_plan` tool rather than embedding JSON in response text
- Each agent runs until *it decides it's done*, not until our loop counter hits a ceiling

## Done looks like

- `server/agent-loop.ts` exists: a generic `runAgentLoop(systemPrompt, messages, tools, handlers, emit)` function that sends messages + tool schemas to the LLM, dispatches tool calls by name, feeds results back, and loops until `stop_reason !== "tool_use"`
- `server/agent-tools.ts` exists: all tool JSON schemas and their handler implementations for the Builder, Verifier, and Manager phases
- The Builder agent calls `write_file`, `read_file`, `mark_step_complete`, and `request_review` — no more regex extraction of code blocks from markdown
- The Verifier agent calls `read_file`, `report_issue`, and `submit_verdict` — no more `---` delimiter JSON parsing
- The Manager agent calls `submit_plan` when it's ready — no more `parseAIJson` on the response text
- `server/build-orchestrator.ts` is reduced to a thin phase runner: Manager loop → Builder loop → Verifier loop → (if fail) Builder loop again
- All existing SSE events (`code_applied`, `step_completed`, `review_passed`, `bugs_found`, `narration_token`, etc.) continue to fire, now emitted from inside tool handlers rather than from parsing code
- The frontend requires no significant changes — it sees the same SSE event types it always did
- The Builder can now read a file mid-build to verify what it wrote before moving to the next step
- The Verifier can read any file directly rather than receiving a before/after diff passed by our code

## Out of scope
- Any frontend UI changes
- Changing the Doubao API client or model selection
- Parallelizing tool calls across agents simultaneously (the loop remains single-threaded per agent phase)
- Persistent cross-session agent memory
- The Mentor Agent (notebook generation) — it is a single summarization call and does not benefit from tool looping

## Tasks

1. **Build the Agent Loop Engine** — Create `server/agent-loop.ts` with a single exported `runAgentLoop` function. It accepts: `systemPrompt`, `initialMessages`, a `tools` array (OpenAI tool schema format), a `handlers` dispatch map (`{tool_name: async (args, emit) => string}`), and `emit`. It runs the tool-dispatch while loop: call LLM with tools, if `stop_reason === "tool_use"` dispatch each tool call and append `tool_result` messages, repeat. Stream text content between tool calls as `narration_token` SSE events. Return the final assistant text when the loop exits.

2. **Define Builder tools** — In `server/agent-tools.ts`, define the JSON schemas and async handlers for the Builder agent's tools: `write_file(path, content)` (applies the file to session state, emits `code_applied`, returns confirmation), `read_file(path)` (returns file content from session state), `mark_step_complete(step_id, summary)` (emits `step_completed`), and `request_review(summary)` (signals the builder is done, emits `reviewing`, exits the loop).

3. **Define Verifier tools** — In the same `server/agent-tools.ts`, add Verifier tool schemas and handlers: `read_file(path)` (same handler), `report_issue(type, description, affected_file)` (accumulates issues in session state), and `submit_verdict(status, summary)` (emits `review_passed` or `bugs_found`, exits the loop with a structured result).

4. **Define Manager/Planning tools** — Add Manager tool schemas and handlers: `read_project_files()` (returns all current file paths and contents), and `submit_plan(steps)` (validates and normalizes the plan, emits `plan_ready`, exits the loop). The `ask_user` clarification stage remains conversational (the Manager responds in text, not via tool call, during the back-and-forth) — only plan submission moves to a tool call.

5. **Rewrite Builder system prompt** — Rewrite `server/editor-prompt.ts` to instruct a tool-using agent. Remove all instructions about markdown code block formatting. Instruct the agent to: (a) call `read_file` to understand the codebase before writing, (b) call `write_file` for each file it creates or modifies, (c) call `mark_step_complete` after each plan step, (d) call `request_review` when all steps are done. Include the plan steps and their statuses in the initial message so the agent knows what to accomplish.

6. **Rewrite Verifier system prompt** — Rewrite `server/verifier-prompt.ts` to instruct a tool-using agent. Remove all instructions about the `---` JSON delimiter format. Instruct the agent to: (a) call `read_file` on each relevant file, (b) call `report_issue` for each bug or missing feature it finds, (c) call `submit_verdict("pass")` or `submit_verdict("fail")` with a plain-language summary when done.

7. **Rewrite the Manager plan submission** — Update `server/manager-prompt.ts` to instruct the Manager to call `submit_plan(steps)` when ready to commit a plan, rather than embedding JSON in its response. Keep the conversational explore/confirm stages as plain text responses. Update the `/api/manager-chat` SSE endpoint in `server/routes.ts` to run a short agent loop (with only the Manager's tools available) instead of a single streaming call followed by `parseAIJson`.

8. **Rebuild the orchestrator as a phase runner** — Rewrite `server/build-orchestrator.ts` to use `runAgentLoop` for each phase. The new `runBuildSession` flow: (1) run Builder loop with `request_review` as the exit signal, (2) run Verifier loop with `submit_verdict` as the exit signal, (3) if verdict is "fail", run Builder loop again with the issues injected into the initial message, (4) repeat up to 3 cycles. Remove `callEditor`, `callVerifier`, `callFixPlan` — they are replaced by the loop engine plus tool handlers.

## Relevant files
- `server/build-orchestrator.ts`
- `server/routes.ts`
- `server/editor-prompt.ts`
- `server/manager-prompt.ts`
- `server/verifier-prompt.ts`
- `server/doubao-client.ts`
