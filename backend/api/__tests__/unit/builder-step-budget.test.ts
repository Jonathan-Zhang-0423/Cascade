import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/agent/providers/doubao-client", () => ({
  doubaoClient: { __id: "doubao" },
  DOUBAO_MODEL: "doubao-model",
  DOUBAO_LITE_MODEL: "doubao-lite-model",
}));
vi.mock("../../src/agent/providers/minimax-client", () => ({
  minimaxClient: { __id: "minimax" },
  MINIMAX_MODEL: "minimax-model",
}));
vi.mock("../../src/agent/providers/glm-client", () => ({
  glmClient: { __id: "glm" },
  GLM_MODEL: "glm-model",
}));
vi.mock("../../src/agent/providers/deepseek-client", () => ({
  deepseekClient: { __id: "deepseek" },
  DEEPSEEK_PRO_MODEL: "deepseek-pro-model",
  DEEPSEEK_FLASH_MODEL: "deepseek-flash-model",
}));
vi.mock("../../src/agent/providers/kimi-base-client", () => ({
  kimiClient: { __id: "kimi" },
  KIMI_MODEL: "kimi-model",
}));

import { builderStepIterationBudget } from "../../src/agent/orchestrator/build-orchestrator";

describe("builder step iteration budget", () => {
  it("does not shrink per-step budget for multi-step plans", () => {
    expect(builderStepIterationBudget(1)).toBe(200);
    expect(builderStepIterationBudget(2)).toBe(200);
    expect(builderStepIterationBudget(5)).toBe(200);
    expect(builderStepIterationBudget(20)).toBe(200);
  });
});
