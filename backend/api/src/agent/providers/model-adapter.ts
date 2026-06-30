import type OpenAI from "openai";

/**
 * ModelAdapter — encapsulates per-model thinking/reasoning configuration so
 * agent-loop doesn't need to hardcode model detection branches. Each AI
 * provider implements this interface; agent-loop receives it via opts.adapter.
 *
 * Design goals:
 * - agent-loop stays model-agnostic (no more isDoubaoModel / isKimiModel / …)
 * - Adding a new model = implementing this interface, not touching the loop
 * - Existing behavior preserved 1:1 (same thinking params, same timeout, same
 *   reasoning extraction logic)
 */

export interface ThinkingConfig {
  /** Extra params merged into the chat.completions.create call (top-level). */
  thinkingParam: Record<string, unknown>;
  /** Extra body params (model-specific, passed via extra_body). */
  extraBody: Record<string, unknown> | undefined;
}

export interface ModelAdapter {
  readonly name: string;
  readonly client: OpenAI;
  readonly model: string;
  /** Per-request timeout in ms. */
  readonly timeoutMs: number;
  /** Whether this model uses extended thinking by default. */
  readonly supportsThinking: boolean;

  /**
   * Returns thinking/reasoning params for a given iteration context.
   * @param opts.disabled - true when thinking should be explicitly suppressed
   * @param opts.outputTokensSoFar - cumulative output tokens (for dynamic budget)
   */
  getThinkingConfig(opts: { disabled?: boolean; outputTokensSoFar?: number }): ThinkingConfig;

  /**
   * Extract reasoning content from a streaming delta. Models emit reasoning
   * in different fields (reasoning_content, reasoning_details, content with
   * <think> tags). Returns the extracted text or null if the delta has none.
   */
  extractReasoning(delta: any): string | null;
}

// ─── Implementations ──────────────────────────────────────────────────────────

/**
 * Doubao (Seed 2.0 Code) — reasoning via `thinking.budget_tokens: 8192`.
 * Reasoning emitted as delta.reasoning_content.
 */
export class DoubaoAdapter implements ModelAdapter {
  readonly name = "doubao";
  readonly supportsThinking = true;
  readonly timeoutMs = 90_000;
  constructor(readonly client: OpenAI, readonly model: string) {}

  getThinkingConfig(opts: { disabled?: boolean }): ThinkingConfig {
    if (opts.disabled) return { thinkingParam: {}, extraBody: undefined };
    return {
      thinkingParam: { thinking: { type: "enabled", budget_tokens: 8192 } },
      extraBody: undefined,
    };
  }

  extractReasoning(delta: any): string | null {
    return delta.reasoning_content ?? null;
  }
}

/**
 * Kimi (K2.5) — reasoning via `thinking.type: "enabled"` (no budget).
 * Reasoning emitted as delta.reasoning_content.
 */
export class KimiAdapter implements ModelAdapter {
  readonly name = "kimi";
  readonly supportsThinking = true;
  readonly timeoutMs = 90_000;
  constructor(readonly client: OpenAI, readonly model: string) {}

  getThinkingConfig(opts: { disabled?: boolean }): ThinkingConfig {
    if (opts.disabled) return { thinkingParam: {}, extraBody: undefined };
    return {
      thinkingParam: { thinking: { type: "enabled" } },
      extraBody: undefined,
    };
  }

  extractReasoning(delta: any): string | null {
    return delta.reasoning_content ?? null;
  }
}

/**
 * MiniMax (M2.7) — reasoning via `reasoning_split: true` in extra_body.
 * Reasoning emitted as delta.reasoning_details[].text.
 */
export class MiniMaxAdapter implements ModelAdapter {
  readonly name = "minimax";
  readonly supportsThinking = true;
  readonly timeoutMs = 90_000;
  constructor(readonly client: OpenAI, readonly model: string) {}

  getThinkingConfig(opts: { disabled?: boolean }): ThinkingConfig {
    if (opts.disabled) return { thinkingParam: {}, extraBody: undefined };
    return {
      thinkingParam: {},
      extraBody: { reasoning_split: true },
    };
  }

  extractReasoning(delta: any): string | null {
    if (delta.reasoning_details && delta.reasoning_details.length > 0) {
      return delta.reasoning_details.map((rd: any) => rd.text ?? "").join("");
    }
    return null;
  }
}

/**
 * GLM-5 — reasoning via `thinking.budget_tokens: 2048` in extra_body.
 * Reasoning emitted as delta.reasoning_content.
 */
