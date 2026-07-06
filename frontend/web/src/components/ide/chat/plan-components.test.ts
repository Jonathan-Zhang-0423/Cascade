import { describe, expect, it } from "vitest";
import {
  actionLogHasStep,
  ensureActiveStepActionLogEntry,
  latestActionLogStepNumber,
  shouldShowPlanActionLog,
} from "./plan-live-utils";
import type { ActionLogEntry } from "./chat-types";
import { collectBuildResultsForPlans } from "./ChatMessageList";

const entry = (partial: Partial<ActionLogEntry>): ActionLogEntry => ({
  type: "tool_call",
  label: "",
  detail: "",
  timestamp: 1,
  ...partial,
});

describe("historical plan build results", () => {
  it("attaches the next buildResult message to the preceding plan card", () => {
    const planMsg: any = {
      id: "plan-1",
      role: "assistant",
      content: "",
      seq: 1,
      timestamp: 1,
      plan: { summary: "Build app", steps: [{ step: 1, title: "Do it" }] },
    };
    const resultMsg: any = {
      id: "agent:s1:final",
      role: "assistant",
      content: "",
      seq: 2,
      timestamp: 2,
      buildResult: {
        actionLog: [entry({ type: "step", label: "Step 1/1: Do it", stepNum: 1 })],
        segments: [],
      },
    };

    const collected = collectBuildResultsForPlans([
      { kind: "manager", msg: planMsg },
      { kind: "manager", msg: resultMsg },
    ]);

    expect(collected.byPlanId.get("plan-1")?.id).toBe("agent:s1:final");
    expect(collected.attachedBuildResultIds.has("agent:s1:final")).toBe(true);
  });
});

describe("plan action log visibility", () => {
  it("keeps the action log visible while the plan is executing", () => {
    expect(shouldShowPlanActionLog({ isExecuting: true, hasEntries: false })).toBe(true);
  });

  it("keeps historical action logs visible without execution", () => {
    expect(shouldShowPlanActionLog({ isExecuting: false, hasEntries: true })).toBe(true);
  });

  it("injects a running step boundary before the first action arrives", () => {
    const entries = ensureActiveStepActionLogEntry({
      entries: [],
      activeStepNumber: 2,
      activeStepTitle: "Wire ActionLog",
      totalSteps: 4,
      isExecuting: true,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "step",
      stepNum: 2,
      label: "Step 2/4: Wire ActionLog",
    });
  });

  it("does not duplicate an existing step boundary", () => {
    const existing = [entry({ type: "step", label: "Step 2/4: Wire ActionLog", stepNum: 2 })];
    expect(actionLogHasStep(existing, 2)).toBe(true);
    expect(ensureActiveStepActionLogEntry({
      entries: existing,
      activeStepNumber: 2,
      isExecuting: true,
    })).toBe(existing);
  });

  it("can infer the latest active step from mixed action log entries", () => {
    expect(latestActionLogStepNumber([
      entry({ type: "step", label: "Step 1/3: First", stepNum: 1 }),
      entry({ type: "file_read", label: "a.ts", stepNum: 1 }),
      entry({ type: "file_write", label: "b.ts", stepNum: 3 }),
      entry({ type: "step", label: "Step 2/3: Second", stepNum: 2 }),
      entry({ type: "tool_call", label: "grep" }),
    ])).toBe(2);
  });
});
