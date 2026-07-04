import { describe, expect, it } from "vitest";
import { shouldUseLivePlanStatuses } from "./ChatMessageList";

describe("shouldUseLivePlanStatuses", () => {
  it("uses live statuses only for the latest unfinished plan", () => {
    expect(shouldUseLivePlanStatuses({ id: "p2", plan: {} }, "p2")).toBe(true);
    expect(shouldUseLivePlanStatuses({ id: "p1", plan: {} }, "p2")).toBe(false);
  });

  it("does not let later direct builds mutate a completed frozen plan", () => {
    expect(shouldUseLivePlanStatuses({
      id: "p1",
      plan: {},
      frozenTaskStatuses: { "1": "done", "2": "done", "3": "done" },
    }, "p1")).toBe(false);
  });
});
