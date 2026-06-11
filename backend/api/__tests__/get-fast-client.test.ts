import { describe, it, expect, vi, afterEach } from "vitest";

// The provider modules construct real OpenAI clients at import time and throw
// when their API key env var is missing. Mock them with sentinel objects so we
// can import getFastClient and assert which client/model it selects, without
// needing real credentials.
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

import { getFastClient } from "../src/agent/providers/kimi-client";
import { minimaxClient, MINIMAX_MODEL } from "../src/agent/providers/minimax-client";
import { doubaoClient, DOUBAO_LITE_MODEL } from "../src/agent/providers/doubao-client";

// getFastClient picks the fastest available provider for short one-off calls
// (end-of-round summaries): MiniMax when configured, else Doubao's lite model.
describe("getFastClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the MiniMax client + model when MINIMAX_API_KEY is set", () => {
    vi.stubEnv("MINIMAX_API_KEY", "test-key");
    const { client, model } = getFastClient();
    expect(client).toBe(minimaxClient);
    expect(model).toBe(MINIMAX_MODEL);
  });

  it("falls back to the Doubao lite model when MINIMAX_API_KEY is absent", () => {
    vi.stubEnv("MINIMAX_API_KEY", "");
    const { client, model } = getFastClient();
    expect(client).toBe(doubaoClient);
    expect(model).toBe(DOUBAO_LITE_MODEL);
  });
});
