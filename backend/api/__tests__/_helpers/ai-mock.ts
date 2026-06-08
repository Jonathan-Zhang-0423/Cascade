/**
 * AI mock — intercepts `chat.completions.create` on every provider singleton so
 * integration/stress tests never hit a real provider. Covers both modes:
 *   - stream: false → resolves a ChatCompletion-shaped object
 *   - stream: true  → returns an async-iterable of ChatCompletionChunk-shaped
 *                     objects (delta.content / delta.reasoning_content / tool_calls),
 *                     matching what agent-loop.ts consumes via `for await`.
 *
 * Configurable per install: scripted text, reasoning, tool calls, per-chunk
 * delay (to simulate slow providers / saturate the semaphore), and an optional
 * error to exercise withRetry / withFallback paths.
 */
import { vi, type MockInstance } from "vitest";
import { doubaoClient } from "../../src/agent/providers/doubao-client";
import { kimiClient } from "../../src/agent/providers/kimi-client";
import { minimaxClient } from "../../src/agent/providers/minimax-client";
import { glmClient } from "../../src/agent/providers/glm-client";
import { deepseekClient } from "../../src/agent/providers/deepseek-client";

export interface AiMockConfig {
  /** Assistant text emitted as content chunks. Default: a short JSON-ish reply. */
  text?: string;
  /** Reasoning tokens emitted before content (delta.reasoning_content). */
  reasoning?: string;
  /** Number of chunks to split `text` into (simulates token streaming). */
  chunks?: number;
  /** Delay (ms) before each chunk — use to slow streams and saturate concurrency. */
  perChunkDelayMs?: number;
  /** Delay (ms) before the create() promise resolves at all. */
  startDelayMs?: number;
  /** If set, create() rejects with this (string → Error). Tests retry/fallback. */
  error?: string | Error;
  /** finish_reason for the terminal chunk. Default "stop". */
  finishReason?: string;
  /** A dynamic responder: receives the create() params, returns text. */
  responder?: (params: any) => string;
}

export interface AiMock {
  /** Total create() invocations across all providers. */
  callCount: () => number;
  /** Max number of create() calls observed in-flight at once. */
  maxConcurrent: () => number;
  restore: () => void;
  update: (cfg: Partial<AiMockConfig>) => void;
}

const ALL_CLIENTS = () => [doubaoClient, kimiClient, minimaxClient, glmClient, deepseekClient];

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return { choices: [{ index: 0, delta, finish_reason: finish }] };
}

export function installAiMock(initial: AiMockConfig = {}): AiMock {
  const cfg: AiMockConfig = {
    text: '{"reply":"ok"}',
    chunks: 3,
    finishReason: "stop",
    ...initial,
  };

  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const spies: MockInstance[] = [];

  const impl = async (params: any) => {
    calls++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (cfg.startDelayMs) await sleep(cfg.startDelayMs);
      if (cfg.error) {
        throw typeof cfg.error === "string" ? new Error(cfg.error) : cfg.error;
      }

      const text = cfg.responder ? cfg.responder(params) : cfg.text ?? "";

      if (!params?.stream) {
        return {
          id: "mock-cmpl",
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: cfg.finishReason }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      }

      // Streaming: yield reasoning (if any), then content chunks, then a stop.
      const reasoning = cfg.reasoning ?? "";
      const nChunks = Math.max(1, cfg.chunks ?? 1);
      const parts = splitInto(text, nChunks);
      const perChunkDelayMs = cfg.perChunkDelayMs ?? 0;

      async function* gen() {
        if (reasoning) {
          for (const r of splitInto(reasoning, Math.min(reasoning.length, 3))) {
            if (perChunkDelayMs) await sleep(perChunkDelayMs);
            yield chunk({ reasoning_content: r });
          }
        }
        for (const p of parts) {
          if (perChunkDelayMs) await sleep(perChunkDelayMs);
          yield chunk({ content: p });
        }
        yield chunk({}, cfg.finishReason ?? "stop");
      }
      return gen();
    } finally {
      // For non-stream the work is done here; for stream we decrement once the
      // create() resolves (the generator runs lazily, but the semaphore in
      // agent-loop wraps create() only, so this matches real timing closely).
      inFlight--;
    }
  };

  for (const client of ALL_CLIENTS()) {
    const spy = vi.spyOn(client.chat.completions, "create").mockImplementation(impl as any);
    spies.push(spy);
  }

  return {
    callCount: () => calls,
    maxConcurrent: () => maxInFlight,
    restore: () => spies.forEach((s) => s.mockRestore()),
    update: (next) => Object.assign(cfg, next),
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function splitInto(s: string, n: number): string[] {
  if (n <= 1 || s.length === 0) return [s];
  const size = Math.ceil(s.length / n);
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
