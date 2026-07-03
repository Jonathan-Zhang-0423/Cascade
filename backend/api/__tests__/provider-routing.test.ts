import { afterEach, describe, expect, it, vi } from "vitest";

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

import { buildFallbackChain, getOptimalClient, isProviderConfigured } from "../src/agent/providers/kimi-client";

describe("provider routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("filters unconfigured providers out of role fallback chains", () => {
    vi.stubEnv("GLM_API_KEY", "");
    vi.stubEnv("KIMI_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("MINIMAX_API_KEY", "");

    expect(buildFallbackChain("editor", "glm")).toEqual(["doubao"]);
  });

  it("keeps the user provider first when it is configured, then role-appropriate fallbacks", () => {
    vi.stubEnv("GLM_API_KEY", "glm-key");
    vi.stubEnv("KIMI_API_KEY", "kimi-key");
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
    vi.stubEnv("MINIMAX_API_KEY", "");

    expect(buildFallbackChain("editor", "kimi")).toEqual(["kimi", "glm", "doubao", "deepseek-flash"]);
  });

  it("lets verifier prefer fast review specialists when the selected provider is unavailable", () => {
    vi.stubEnv("GLM_API_KEY", "");
    vi.stubEnv("KIMI_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
    vi.stubEnv("MINIMAX_API_KEY", "minimax-key");

    expect(buildFallbackChain("verifier", "glm")).toEqual(["deepseek-flash", "minimax", "doubao"]);
  });

  it("reports provider availability from environment configuration", () => {
    vi.stubEnv("GLM_API_KEY", "glm-key");
    vi.stubEnv("KIMI_API_KEY", "");

    expect(isProviderConfigured("glm")).toBe(true);
    expect(isProviderConfigured("kimi")).toBe(false);
    expect(isProviderConfigured("doubao")).toBe(true);
  });

  it("getOptimalClient skips an unconfigured user preference", () => {
    vi.stubEnv("GLM_API_KEY", "");
    vi.stubEnv("KIMI_API_KEY", "kimi-key");

    const { model } = getOptimalClient("planning", "glm");
    expect(model).toBe("kimi-k2.5");
  });
});
