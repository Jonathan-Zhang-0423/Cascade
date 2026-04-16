---
name: Agent architecture comparison — CodeStart vs OpenCode/OmO
description: Detailed comparison of CodeStart's agent pipeline vs OmO's multi-agent system; gaps, strengths, and the ordered improvement roadmap
type: project
---

## What OmO (oh-my-opencode) Is

OmO is a plugin for OpenCode (`npm install oh-my-opencode`) that replaces OpenCode's default agent with a multi-agent pipeline. It is NOT a standalone product — it adds a "pantheon" of specialized agents on top of OpenCode's server process (`opencode serve`).

## OmO's Agent Pantheon

| OmO Agent | CodeStart Equivalent | Key difference |
|-----------|---------------------|----------------|
| **Prometheus** (planner) | Manager agent | Prometheus validates plans with Momus BEFORE code is written; our manager just produces the plan |
| **Hephaestus** (executor) | Editor agent | Hephaestus uses **hash-anchored diffs** (~68% accuracy); we use full file rewrites (~6% accuracy) |
| **Momus** (reviewer) | Verifier agent | Momus runs INLINE during execution + reviews plans pre-build; ours is post-hoc only |
| **Sisyphus** (retry) | Fixer loop | Sisyphus retries specific failing edits with context; our fixer blindly re-runs the whole editor |
| **Sisyphus-Junior** (completion check) | — | No CodeStart equivalent |
| **Atlas** (secondary executor) | — | No CodeStart equivalent |

## The Core Gap: File Edit Accuracy

| Edit approach | Typical accuracy |
|--------------|-----------------|
| Full file rewrite (CodeStart current) | ~6–10% |
| Naive string-match diff | ~30–40% |
| Hash-anchored verified diff (OmO/Hephaestus) | ~68% |
| Hash-anchored + LSP feedback inline | Highest |

The LLM failure mode with full rewrites: on files >200 lines, models truncate, hallucinate lines, and drift.

## What CodeStart Has That OmO Doesn't

- Part-based message model (already implemented in server/parts.ts, mirroring OpenCode's model)
- SessionStatus tracking (idle | busy | error)
- Multi-framework support (React Native, Flutter, Kotlin, SwiftUI)
- LSP servers per-session (typescript-language-server, dart analysis server)
- AST-grep tools (ast_search, ast_replace)
- Shell/Docker sandbox (shell_run)
- Mobile device simulator UI
- Multi-AI-provider fallback chain (Doubao, Kimi, MiniMax, GLM)
- Language-aware prompting (EN, ZH, JA, KO, ES, FR, DE, PT, RU)

## Current CodeStart Agent Flow

```
POST /api/manager-chat
  → Manager agent (1-10 LLM calls)
    Stage 1: Explore (ask questions)
    Stage 2: Confirm (show interpretation)
    Stage 3: Plan (submit_plan tool → BuildPlan JSON)
  → Editor agent (N LLM calls, ~1 per 2-3 steps)
    read_file → write_file (FULL content) → mark_step_complete → request_review
  → Verifier agent (1 LLM call)
    read_file → lsp_diagnostics → report_issue → submit_verdict
  → [If fail] Fixer agent (N LLM calls, re-runs editor with bug report)
  → [Up to 3 fix cycles]
```

## Speed Gaps

1. Full file rewrites = wasted tokens on unchanged content
2. No parallel step execution (sequential even for independent steps)
3. LSP only invoked ad-hoc, not after every write
4. No shared subprocess — each session re-initializes everything
5. 90s LLM timeout for extended-thinking models can block UX

## Accuracy Gaps

1. Full file rewrite vs hash-anchored diff (the biggest gap — 6% vs 68%)
2. Plan validation happens AFTER planning, not before execution (Momus reviews plan before Hephaestus starts)
3. Fixer is context-blind — re-runs entire editor rather than retrying specific failing edit
4. No inline LSP feedback loop — editor moves on even if the file it just wrote has type errors
5. Shell_run (tsc --noEmit) not called by default before request_review

## Testing/Verification Gaps

1. No TDD loop — no "write failing test first, implement until green" workflow
2. shell_run exists but agents aren't strongly instructed to use it by default
3. Verifier reads files but doesn't automatically run the project's test suite
4. No automated regression test runner integrated into the fix loop

## Improvement Roadmap (ordered by 2x2: importance × implementation complexity)

See Progress.txt MP-16 section for the full ordered task list.

**Why**: recorded 2026-04-16 after comparing our agent pipeline against OmO's architecture.
**How to apply**: Use this as the reference when prioritizing agent improvement work.
