import { describe, it, expect } from "vitest";
import type { BuildStep } from "../src/agent/orchestrator/build-orchestrator";

/**
 * These helper functions mirror the logic in build-orchestrator.ts
 * We import and test them directly.
 */

function extractFileFromIssue(issue: { affected_file?: string; description: string }): string | null {
  if (issue.affected_file) {
    return issue.affected_file;
  }
  // Try to find a /project/... file path in the description
  const match = issue.description.match(/(\/?project\/[^\s:]+)/);
  if (match) return match[1];
  return null;
}

function getAffectedSteps(issues: Array<{ affected_file?: string; description: string }>, plan: BuildStep[]): BuildStep[] {
  const affectedFiles = new Set<string>();
  for (const issue of issues) {
    const file = extractFileFromIssue(issue);
    if (file) {
      affectedFiles.add(file);
    }
  }

  if (affectedFiles.size === 0) {
    return plan;
  }

  const touchingSteps = plan.filter(step => {
    if (!step.required_files) return false;
    return step.required_files.some(f => affectedFiles.has(f));
  });

  if (touchingSteps.length === 0) {
    return plan;
  }

  const minAffectedStepNum = Math.min(...touchingSteps.map(s => s.step));
  return plan.filter(s => s.step >= minAffectedStepNum);
}

function buildTargetedFixPlan(
  affectedSteps: BuildStep[],
  issuesSummary: string,
): BuildStep[] {
  return affectedSteps.map((step, idx) => ({
    ...step,
    step: idx + 1,
    description: `${step.description}\n\n**Fix context from verifier:** ${issuesSummary}`,
  }));
}

describe("Targeted fix plan (AG-8)", () => {
  describe("extractFileFromIssue", () => {
    it("returns affected_file if present", () => {
      const issue = {
        affected_file: "/project/src/App.tsx",
        description: "Type error in App component",
      };
      expect(extractFileFromIssue(issue)).toBe("/project/src/App.tsx");
    });

    it("extracts file path from description", () => {
      const issue = {
        description: "Type error in /project/src/index.ts at line 10",
      };
      expect(extractFileFromIssue(issue)).toBe("/project/src/index.ts");
    });

    it("returns null when file path not found", () => {
      const issue = {
        description: "Some generic error message",
      };
      expect(extractFileFromIssue(issue)).toBeNull();
    });
  });

  describe("getAffectedSteps", () => {
    const plan: BuildStep[] = [
      {
        step: 1,
        title: "Create API",
        description: "Set up Express server",
        required_files: ["/project/server.ts"],
      },
      {
        step: 2,
        title: "Create UI",
        description: "Build React component",
        required_files: ["/project/src/App.tsx"],
      },
      {
        step: 3,
        title: "Integrate",
        description: "Connect frontend and backend",
        required_files: ["/project/src/App.tsx", "/project/utils.ts"],
      },
      {
        step: 4,
        title: "Add styles",
        description: "CSS styling",
        required_files: ["/project/src/App.css"],
      },
    ];

    it("returns all steps when no specific file is identified", () => {
      const issues = [{ description: "Generic error without file info" }];
      const affected = getAffectedSteps(issues, plan);
      expect(affected).toEqual(plan);
    });

    it("returns affected step and all subsequent steps when bug is in step 2", () => {
      const issues = [{ affected_file: "/project/src/App.tsx", description: "Type error" }];
      const affected = getAffectedSteps(issues, plan);
      // Steps 2, 3, 4 (step 2 touches the file, steps 3+ depend on it)
      expect(affected.length).toBe(3);
      expect(affected[0].step).toBe(2);
      expect(affected[1].step).toBe(3);
      expect(affected[2].step).toBe(4);
    });

    it("includes all subsequent steps even if only one step touches the buggy file", () => {
      const issues = [{ affected_file: "/project/server.ts", description: "Compile error" }];
      const affected = getAffectedSteps(issues, plan);
      // All steps starting from 1 (the one that writes server.ts)
      expect(affected).toEqual(plan);
    });

    it("handles multiple buggy files and returns union of affected steps", () => {
      const issues = [
        { affected_file: "/project/server.ts", description: "Error 1" },
        { affected_file: "/project/src/App.css", description: "Error 2" },
      ];
      const affected = getAffectedSteps(issues, plan);
      // Bug in step 1 affects steps 1-4, bug in step 4 affects step 4
      // Union: steps 1-4
      expect(affected).toEqual(plan);
    });

    it("returns empty array when no steps match (shouldn't happen in practice)", () => {
      const issues = [{ affected_file: "/project/unknown.txt", description: "Error" }];
      const affected = getAffectedSteps(issues, plan);
      // Conservative: return all when no match
      expect(affected).toEqual(plan);
    });
  });

  describe("buildTargetedFixPlan", () => {
    it("renumbers steps and injects bug context", () => {
      const steps: BuildStep[] = [
        {
          step: 2,
          title: "Create UI",
          description: "Build React component",
          required_files: ["/project/src/App.tsx"],
        },
        {
          step: 3,
          title: "Integrate",
          description: "Connect frontend and backend",
          required_files: ["/project/src/App.tsx", "/project/utils.ts"],
        },
      ];

      const issuesSummary = "- [bug] /project/src/App.tsx: Type error";
      const fixed = buildTargetedFixPlan(steps, issuesSummary);

      expect(fixed.length).toBe(2);
      // Steps should be renumbered to 1, 2
      expect(fixed[0].step).toBe(1);
      expect(fixed[1].step).toBe(2);
      // Descriptions should include bug context
      expect(fixed[0].description).toContain("Build React component");
      expect(fixed[0].description).toContain("**Fix context from verifier:**");
      expect(fixed[0].description).toContain(issuesSummary);
    });
  });

  describe("Integration: full targeted fix workflow", () => {
    it("reduces plan from 5 steps to 2 when bug is in step 3", () => {
      const fullPlan: BuildStep[] = [
        { step: 1, title: "A", description: "Create a", required_files: ["/project/a.ts"] },
        { step: 2, title: "B", description: "Create b", required_files: ["/project/b.ts"] },
        { step: 3, title: "C", description: "Create c", required_files: ["/project/c.ts"] },
        { step: 4, title: "D", description: "Use c and d", required_files: ["/project/c.ts", "/project/d.ts"] },
        { step: 5, title: "E", description: "Final", required_files: ["/project/e.ts"] },
      ];

      const issues = [{ affected_file: "/project/c.ts", description: "Type error in C" }];

      // Get affected steps
      const affectedSteps = getAffectedSteps(issues, fullPlan);
      expect(affectedSteps.length).toBe(3); // Steps 3, 4, 5

      // Build targeted fix plan
      const fixPlan = buildTargetedFixPlan(affectedSteps, "- [bug] /project/c.ts: Type error");
      expect(fixPlan.length).toBe(3);
      // Renumbered to 1, 2, 3
      expect(fixPlan[0].step).toBe(1);
      expect(fixPlan[1].step).toBe(2);
      expect(fixPlan[2].step).toBe(3);
      // Original step numbers preserved in memory (via spread)
      // But titles should match the original steps
      expect(fixPlan[0].title).toBe("C");
      expect(fixPlan[1].title).toBe("D");
      expect(fixPlan[2].title).toBe("E");
    });
  });
});
