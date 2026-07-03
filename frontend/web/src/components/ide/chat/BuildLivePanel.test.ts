import { describe, expect, it } from "vitest";
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
