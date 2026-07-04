import { describe, expect, it } from "vitest";
import { shouldRenderLiveFallback } from "./BuildLivePanel";
import { shouldShowBuildCostSummary } from "./build-live-panel-utils";
import type { ActionLogEntry } from "./chat-types";

const entry = (type: ActionLogEntry["type"]): ActionLogEntry => ({
  type,
  label: type,
  detail: "",
  timestamp: 1,
});

describe("shouldShowBuildCostSummary", () => {
  it("does not show final build metrics while the build is still running", () => {
    expect(shouldShowBuildCostSummary(false, [
      entry("step"),
      entry("file_read"),
      entry("file_write"),
    ])).toBe(false);
  });

  it("shows final build metrics only after completion and real work entries", () => {
    expect(shouldShowBuildCostSummary(true, [
      entry("step"),
      entry("thinking"),
      entry("file_write"),
    ])).toBe(true);
  });

  it("does not show metrics for completion cards that contain only structural entries", () => {
    expect(shouldShowBuildCostSummary(true, [
      entry("step"),
      entry("narration"),
      entry("thinking"),
    ])).toBe(false);
  });
});

describe("shouldRenderLiveFallback", () => {
  it("shows LiveBar when execution is active before the first token or action arrives", () => {
    expect(shouldRenderLiveFallback({ forceLive: true })).toBe(true);
  });

  it("keeps LiveBar visible when loose thinking or narration text exists", () => {
    expect(shouldRenderLiveFallback({ thinkingText: "thinking" })).toBe(true);
    expect(shouldRenderLiveFallback({ narrationText: "working" })).toBe(true);
  });

  it("does not duplicate LiveBar for completed, persisted, or already-live segment states", () => {
    expect(shouldRenderLiveFallback({ forceLive: true, isCompleted: true })).toBe(false);
    expect(shouldRenderLiveFallback({ forceLive: true, isPersisted: true })).toBe(false);
    expect(shouldRenderLiveFallback({ forceLive: true, hasLiveSegment: true })).toBe(false);
  });
});
