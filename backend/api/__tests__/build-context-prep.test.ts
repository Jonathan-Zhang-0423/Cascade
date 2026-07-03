import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/providers/doubao-client", () => ({
  doubaoClient: { __id: "doubao" },
  DOUBAO_MODEL: "doubao-model",
  DOUBAO_LITE_MODEL: "doubao-lite-model",
}));
vi.mock("../src/agent/providers/minimax-client", () => ({
  minimaxClient: { __id: "minimax" },
  MINIMAX_MODEL: "minimax-model",
}));
vi.mock("../src/agent/providers/glm-client", () => ({
  glmClient: { __id: "glm" },
  GLM_MODEL: "glm-model",
}));
vi.mock("../src/agent/providers/deepseek-client", () => ({
  deepseekClient: { __id: "deepseek" },
  DEEPSEEK_PRO_MODEL: "deepseek-pro-model",
  DEEPSEEK_FLASH_MODEL: "deepseek-flash-model",
}));

vi.mock("../src/skills/loader", () => ({
  getSkillForFramework: vi.fn(() => "react"),
  detectSkillsFromText: vi.fn(async () => ["react"]),
  loadSkills: vi.fn(async (names: string[]) => names.map((n) => `tech:${n}`).join("\n")),
}));

vi.mock("../src/skills/capability-loader", () => ({
  detectCapabilitiesDetailed: vi.fn(async () => [
    { name: "frontend-design", score: 5, tier: "full", matched: ["ui"] },
  ]),
  loadCapabilitiesTiered: vi.fn(async () => "capability:frontend-design"),
}));

vi.mock("../src/skills/user-skill-loader", () => ({
  loadUserSkills: vi.fn(async () => ({
    knowledgePacks: ["### User Skill: local\n\nUse local conventions."],
    toolSchemas: [],
    toolHandlers: {},
  })),
}));

vi.mock("../src/infra/storage", () => ({
  storage: {
    getProjectMemory: vi.fn(async () => "memory:project"),
  },
  PROJECT_MEMORY_MAX: 12000,
}));

vi.mock("../src/agent/tools/lsp-manager", () => ({
  lspManager: { start: vi.fn(), stop: vi.fn(), notifyFileChange: vi.fn() },
}));
vi.mock("../src/agent/tools/shell-manager", () => ({
  shellManager: { createShell: vi.fn(), destroyShell: vi.fn(), runCommand: vi.fn() },
}));

import { prepareBuildContext, type BuildSessionState, type BuildStep } from "../src/agent/orchestrator/build-orchestrator";
import { detectCapabilitiesDetailed, loadCapabilitiesTiered } from "../src/skills/capability-loader";

function makeSession(overrides: Partial<BuildSessionState> = {}): BuildSessionState {
  return {
    id: "prep-session",
    projectId: "project-1",
    userId: "user-1",
    aborted: false,
    files: new Map(),
    plan: { summary: "Build UI", steps: [] },
    userRequest: "Build a nice React UI",
    userLang: "English",
    events: [],
    nextEventId: 0,
    done: false,
    sseWriters: new Set(),
    parts: [],
    status: { type: "idle" },
    framework: "web",
    ...overrides,
  } as BuildSessionState;
}

const steps: BuildStep[] = [
  { step: 1, title: "Create UI", description: "Create /project/src/App.tsx" },
];

describe("build context preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("combines tech, capability, memory, and user skills in a deterministic order", async () => {
    const prepared = await prepareBuildContext(makeSession(), steps, ["doubao"]);

    expect(prepared.projectMemory).toBe("memory:project");
    expect(prepared.skillContent).toBe([
      "tech:react",
      "---",
      "capability:frontend-design",
      "---",
      "### User Skill: local\n\nUse local conventions.",
    ].join("\n\n"));
    expect(prepared.activeCapabilities).toEqual([
      { name: "frontend-design", score: 5, tier: "full" },
    ]);
  });

  it("preserves precomputed skillContent without re-detecting system skills", async () => {
    const prepared = await prepareBuildContext(
      makeSession({ skillContent: "precomputed skills" }),
      steps,
      ["doubao"],
    );

    expect(prepared.skillContent).toContain("precomputed skills");
    expect(prepared.skillContent).toContain("### User Skill: local");
    expect(prepared.skillContent).not.toContain("capability:frontend-design");
    expect(detectCapabilitiesDetailed).not.toHaveBeenCalled();
    expect(loadCapabilitiesTiered).not.toHaveBeenCalled();
  });
});
