# Agent Quality Roadmap — Design Spec (REVISED)

**Date:** 2026-04-11 (revised 2026-04-17)
**Status:** Approved for implementation
**Branch:** `main`

---

## Direction Change (2026-04-17)

**Previous plan:** Replace CodeStart's agent pipeline with OpenCode + oh-my-opencode (OmO) as an external dependency.

**New plan:** **Keep our own backend; replicate OmO's techniques natively.** We retain full control over the agent pipeline, avoid an external runtime dependency, and implement each of OmO's quality-gate primitives as CodeStart-native tools/loops.

### Why the change

1. **We've already replicated most of it.** AG-1 through AG-8 have reimplemented Momus (plan review), Sisyphus (targeted retry), inline LSP feedback, and a verbatim-match `patch_file` that approximates Hephaestus's edit primitive. Only hash-anchored diffs remain.
2. **Lower operational risk.** No external subprocess (`opencode serve`), no SDK version churn, no cross-process state sync.
3. **Better UX integration.** Our SSE event stream, Parts model, checkpoint system, and device simulator all stay coherent.
4. **Preserves multi-provider support.** We route through Doubao / Kimi / MiniMax / GLM natively — OmO's model config would have added a translation layer.

---

## Problem (Restated)

CodeStart's baseline agent pipeline produced low-quality code output (~6–10% file edit success). OmO achieves ~68% on the same benchmark. The gap comes from four specific techniques, all of which we can implement natively.

---

## Solution: Native Replication of OmO's Quality Gates

| OmO Component | Technique | CodeStart Equivalent | Status |
|--------------|-----------|----------------------|--------|
| Momus | Plan self-review before execution | AG-4 (manager prompt addition) | ✅ Complete |
| LSP inline feedback | Diagnostics returned with write result | AG-7 (write_file/patch_file return augmentation) | ✅ Complete |
| Sisyphus | Targeted retry, only re-run failing steps | AG-8 (build-orchestrator targeted fix plan) | ✅ Complete |
| Hephaestus | Hash-anchored diff edits | AG-6 (patch_file, verbatim) + AG-16 (hash_patch_file) | Partial — AG-6 done, AG-16 pending |

AG-6 (patch_file with verbatim string match) is a weaker form of hash-anchoring — good for most cases but fragile when files change between read and write. AG-16 will complete the picture with true hash-anchored edits.

---

## Remaining Work Toward Parity

**AG-10 — Parallel step execution** (in progress)
Run independent plan steps concurrently. Steps that don't share `required_files` can execute in parallel via `Promise.all()`. Cuts build time 40–60% for multi-file plans.

**AG-11 — Framework-specific compile checks**
Extend tsc checks to flutter analyze, kotlinc, py_compile, etc.

**AG-12 — Semantic skill detection**
Replace keyword scoring in `skill-loader.ts` with a small-model LLM classification call.

**AG-13 — Multi-skill injection**
Allow multiple matching skills (e.g., react + node-express for full-stack projects).

**AG-16 — Hash-anchored verified diff tool** (the transformational one)
Implement `hash_patch_file(path, region_hash, new_content)`:
1. On file read, hash each function/block and return hash→line-range map alongside file contents.
2. New tool `hash_patch_file` finds the block whose hash matches `region_hash` and replaces it.
3. Reject with explicit error if hash not found — no silent failures.

This is Hephaestus's core primitive. With AG-16 + AG-7 + AG-8, we achieve full OmO parity without the external dependency.

---

## What Does NOT Change

- All SSE event names and the client stream handler
- `BuildSessionState` interface
- Manager/editor/verifier agent separation (we keep the three-agent model)
- Multi-provider fallback chain (Doubao → Kimi → MiniMax → GLM)
- Checkpoint + file persistence logic

## What Is Removed From the Original Spec

- OpenCode subprocess manager (`opencode serve`)
- `@opencode-ai/sdk` and `oh-my-opencode` dependencies
- Per-session tmpdir shuffling for OpenCode
- OpenCode event → CodeStart event translator

---

## Verification Plan

After each AG milestone, run:
1. `npm test` — unit suite (currently 45 tests, must stay green)
2. Manual build session with a deliberate compile error — verify fix loop converges in fewer cycles than before
3. Compare file edit accuracy against the baseline snapshot (once AG-16 lands)

---

## Rollback

All changes live on `main` behind individual commits per AG task. Any single improvement can be reverted with a targeted revert.
