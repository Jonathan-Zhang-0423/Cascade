/**
 * Part-based message model — mirrors OpenCode's architecture.
 *
 * Every piece of agent output (text, reasoning, tool call, step boundary)
 * is a typed Part with a unique ID. Parts are stored in an ordered array
 * on the session, giving us addressable history and consistent event payloads.
 */
import { randomUUID } from "crypto";
import type { SseEmit } from "./build-orchestrator";

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export interface BasePart {
  id: string;
  sessionId: string;
  messageId: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Part variants
// ---------------------------------------------------------------------------

export interface TextPart extends BasePart {
  type: "text";
  text: string; // accumulated text so far
}

export interface ReasoningPart extends BasePart {
  type: "reasoning";
  text: string;
}

export interface ToolPart extends BasePart {
  type: "tool";
  tool: string;   // tool name (write_file, read_file, …)
  callId: string;  // OpenAI tool_call ID
  state: ToolState;
}

export interface StepStartPart extends BasePart {
  type: "step-start";
  step: number; // iteration number within the agent loop
}

export interface StepFinishPart extends BasePart {
  type: "step-finish";
  step: number;
  reason: string; // "tool_calls" | "stop" | "exit_tool" | "max_iterations"
  tokens?: { input: number; output: number; reasoning: number };
}

export type Part = TextPart | ReasoningPart | ToolPart | StepStartPart | StepFinishPart;

// ---------------------------------------------------------------------------
// Tool state machine: pending → running → completed | error
// ---------------------------------------------------------------------------

export interface ToolStatePending {
  status: "pending";
  input: Record<string, unknown>;
}

export interface ToolStateRunning {
  status: "running";
  input: Record<string, unknown>;
  startedAt: number;
}

export interface ToolStateCompleted {
  status: "completed";
  input: Record<string, unknown>;
  output: string;
  startedAt: number;
  completedAt: number;
}

export interface ToolStateError {
  status: "error";
  input: Record<string, unknown>;
  error: string;
  startedAt: number;
  completedAt: number;
}

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError;

// ---------------------------------------------------------------------------
// Session status (mirrors OpenCode's idle | busy | retry)
// ---------------------------------------------------------------------------

export type SessionStatus =
  | { type: "idle" }
  | { type: "busy"; agent: string }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generatePartId(): string {
  return randomUUID();
}

export function createPart<T extends Part["type"]>(
  type: T,
  sessionId: string,
  messageId: string,
  fields: Omit<Extract<Part, { type: T }>, "id" | "sessionId" | "messageId" | "createdAt" | "type">,
): Extract<Part, { type: T }> {
  return {
    id: generatePartId(),
    sessionId,
    messageId,
    createdAt: Date.now(),
    type,
    ...fields,
  } as Extract<Part, { type: T }>;
}

// ---------------------------------------------------------------------------
// Part → SSE translation layer
//
// Converts structured Parts into our existing SSE event vocabulary so the
// client doesn't need to change. Also stores each part in the provided array.
// ---------------------------------------------------------------------------

export interface PartEmitContext {
  parts: Part[];
  files?: Map<string, string>; // session file map, needed for code_applied on write_file
}

export function emitPart(
  ctx: PartEmitContext,
  emit: SseEmit,
  part: Part,
  delta?: string,
): void {
  ctx.parts.push(part);

  switch (part.type) {
    case "text":
      if (delta) emit({ type: "narration_token", token: delta });
      break;

    case "reasoning":
      if (delta) emit({ type: "thinking_token", token: delta });
      break;

    case "tool": {
      const st = part.state;
      if (st.status === "pending") {
        emit({
          type: "action_log",
          actionType: "tool_call",
          label: part.tool,
          detail: JSON.stringify(st.input).slice(0, 120),
        });
      }
      // Domain-specific emissions (code_applied, file_read, etc.) are
      // handled by the tool handlers in agent-tools.ts, not here.
      break;
    }

    case "step-start":
      // We log step boundaries — the build orchestrator handles the
      // higher-level step_starting events (which carry plan step titles).
      console.log(`[parts] step-start ${part.step} (session=${part.sessionId})`);
      break;

    case "step-finish":
      console.log(`[parts] step-finish ${part.step} reason=${part.reason}${part.tokens ? ` tokens=${JSON.stringify(part.tokens)}` : ""}`);
      break;
  }
}

/**
 * Convenience: update a ToolPart's state in-place.
 *
 * This only tracks the state transition — it does NOT emit domain-specific
 * SSE events like code_applied or action_log for reads/writes. Those are
 * handled by the tool handlers themselves (in agent-tools.ts) which have
 * the domain knowledge (file path, content, etc.).
 *
 * Returns the same part reference for chaining.
 */
export function updateToolState(
  _ctx: PartEmitContext,
  _emit: SseEmit,
  part: ToolPart,
  newState: ToolState,
): ToolPart {
  part.state = newState;
  return part;
}