export class GlmAdapter implements ModelAdapter {
  readonly name = "glm";
  readonly supportsThinking = true;
  readonly timeoutMs = 90_000;
  constructor(readonly client: OpenAI, readonly model: string) {}

  getThinkingConfig(opts: { disabled?: boolean }): ThinkingConfig {
    if (opts.disabled) return { thinkingParam: {}, extraBody: undefined };
    return {
      thinkingParam: {},
      extraBody: { thinking: { type: "enabled", budget_tokens: 2048 } },
    };
  }

  extractReasoning(delta: any): string | null {
    return delta.reasoning_content ?? null;
  }
}

/**
 * GLM-5.2 — dynamic thinking budget that shrinks as context grows, ensuring
 * there's always room for narration + tool calls. Same reasoning extraction.
 */
export class Glm52Adapter implements ModelAdapter {
  readonly name = "glm-5.2";
  readonly supportsThinking = true;
  readonly timeoutMs = 90_000;

  private readonly MAX_THINKING = 4096;
  private readonly MIN_THINKING = 1024;
  private readonly OUTPUT_CAP = 16384;

  constructor(readonly client: OpenAI, readonly model: string) {}

  getThinkingConfig(opts: { disabled?: boolean; outputTokensSoFar?: number }): ThinkingConfig {
    if (opts.disabled) return { thinkingParam: {}, extraBody: undefined };
    const outputSoFar = opts.outputTokensSoFar ?? 0;
    const pressure = Math.min(outputSoFar / (this.OUTPUT_CAP * 3), 1);
    const budget = Math.round(this.MAX_THINKING - pressure * (this.MAX_THINKING - this.MIN_THINKING));
    const clamped = Math.max(this.MIN_THINKING, Math.min(this.MAX_THINKING, budget));
    return {
      thinkingParam: {},
      extraBody: { thinking: { type: "enabled", budget_tokens: clamped } },
    };
  }

  extractReasoning(delta: any): string | null {
    return delta.reasoning_content ?? null;
  }
}

/**
 * DeepSeek (Pro/Flash) — reasoning via `reasoning_effort` (top-level)
 * + `thinking.type: "enabled"` in extra_body.
 * Adaptive: first iteration uses "high" effort for deep understanding,
 * subsequent iterations drop to "medium" for faster mechanical execution.
 * Reasoning emitted as delta.reasoning_content.
 */
export class DeepSeekAdapter implements ModelAdapter {
  readonly name = "deepseek";
  readonly supportsThinking = true;
  readonly timeoutMs = 90_000;
  constructor(readonly client: OpenAI, readonly model: string) {}

  getThinkingConfig(opts: { disabled?: boolean; outputTokensSoFar?: number }): ThinkingConfig {
    if (opts.disabled) return { thinkingParam: {}, extraBody: undefined };
    // Adaptive effort: high for first iteration (outputTokensSoFar=0),
    // medium for subsequent iterations (mechanical file writes).
    const effort = (opts.outputTokensSoFar ?? 0) > 0 ? "medium" : "high";
    return {
      thinkingParam: { reasoning_effort: effort },
      extraBody: { thinking: { type: "enabled" } },
    };
  }

  extractReasoning(delta: any): string | null {
    return delta.reasoning_content ?? null;
  }
}

/**
 * Generic fallback — no thinking support, short timeout. Used when a model
 * doesn't match any known adapter.
 */
export class GenericAdapter implements ModelAdapter {
  readonly name = "generic";
  readonly supportsThinking = false;
  readonly timeoutMs = 30_000;
  constructor(readonly client: OpenAI, readonly model: string) {}

  getThinkingConfig(): ThinkingConfig {
    return { thinkingParam: {}, extraBody: undefined };
  }

  extractReasoning(): string | null {
    return null;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create the appropriate ModelAdapter for a given client + model string.
 * Preserves the exact same model detection logic that was in agent-loop.ts.
 */
export function createModelAdapter(client: OpenAI, model: string): ModelAdapter {
  const m = model.toLowerCase();
  if (m.includes("glm-5.2")) return new Glm52Adapter(client, model);
  if (m.startsWith("glm")) return new GlmAdapter(client, model);
  if (m.includes("doubao")) return new DoubaoAdapter(client, model);
  if (m.includes("kimi")) return new KimiAdapter(client, model);
  if (m.includes("minimax")) return new MiniMaxAdapter(client, model);
  if (m.includes("deepseek")) return new DeepSeekAdapter(client, model);
  return new GenericAdapter(client, model);
}
