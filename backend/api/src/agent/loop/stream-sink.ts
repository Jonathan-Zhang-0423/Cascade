/**
 * StreamSink — output abstraction for agent-loop's TEXT output (reasoning,
 * narration, step boundaries). The loop emits these through this interface
 * instead of directly calling `emit({ type: "narration_token", ... })`,
 * decoupling the loop from the SSE transport and enabling alternative sinks
 * (WebSocket, logging, testing) without touching the loop.
 *
 * Scope note: tool-call emission (pending→running→completed state machine) is
 * intentionally NOT part of this interface — it's tightly coupled to the loop's
 * toolCallsMap accumulation and stays inline. StreamSink covers the cleanly
 * separable text stream. The default SseStreamSink preserves exact existing
 * behavior (same JSON fields, same event types, same <think>-tag filtering).
 */

import type { SseEmit } from "../orchestrator/build-orchestrator";
import {
  createPart,
  emitPart,
  type Part,
  type PartEmitContext,
} from "../../infra/parts";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface StreamSink {
  /** Begin a new iteration; resets per-iteration text accumulation. */
  beginIteration(messageId: string, step: number): void;
  /** Emit a reasoning/thinking token. */
  emitThinking(token: string): void;
  /** Emit a narration (assistant text) token. */
  emitNarration(token: string): void;
}

// ─── SSE Implementation (preserves exact current behavior) ────────────────────

export class SseStreamSink implements StreamSink {
  private reasoningText = "";
  private narrationText = "";
  private reasoningPart: Part | undefined;
  private textPart: Part | undefined;
  private inThinkTag = false;
  private currentMessageId = "";

  constructor(
    private readonly emit: SseEmit,
    private readonly sessionId: string,
    private readonly partCtx?: PartEmitContext,
  ) {}

  beginIteration(messageId: string, step: number): void {
    this.currentMessageId = messageId;
    this.reasoningText = "";
    this.narrationText = "";
    this.reasoningPart = undefined;
    this.textPart = undefined;
    this.inThinkTag = false;
    if (this.partCtx) {
      const stepStart = createPart("step-start", this.sessionId, messageId, { step });
      emitPart(this.partCtx, this.emit, stepStart);
    }
  }

  emitThinking(token: string): void {
    this.reasoningText += token;
    if (this.partCtx) {
      if (!this.reasoningPart) {
        this.reasoningPart = createPart("reasoning", this.sessionId, this.currentMessageId, { text: this.reasoningText });
        emitPart(this.partCtx, this.emit, this.reasoningPart, token);
      } else {
        (this.reasoningPart as any).text = this.reasoningText;
        this.emit({ type: "thinking_token", token });
      }
    } else {
      this.emit({ type: "thinking_token", token });
    }
  }

  emitNarration(token: string): void {
    this.narrationText += token;
    // Filter <think> blocks from narration stream
    if (token.includes("<think>")) this.inThinkTag = true;
    if (!this.inThinkTag) {
      if (this.partCtx) {
        if (!this.textPart) {
          this.textPart = createPart("text", this.sessionId, this.currentMessageId, { text: this.narrationText });
          emitPart(this.partCtx, this.emit, this.textPart, token);
        } else {
          (this.textPart as any).text = this.narrationText;
          this.emit({ type: "narration_token", token });
        }
      } else {
        this.emit({ type: "narration_token", token });
      }
    }
    if (token.includes("</think>")) this.inThinkTag = false;
  }
}

