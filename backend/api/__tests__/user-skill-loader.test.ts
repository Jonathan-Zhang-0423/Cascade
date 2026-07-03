import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/infra/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  },
}));

vi.mock("../src/agent/tools/shell-manager", () => ({
  shellManager: { runCommand: vi.fn() },
}));

import { loadUserSkills } from "../src/skills/user-skill-loader";
import type { BuildSessionState } from "../src/agent/orchestrator/build-orchestrator";

function makeSession(files: Array<[string, string]> = []): BuildSessionState {
  return {
    id: "skill-test-session",
    files: new Map(files),
  } as unknown as BuildSessionState;
}

describe("user skill loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not inject every built-in framework skill into builder prompts", async () => {
    const loaded = await loadUserSkills(makeSession(), "project-1", "user-1");

    expect(loaded.knowledgePacks).toEqual([]);
    expect(loaded.toolSchemas).toEqual([]);
  });

  it("loads project-local skill packs only when explicitly present", async () => {
    const loaded = await loadUserSkills(
      makeSession([
        [".cascade/skills/local-guidance.md", "Use local conventions only."],
      ]),
      "project-1",
      "user-1",
    );

    expect(loaded.knowledgePacks).toEqual([
      "### User Skill: local-guidance\n\nUse local conventions only.",
    ]);
  });
});
