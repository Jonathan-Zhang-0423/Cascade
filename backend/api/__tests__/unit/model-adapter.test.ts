import { describe, it, expect } from "vitest";
import {
  createModelAdapter,
  DoubaoAdapter,
  KimiAdapter,
  MiniMaxAdapter,
  GlmAdapter,
  Glm52Adapter,
  DeepSeekAdapter,
  GenericAdapter,
} from "../../src/agent/providers/model-adapter";

/**
 * ModelAdapter factory + per-adapter behavior tests. These lock the exact
 * thinking config and reasoning extraction that agent-loop previously
 * hardcoded, ensuring the refactor preserves 1:1 behavior.
 */
describe("createModelAdapter", () => {
  const fakeClient = {} as any;

  it("routes doubao models to DoubaoAdapter", () => {
    expect(createModelAdapter(fakeClient, "doubao-seed-2-0-code")).toBeInstanceOf(DoubaoAdapter);
  });
  it("routes kimi models to KimiAdapter", () => {
    expect(createModelAdapter(fakeClient, "kimi-k2.5")).toBeInstanceOf(KimiAdapter);
  });
  it("routes minimax models to MiniMaxAdapter", () => {
    expect(createModelAdapter(fakeClient, "MiniMax-M2.7")).toBeInstanceOf(MiniMaxAdapter);
  });
  it("routes glm-5 to GlmAdapter", () => {
    expect(createModelAdapter(fakeClient, "glm-5")).toBeInstanceOf(GlmAdapter);
  });
  it("routes glm-5.2 to Glm52Adapter (more specific match)", () => {
    expect(createModelAdapter(fakeClient, "glm-5.2")).toBeInstanceOf(Glm52Adapter);
  });
  it("routes deepseek to DeepSeekAdapter", () => {
    expect(createModelAdapter(fakeClient, "deepseek-v4-pro")).toBeInstanceOf(DeepSeekAdapter);
    expect(createModelAdapter(fakeClient, "deepseek-v4-flash")).toBeInstanceOf(DeepSeekAdapter);
  });
  it("falls back to GenericAdapter for unknown models", () => {
    expect(createModelAdapter(fakeClient, "gpt-4o")).toBeInstanceOf(GenericAdapter);
  });
});

describe("DoubaoAdapter", () => {
  const adapter = new DoubaoAdapter({} as any, "doubao-seed-2-0-code");

  it("returns thinking budget 8192 when enabled", () => {
    const { thinkingParam, extraBody } = adapter.getThinkingConfig({});
    expect(thinkingParam).toEqual({ thinking: { type: "enabled", budget_tokens: 8192 } });
    expect(extraBody).toBeUndefined();
  });
  it("returns empty when disabled", () => {
    const { thinkingParam } = adapter.getThinkingConfig({ disabled: true });
    expect(thinkingParam).toEqual({});
  });
  it("extracts reasoning_content", () => {
    expect(adapter.extractReasoning({ reasoning_content: "thinking..." })).toBe("thinking...");
    expect(adapter.extractReasoning({ content: "text" })).toBeNull();
  });
});

describe("MiniMaxAdapter", () => {
  const adapter = new MiniMaxAdapter({} as any, "MiniMax-M2.7");

  it("uses reasoning_split in extraBody", () => {
    const { thinkingParam, extraBody } = adapter.getThinkingConfig({});
    expect(thinkingParam).toEqual({});
    expect(extraBody).toEqual({ reasoning_split: true });
  });
  it("extracts from reasoning_details array", () => {
    expect(adapter.extractReasoning({ reasoning_details: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(adapter.extractReasoning({})).toBeNull();
  });
});

describe("Glm52Adapter", () => {
  const adapter = new Glm52Adapter({} as any, "glm-5.2");

  it("uses 'high' reasoning_effort on first iteration (no output yet)", () => {
    const { extraBody } = adapter.getThinkingConfig({ outputTokensSoFar: 0 });
    expect((extraBody as any).reasoning_effort).toBe("high");
    expect((extraBody as any).thinking.type).toBe("enabled");
  });
  it("drops to 'low' reasoning_effort on subsequent iterations", () => {
    const { extraBody } = adapter.getThinkingConfig({ outputTokensSoFar: 5000 });
    expect((extraBody as any).reasoning_effort).toBe("low");
  });
  it("returns disabled when opts.disabled is true", () => {
    const { extraBody } = adapter.getThinkingConfig({ disabled: true });
    expect((extraBody as any).thinking.type).toBe("disabled");
  });
});

describe("DeepSeekAdapter", () => {
  const adapter = new DeepSeekAdapter({} as any, "deepseek-v4-pro");

  it("uses reasoning_effort top-level + thinking in extraBody", () => {
    const { thinkingParam, extraBody } = adapter.getThinkingConfig({});
    expect(thinkingParam).toEqual({ reasoning_effort: "high" });
    expect(extraBody).toEqual({ thinking: { type: "enabled" } });
  });
});

describe("GenericAdapter", () => {
  const adapter = new GenericAdapter({} as any, "gpt-4o");

  it("has no thinking support", () => {
    expect(adapter.supportsThinking).toBe(false);
    expect(adapter.timeoutMs).toBe(30_000);
  });
  it("returns null for reasoning extraction", () => {
    expect(adapter.extractReasoning({ reasoning_content: "x" })).toBeNull();
  });
});
