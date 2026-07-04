import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({
  getProjectMemory: vi.fn(async () => ""),
  setProjectMemory: vi.fn(async () => undefined),
}));

vi.mock("../../src/infra/storage", () => ({
  storage: storageMock,
}));

import { buildManagerTools, type ManagerSessionState } from "../../src/agent/tools/agent-tools";

describe("manager project memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates project memory every time submit_plan succeeds", async () => {
    storageMock.getProjectMemory.mockResolvedValueOnce("## Implemented Behavior\n- Keep login intact.");
    const state: ManagerSessionState = {};
    const { handlers } = buildManagerTools(state, { projectId: "project-1", userId: "user-1" });

    const result = await handlers.submit_plan({
      summary: "Add settings panel",
      what_and_why: "Let users configure preferences without changing existing login.",
      relevant_files: ["/project/src/App.tsx"],
      steps: [
        {
          step: 1,
          title: "Add settings UI",
          description: "Read the existing file first and preserve all current content.",
          required_files: ["/project/src/App.tsx"],
        },
      ],
    }, () => {});

    expect(result).toContain("Plan submitted successfully");
    expect(storageMock.getProjectMemory).toHaveBeenCalledWith("project-1");
    expect(storageMock.setProjectMemory).toHaveBeenCalledTimes(1);
    const [, , content] = storageMock.setProjectMemory.mock.calls[0];
    expect(content).toContain("## Implemented Behavior");
    expect(content).toContain("<!-- cascade:latest-plan -->");
    expect(content).toContain("Summary: Add settings panel");
    expect(content).toContain("/project/src/App.tsx");
    expect(state.memoryTouched).toBe(true);
  });

  it("replaces the previous latest plan section instead of appending duplicates", async () => {
    storageMock.getProjectMemory.mockResolvedValueOnce([
      "## Implemented Behavior",
      "- Existing app.",
      "",
      "<!-- cascade:latest-plan -->",
      "## Latest Plan",
      "Summary: Old plan",
    ].join("\n"));
    const { handlers } = buildManagerTools({}, { projectId: "project-1", userId: "user-1" });

    await handlers.submit_plan({
      summary: "New plan",
      steps: [{ step: 1, title: "Do new work", description: "Preserve existing code." }],
    }, () => {});

    const [, , content] = storageMock.setProjectMemory.mock.calls[0];
    expect(content.match(/cascade:latest-plan/g)?.length).toBe(1);
    expect(content).toContain("Summary: New plan");
    expect(content).not.toContain("Summary: Old plan");
  });
});
