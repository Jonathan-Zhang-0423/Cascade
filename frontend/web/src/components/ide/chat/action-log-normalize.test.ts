import { describe, expect, it } from "vitest";
import {
  compactBuildResultForPersistence,
  normalizeActionLogEntry,
  rebuildSegmentsFromActionLog,
  stringifyLogValue,
} from "./action-log-normalize";

describe("action log normalization", () => {
  it("coerces non-string action fields into render-safe strings", () => {
    const normalized = normalizeActionLogEntry({
      type: "file_read",
      label: { tool: "read_file" },
      detail: ["a", "b"],
      timestamp: 123,
      filePath: { path: "/project/App.tsx" },
      precedingNarration: 42,
      stepNum: 4,
    } as any);

    expect(normalized).toMatchObject({
      type: "file_read",
      label: "{\"tool\":\"read_file\"}",
      detail: "[\"a\",\"b\"]",
      timestamp: 123,
      filePath: "{\"path\":\"/project/App.tsx\"}",
      precedingNarration: "42",
      stepNum: 4,
    });
  });

  it("falls back safely for invalid types and circular objects", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const normalized = normalizeActionLogEntry({
      type: "not_a_real_type",
      label: circular,
      detail: null,
      timestamp: Number.NaN,
    } as any);

    expect(normalized.type).toBe("tool_call");
    expect(normalized.label).toBe("[object Object]");
    expect(normalized.detail).toBe("");
    expect(Number.isFinite(normalized.timestamp)).toBe(true);
  });

  it("stringifies primitive values without JSON quotes", () => {
    expect(stringifyLogValue(10)).toBe("10");
    expect(stringifyLogValue(true)).toBe("true");
    expect(stringifyLogValue("tool")).toBe("tool");
    expect(stringifyLogValue(undefined, "fallback")).toBe("fallback");
  });

  it("rebuilds persisted segments from stepNum when a refresh collapsed them", () => {
    const rebuilt = rebuildSegmentsFromActionLog(
      [
        { type: "file_read", label: "A.tsx", detail: "", timestamp: 1, stepNum: 1 },
        { type: "file_write", label: "B.tsx", detail: "", timestamp: 2, stepNum: 2 },
        { type: "tool_call", label: "finish_build", detail: "", timestamp: 3, stepNum: 2 },
      ],
      [{
        id: "collapsed",
        narration: "collapsed",
        actions: [],
        isLive: false,
      }],
    );

    expect(rebuilt).toHaveLength(2);
    expect(rebuilt?.[0]).toMatchObject({ id: "1", actions: [{ label: "A.tsx" }] });
    expect(rebuilt?.[1]).toMatchObject({ id: "2", actions: [{ label: "B.tsx" }, { label: "finish_build" }] });
  });

  it("rebuilds persisted segments from explicit step boundary entries", () => {
    const rebuilt = rebuildSegmentsFromActionLog(
      [
        { type: "step", label: "Step 1/2: First", detail: "", timestamp: 1 },
        { type: "file_read", label: "A.tsx", detail: "", timestamp: 2 },
        { type: "step", label: "Step 2/2: Second", detail: "", timestamp: 3 },
        { type: "file_write", label: "B.tsx", detail: "", timestamp: 4 },
      ],
      [{
        id: "collapsed",
        narration: "collapsed",
        actions: [],
        isLive: false,
      }],
    );

    expect(rebuilt).toHaveLength(2);
    expect(rebuilt?.[0]).toMatchObject({ stepLabel: "Step 1/2: First", actions: [{ label: "A.tsx" }] });
    expect(rebuilt?.[1]).toMatchObject({ stepLabel: "Step 2/2: Second", actions: [{ label: "B.tsx" }] });
  });

  it("compacts build results before message persistence while preserving step structure", () => {
    const huge = "x".repeat(50_000);
    const compacted = compactBuildResultForPersistence({
      actionLog: [
        { type: "file_read", label: "index.html", detail: huge, timestamp: 1, stepNum: 1 },
        { type: "file_write", label: "app.js", detail: huge, timestamp: 2, stepNum: 2 },
      ],
      segments: [{
        id: "2",
        narration: huge,
        actions: [{ type: "file_write", label: "app.js", detail: huge, timestamp: 2, stepNum: 2 }],
        isLive: false,
        stepLabel: "Step 2/2: Build UI",
      }],
      completionData: { changedFiles: ["/project/app.js"], summary: "done" },
    });

    expect(compacted.actionLog[0].detail.length).toBeLessThan(2500);
    expect(compacted.actionLog[1].detail.length).toBeLessThan(1500);
    expect(compacted.actionLog[1].stepNum).toBe(2);
    expect(compacted.segments[0].stepLabel).toBe("Step 2/2: Build UI");
    expect(compacted.segments[0].actions[0].stepNum).toBe(2);
    expect(JSON.stringify(compacted).length).toBeLessThan(10_000);
  });
});
