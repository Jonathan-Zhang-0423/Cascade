import { describe, expect, it } from "vitest";
import { TodoLedger } from "../../src/agent/runtime/todo-ledger";

describe("TodoLedger", () => {
  it("tracks step lifecycle and touched files", () => {
    const ledger = new TodoLedger([
      { step: 1, title: "First", required_files: ["/project/a.ts"] },
      { step: 2, sub_task_id: "T2", title: "Second" },
    ]);

    ledger.start(1, 100);
    ledger.recordTouchedFile("/project/a.ts");
    ledger.complete("1", "First done", [], 200);
    ledger.start("T2", 300);

    const snap = ledger.snapshot();
    expect(snap.completedCount).toBe(1);
    expect(snap.allDone).toBe(false);
    expect(snap.steps[0]).toMatchObject({
      status: "done",
      summary: "First done",
      touchedFiles: ["/project/a.ts"],
    });
    expect(snap.steps[1]).toMatchObject({ status: "running", startedAt: 300 });
  });

  it("does not allow all_complete while a step is unfinished", () => {
    const ledger = new TodoLedger([
      { step: 1, title: "First" },
      { step: 2, title: "Second" },
    ]);

    ledger.complete(1, "done");
    expect(() => ledger.assertAllDone()).toThrow(/unfinished steps/);

    ledger.complete(2, "done");
    expect(() => ledger.assertAllDone()).not.toThrow();
  });
});
