import { describe, it, expect, vi } from "vitest";

// The review-orchestrator transitively imports provider modules that construct
// real OpenAI clients at import time and throw without API keys. Mock them with
// sentinels so we can import the pure isBlocking helper without credentials.
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
vi.mock("../../src/agent/providers/kimi-client", () => ({
  kimiClient: { __id: "kimi" },
  KIMI_MODEL: "kimi-model",
  buildFallbackChain: () => [],
  withFallback: async () => undefined,
  getFastClient: () => ({ client: { __id: "fast" }, model: "fast-model" }),
}));

import {
  isBlocking,
  REVIEW_MAX_ROUNDS,
} from "../../src/agent/orchestrator/review-orchestrator";
import type { ReviewSeverity } from "../../src/agent/tools/agent-tools";
import type { ReviewStrictness } from "../../src/agent/prompts/verifier-prompt";

/**
 * isBlocking is the heart of the review step's anti-over-sensitivity design:
 * it decides which reported issues actually trigger an automatic fix round vs.
 * which are recorded as non-blocking advisories. The whole point of the feature
 * is that minor/nit issues must NOT make the model "seriously handle"
 * unimportant warnings, so this matrix is the contract. Pure function — probe
 * the full severity × strictness grid exhaustively.
 */
describe("isBlocking", () => {
  const severities: ReviewSeverity[] = ["critical", "major", "minor", "nit"];
  const strictnesses: ReviewStrictness[] = ["lenient", "balanced", "strict"];

  // Expected blocking truth table: rows = severity, cols = strictness.
  const TRUTH: Record<ReviewSeverity, Record<ReviewStrictness, boolean>> = {
    critical: { lenient: true,  balanced: true,  strict: true  },
    major:    { lenient: false, balanced: true,  strict: true  },
    minor:    { lenient: false, balanced: false, strict: true  },
    nit:      { lenient: false, balanced: false, strict: false },
  };

  for (const sev of severities) {
    for (const strict of strictnesses) {
      it(`${sev} under ${strict} → ${TRUTH[sev][strict] ? "blocks" : "advisory"}`, () => {
        expect(isBlocking(sev, strict)).toBe(TRUTH[sev][strict]);
      });
    }
  }

  it("never blocks a nit under any strictness", () => {
    for (const strict of strictnesses) {
      expect(isBlocking("nit", strict)).toBe(false);
    }
  });

  it("always blocks a critical under any strictness", () => {
    for (const strict of strictnesses) {
      expect(isBlocking("critical", strict)).toBe(true);
    }
  });

  it("is monotonic in strictness: lenient ⊆ balanced ⊆ strict", () => {
    // Anything blocking under a looser setting must also block under a stricter one.
    for (const sev of severities) {
      const l = isBlocking(sev, "lenient");
      const b = isBlocking(sev, "balanced");
      const s = isBlocking(sev, "strict");
      if (l) expect(b).toBe(true);
      if (b) expect(s).toBe(true);
    }
  });
});

/**
 * The patience bound is what guarantees the loop terminates and reports back to
 * the user instead of grinding on cosmetic issues forever. Guard the value so a
 * careless edit can't silently turn the review into an unbounded loop.
 */
describe("REVIEW_MAX_ROUNDS", () => {
  it("is a small positive bound", () => {
    expect(Number.isInteger(REVIEW_MAX_ROUNDS)).toBe(true);
    expect(REVIEW_MAX_ROUNDS).toBeGreaterThanOrEqual(1);
    expect(REVIEW_MAX_ROUNDS).toBeLessThanOrEqual(5);
  });
});
