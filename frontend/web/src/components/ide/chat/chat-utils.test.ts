import { describe, it, expect } from "vitest";
import { buildManagerHistory } from "./chat-utils";

/**
 * buildManagerHistory compresses a completed build round into a one-line
 * summary so the manager planner focuses on the user's NEW request instead of
 * re-surfacing the previous round's plan (the "asks about last round's issues"
 * bug). These lock that contract.
 */
describe("buildManagerHistory", () => {
  const u = (content: string) => ({ role: "user", content });
  const a = (content: string, extra: Record<string, unknown> = {}) => ({ role: "assistant", content, ...extra });

  it("passes through history verbatim when there is no completed build", () => {
    const msgs = [u("build a todo app"), a("here's a plan")];
    const out = buildManagerHistory(msgs);
    expect(out).toEqual([
      { role: "user", content: "build a todo app" },
      { role: "assistant", content: "here's a plan" },
    ]);
  });

  it("drops typing placeholders and empty-content messages", () => {
    const msgs = [u("do it"), a("", { typing: true }), a("real reply")];
    const out = buildManagerHistory(msgs);
    expect(out).toEqual([
      { role: "user", content: "do it" },
      { role: "assistant", content: "real reply" },
    ]);
  });

  it("compresses everything up to and including a buildResult into one summary", () => {
    const msgs = [
      u("build a calculator"),
      a("planning the calculator"),
      a("", { buildResult: { changedFiles: ["a.js"] } }), // round 1 done
      u("now add a dark mode toggle"),                      // NEW request
    ];
    const out = buildManagerHistory(msgs);
    // First entry is the compressed summary referencing the previous user ask.
    expect(out[0].role).toBe("assistant");
    expect(out[0].content).toContain("Previous round completed");
    expect(out[0].content).toContain("build a calculator");
    // The new request survives verbatim and is the only thing after the summary.
    expect(out.slice(1)).toEqual([{ role: "user", content: "now add a dark mode toggle" }]);
    // Crucially, the old plan text is NOT present — no contamination.
    expect(JSON.stringify(out)).not.toContain("planning the calculator");
  });

  it("uses the LAST completed round when several builds happened", () => {
    const msgs = [
      u("first feature"),
      a("", { buildResult: {} }),
      u("second feature"),
      a("", { buildResult: {} }), // most recent completed round
      u("third feature"),         // current request
    ];
    const out = buildManagerHistory(msgs);
    expect(out[0].content).toContain("second feature"); // summary anchors on the latest round
    expect(out.slice(1)).toEqual([{ role: "user", content: "third feature" }]);
  });

  it("handles a buildResult as the very last message (no trailing request yet)", () => {
    const msgs = [u("build it"), a("", { buildResult: {} })];
    const out = buildManagerHistory(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain("Previous round completed");
    expect(out[0].content).toContain("build it");
  });

  it("falls back to a generic summary when no prior user message exists", () => {
    const msgs = [a("", { buildResult: {} }), u("new thing")];
    const out = buildManagerHistory(msgs);
    expect(out[0].content).toContain("Previous round completed");
    expect(out.slice(1)).toEqual([{ role: "user", content: "new thing" }]);
  });
});
