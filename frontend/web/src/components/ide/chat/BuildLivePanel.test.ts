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
    expect(shouldRenderLiveFallback({ showLiveStatus: true })).toBe(true);
  });

  it("does not show a loose LiveBar for thinking or narration text alone", () => {
    expect(shouldRenderLiveFallback({ thinkingText: "thinking" })).toBe(false);
    expect(shouldRenderLiveFallback({ narrationText: "working" })).toBe(false);
  });

  it("does not duplicate LiveBar for completed, persisted, or already-live segment states", () => {
    expect(shouldRenderLiveFallback({ showLiveStatus: true, isCompleted: true })).toBe(false);
    expect(shouldRenderLiveFallback({ showLiveStatus: true, isPersisted: true })).toBe(false);
    expect(shouldRenderLiveFallback({ showLiveStatus: true, hasLiveSegment: true })).toBe(false);
  });
});
