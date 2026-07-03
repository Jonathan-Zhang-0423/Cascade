import { describe, expect, it } from "vitest";
import {
  buildEditorContextPacket,
  compactContextPacket,
  renderContextPacket,
} from "../../src/agent/runtime/context-packet";

describe("ContextPacket", () => {
  it("keeps preservation constraints after compaction", () => {
    const packet = buildEditorContextPacket({
      projectId: "project-1",
      files: [{ path: "/project/src/App.tsx" }],
      userIntent: "Add a dashboard",
      plan: { summary: "Build dashboard" },
      steps: [{ step: 1, title: "UI", description: "Add UI", required_files: ["/project/src/App.tsx"] }],
      completedRoundSummary: "Previous round shipped login and must be preserved.",
      projectMemory: "Implemented behavior: login, routing, and saved preferences.\n".repeat(120),
      skillContent: "Use local conventions.\n".repeat(120),
    });

    const compacted = compactContextPacket(packet, 80);
    const rendered = renderContextPacket(compacted);

    expect(rendered).toContain("## Project Identity");
    expect(rendered).toContain("## Previous Round Summary");
    expect(rendered).toContain("## Preservation Constraints");
    expect(rendered).toContain("Preserve prior user-facing behavior");
  });

  it("can omit heavy sections when they are already injected elsewhere", () => {
    const packet = buildEditorContextPacket({
      files: [{ path: "/project/index.ts" }],
      userIntent: "Refine app",
      plan: { summary: "Refine" },
      steps: [{ step: 1, title: "Refine", description: "Refine" }],
      projectMemory: "Long memory",
      skillContent: "Long skill",
      externalGuidance: "Long guidance",
    });

    const rendered = renderContextPacket(packet, {
      includeProjectMemory: false,
      includeSkillContent: false,
      includeExternalGuidance: false,
    });

    expect(rendered).toContain("## Preservation Constraints");
    expect(rendered).not.toContain("Long memory");
    expect(rendered).not.toContain("Long skill");
    expect(rendered).not.toContain("Long guidance");
  });
});
