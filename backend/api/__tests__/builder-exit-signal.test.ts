import { describe, it, expect, vi } from "vitest";

// agent-tools transitively pulls in providers/shell/lsp; stub the heavy/外部
// ones so importing buildBuilderTools doesn't need credentials or a container.
vi.mock("../src/agent/tools/shell-manager", () => ({
  shellManager: { runCommand: vi.fn(), ensureSession: vi.fn() },
}));

import { buildBuilderTools } from "../src/agent/tools/agent-tools";
import type { BuildSessionState } from "../src/agent/orchestrator/build-orchestrator";
import type { BuildStep } from "../src/agent/orchestrator/build-orchestrator";

function makeSession(): BuildSessionState {
  return {
    id: "s1",
    files: new Map<string, string>(),
    parts: [] as unknown[],
  } as unknown as BuildSessionState;
}

const steps: BuildStep[] = [
  { step: 1, title: "One", description: "d1" },
  { step: 2, title: "Two", description: "d2" },
];

describe("builder exit signal (finish_build bypass)", () => {
  it("trips the exit signal + emits build_complete once the LAST step is marked complete", async () => {
    const session = makeSession();
    const exitSignal = { exit: false, reason: undefined as string | undefined };
    const tools = buildBuilderTools(session, steps, undefined, exitSignal);
    const events: Array<Record<string, unknown>> = [];
    const emit = (d: Record<string, unknown>) => { events.push(d); };

    // Complete step 1 — not all done yet, signal stays false. Build completion
    // must NOT fire, and the build loop never triggers a review (review is now a
    // separate, optional step run after the build settles).
    await tools.handlers.mark_step_complete({ step_id: "1", summary: "did 1" }, emit);
    expect(exitSignal.exit).toBe(false);
    expect(events.some((e) => e.type === "build_complete")).toBe(false);
    expect(events.some((e) => e.type === "reviewing")).toBe(false);

    // Complete step 2 (the last) — signal trips and a build_complete event fires.
    // Crucially, the builder does NOT emit a review trigger of any kind.
    await tools.handlers.mark_step_complete({ step_id: "2", summary: "did 2" }, emit);
    expect(exitSignal.exit).toBe(true);
    expect(exitSignal.reason).toBe("all_steps_complete");
    expect(events.filter((e) => e.type === "build_complete").length).toBe(1);
    expect(events.some((e) => e.type === "reviewing")).toBe(false);
  });

  it("does not trip the signal when only some steps are complete", async () => {
    const session = makeSession();
    const exitSignal = { exit: false, reason: undefined as string | undefined };
    const tools = buildBuilderTools(session, steps, undefined, exitSignal);
    const emit = () => {};

    await tools.handlers.mark_step_complete({ step_id: "1", summary: "only one" }, emit);
    expect(exitSignal.exit).toBe(false);
  });

  it("is a no-op on the signal when no exitSignal is provided (back-compat)", async () => {
    const session = makeSession();
    const tools = buildBuilderTools(session, steps);
    const emit = () => {};
    // Should not throw even though the last step completes with no signal object.
    await tools.handlers.mark_step_complete({ step_id: "1", summary: "a" }, emit);
    await expect(
      tools.handlers.mark_step_complete({ step_id: "2", summary: "b" }, emit),
    ).resolves.toContain("marked complete");
  });

  it("counts duplicate completions of the same step only once", async () => {
    const session = makeSession();
    const exitSignal = { exit: false, reason: undefined as string | undefined };
    const tools = buildBuilderTools(session, steps, undefined, exitSignal);
    const emit = () => {};

    // Mark step 1 complete twice — the set must not treat that as "all done".
    await tools.handlers.mark_step_complete({ step_id: "1", summary: "x" }, emit);
    await tools.handlers.mark_step_complete({ step_id: "1", summary: "x again" }, emit);
    expect(exitSignal.exit).toBe(false);
  });
});
