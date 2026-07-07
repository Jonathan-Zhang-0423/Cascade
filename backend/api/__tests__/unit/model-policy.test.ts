import { describe, expect, it } from "vitest";
import { decideGlm52ThinkingPolicy } from "../../src/agent/runtime/model-policy";

describe("GLM-5.2 model policy", () => {
  it("uses high thinking for initial comprehension and recovery", () => {
    expect(decideGlm52ThinkingPolicy({ iteration: 0 }).reason).toBe("initial-comprehension");
    expect(decideGlm52ThinkingPolicy({ iteration: 5, previousToolErrorCount: 1 })).toMatchObject({
      thinkingEnabled: true,
      reasoningEffort: "high",
      reason: "tool-error-or-empty-recovery",
    });
  });

  it("keeps early successful editor tool execution mechanical", () => {
    expect(decideGlm52ThinkingPolicy({
      phase: "editor",
      iteration: 3,
      maxIterations: 200,
      previousToolCallCount: 2,
      previousToolErrorCount: 0,
      consecutiveNoToolCalls: 0,
    })).toMatchObject({
      thinkingEnabled: false,
      reasoningEffort: "none",
      reason: "mechanical-tool-execution",
    });
  });

  it("re-enables thinking on late discovery stalls", () => {
    expect(decideGlm52ThinkingPolicy({
      phase: "editor",
      iteration: 130,
      maxIterations: 200,
      previousToolCallCount: 0,
    })).toMatchObject({
      thinkingEnabled: true,
      reasoningEffort: "high",
      reason: "late-stall-recovery",
    });
  });
});
