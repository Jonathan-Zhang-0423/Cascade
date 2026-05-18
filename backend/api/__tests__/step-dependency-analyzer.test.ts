import { describe, it, expect } from "vitest";
import { groupStepsIntoWaves, hasParallelOpportunity } from "../src/agent/orchestrator/step-dependency-analyzer";
import type { BuildStep } from "../src/agent/orchestrator/build-orchestrator";

describe("AG-10 step dependency analyzer", () => {
  describe("groupStepsIntoWaves", () => {
    it("returns empty array for empty input", () => {
      expect(groupStepsIntoWaves([])).toEqual([]);
    });

    it("puts a single step in wave 0", () => {
      const steps: BuildStep[] = [
        { step: 1, title: "A", description: "", required_files: ["/project/a.ts"] },
      ];
      const waves = groupStepsIntoWaves(steps);
      expect(waves).toHaveLength(1);
      expect(waves[0].index).toBe(0);
      expect(waves[0].steps).toHaveLength(1);
    });

    it("groups steps with disjoint files into the same wave", () => {
      const steps: BuildStep[] = [
        { step: 1, title: "A", description: "", required_files: ["/project/a.ts"] },
        { step: 2, title: "B", description: "", required_files: ["/project/b.ts"] },
        { step: 3, title: "C", description: "", required_files: ["/project/c.ts"] },
      ];
      const waves = groupStepsIntoWaves(steps);
      expect(waves).toHaveLength(1);
      expect(waves[0].steps.map((s) => s.step)).toEqual([1, 2, 3]);
    });

    it("splits dependent steps into sequential waves", () => {
      const steps: BuildStep[] = [
        { step: 1, title: "A", description: "", required_files: ["/project/shared.ts"] },
        { step: 2, title: "B", description: "", required_files: ["/project/shared.ts"] },
      ];
      const waves = groupStepsIntoWaves(steps);
      expect(waves).toHaveLength(2);
      expect(waves[0].steps[0].step).toBe(1);
      expect(waves[1].steps[0].step).toBe(2);
    });

    it("handles mixed parallel and sequential dependencies", () => {
      // Plan: 1 creates A, 2 creates B (parallel), 3 modifies A (depends on 1),
      // 4 creates C (parallel with 3).
      const steps: BuildStep[] = [
        { step: 1, title: "Create A", description: "", required_files: ["/project/a.ts"] },
        { step: 2, title: "Create B", description: "", required_files: ["/project/b.ts"] },
        { step: 3, title: "Modify A", description: "", required_files: ["/project/a.ts"] },
        { step: 4, title: "Create C", description: "", required_files: ["/project/c.ts"] },
      ];
      const waves = groupStepsIntoWaves(steps);
      expect(waves).toHaveLength(2);
      // Wave 0: steps 1, 2, 4 (all independent)
      expect(waves[0].steps.map((s) => s.step).sort()).toEqual([1, 2, 4]);
      // Wave 1: step 3 (depends on step 1)
      expect(waves[1].steps.map((s) => s.step)).toEqual([3]);
    });

    it("handles transitive dependencies via shared files", () => {
      // 1 creates a, 2 modifies a (depends 1), 3 modifies a (depends 2)
      const steps: BuildStep[] = [
        { step: 1, title: "Create", description: "", required_files: ["/project/a.ts"] },
        { step: 2, title: "Modify", description: "", required_files: ["/project/a.ts"] },
        { step: 3, title: "Finalize", description: "", required_files: ["/project/a.ts"] },
      ];
      const waves = groupStepsIntoWaves(steps);
      expect(waves).toHaveLength(3);
      expect(waves[0].steps[0].step).toBe(1);
      expect(waves[1].steps[0].step).toBe(2);
      expect(waves[2].steps[0].step).toBe(3);
    });

    it("treats steps without required_files as safely parallel", () => {
      // Steps missing required_files can't be proven to conflict; current
      // behavior parallelizes them. The prompt guidance should still encourage
      // planners to fill required_files.
      const steps: BuildStep[] = [
        { step: 1, title: "A", description: "" },
        { step: 2, title: "B", description: "" },
      ];
      const waves = groupStepsIntoWaves(steps);
      expect(waves).toHaveLength(1);
      expect(waves[0].steps).toHaveLength(2);
    });

    it("steps with shared file across multi-file required_files detect the dep", () => {
      const steps: BuildStep[] = [
        { step: 1, title: "A", description: "", required_files: ["/project/a.ts", "/project/shared.ts"] },
        { step: 2, title: "B", description: "", required_files: ["/project/b.ts"] },
        { step: 3, title: "C", description: "", required_files: ["/project/c.ts", "/project/shared.ts"] },
      ];
      const waves = groupStepsIntoWaves(steps);
      expect(waves).toHaveLength(2);
      expect(waves[0].steps.map((s) => s.step).sort()).toEqual([1, 2]);
      expect(waves[1].steps.map((s) => s.step)).toEqual([3]);
    });

    it("preserves plan order within a single wave", () => {
      const steps: BuildStep[] = [
        { step: 3, title: "C", description: "", required_files: ["/project/c.ts"] },
        { step: 1, title: "A", description: "", required_files: ["/project/a.ts"] },
        { step: 2, title: "B", description: "", required_files: ["/project/b.ts"] },
      ];
      const waves = groupStepsIntoWaves(steps);
      expect(waves).toHaveLength(1);
      // Input order preserved (planner's order is authoritative)
      expect(waves[0].steps.map((s) => s.step)).toEqual([3, 1, 2]);
    });
  });

  describe("hasParallelOpportunity", () => {
    it("returns false when every wave has exactly one step", () => {
      const steps: BuildStep[] = [
        { step: 1, title: "A", description: "", required_files: ["/project/a.ts"] },
        { step: 2, title: "B", description: "", required_files: ["/project/a.ts"] },
      ];
      expect(hasParallelOpportunity(groupStepsIntoWaves(steps))).toBe(false);
    });

    it("returns true when any wave has 2+ steps", () => {
      const steps: BuildStep[] = [
        { step: 1, title: "A", description: "", required_files: ["/project/a.ts"] },
        { step: 2, title: "B", description: "", required_files: ["/project/b.ts"] },
      ];
      expect(hasParallelOpportunity(groupStepsIntoWaves(steps))).toBe(true);
    });

    it("returns false for an empty plan", () => {
      expect(hasParallelOpportunity([])).toBe(false);
    });
  });
});
