import type { AgentLoopPhase, ThinkingContext } from "../providers/model-adapter";

export interface ModelPolicyDecision {
  thinkingEnabled: boolean;
  reasoningEffort?: "high" | "medium" | "minimal" | "none";
  reason: string;
}

export function decideGlm52ThinkingPolicy(opts: ThinkingContext): ModelPolicyDecision {
  if (opts.disabled) {
    return { thinkingEnabled: false, reasoningEffort: "none", reason: "disabled-by-caller" };
  }

  const iteration = opts.iteration ?? ((opts.outputTokensSoFar ?? 0) > 0 ? 1 : 0);
  const maxIterations = opts.maxIterations ?? 30;
  const phase = opts.phase as AgentLoopPhase | undefined;
  const consecutiveNoToolCalls = opts.consecutiveNoToolCalls ?? 0;
  const previousToolErrorCount = opts.previousToolErrorCount ?? 0;
  const previousToolCallCount = opts.previousToolCallCount ?? 0;
  const isInitialTurn = iteration === 0;
  const isPlanningLike = phase === "manager" || phase === "research" || phase === "verifier" || phase === "fixer";
  const isRecoveryTurn = consecutiveNoToolCalls > 0 || previousToolErrorCount > 0;
  const isLateTurn = iteration >= Math.max(20, Math.floor(maxIterations * 0.65));
  const isStalledLateTurn = isLateTurn && previousToolCallCount === 0;

  if (isInitialTurn || isPlanningLike || isRecoveryTurn || isStalledLateTurn) {
    return {
      thinkingEnabled: true,
      reasoningEffort: "high",
      reason: isInitialTurn ? "initial-comprehension" :
        isPlanningLike ? "planning-or-review" :
        isRecoveryTurn ? "tool-error-or-empty-recovery" :
        "late-stall-recovery",
    };
  }

  return { thinkingEnabled: false, reasoningEffort: "none", reason: "mechanical-tool-execution" };
}
