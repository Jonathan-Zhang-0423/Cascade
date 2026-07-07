import OpenAI from "openai";
export { kimiClient, KIMI_MODEL } from "./kimi-base-client";
import {
  getAIClient as getRouterAIClient,
  getFastAgentModel,
  getRoleProviderDefaults,
  isProviderConfigured as isRouterProviderConfigured,
  resolveAgentModel,
  resolveAgentModelChain,
  withModelFallback,
  type AgentModelRole,
  type AIProvider,
} from "./agent-model-router";

export type { AIProvider };
export type AgentRole = AgentModelRole;

export type BuildPhase = "planning" | "editing" | "verifying" | "fixing";

export function isProviderConfigured(provider: AIProvider): boolean {
  return isRouterProviderConfigured(provider);
}

export function buildFallbackChain(role: AgentRole, userProvider: AIProvider): AIProvider[] {
  if (process.env.AGENT_ROUTING_MODE === "user_first") {
    const seen = new Set<AIProvider>();
    const chain: AIProvider[] = [];
    for (const provider of [userProvider, ...getRoleProviderDefaults(role)]) {
      if (seen.has(provider)) continue;
      seen.add(provider);
      if (isProviderConfigured(provider)) chain.push(provider);
    }
    return chain.length > 0 ? chain : ["doubao"];
  }
  return resolveAgentModelChain(role, userProvider).map((decision) => decision.provider);
}

export async function withFallback<T>(
  chain: AIProvider[],
  fn: (client: OpenAI, model: string) => Promise<T>,
): Promise<T> {
  const decisions = chain.map((provider, index) => {
    const { client, model } = getAIClient(provider);
    return {
      role: "editor" as AgentModelRole,
      provider,
      model,
      client,
      reason: index === 0 ? "user-preferred" as const : "role-fallback" as const,
      routingMode: "user_first" as const,
      fallbackIndex: index,
      userPreferredProvider: chain[0],
    };
  });
  return withModelFallback(decisions, (client, model) => fn(client, model));
}

export function getAIClient(provider: AIProvider): { client: OpenAI; model: string } {
  return getRouterAIClient(provider);
}

/**
 * A low-latency client for short, non-critical generations (e.g. end-of-round
 * summaries). Prefers MiniMax, then falls back to the Doubao "lite" model.
 */
export function getFastClient(): { client: OpenAI; model: string } {
  return getFastAgentModel("communicator");
}

const PHASE_TO_ROLE: Record<BuildPhase, AgentModelRole> = {
  planning: "manager",
  editing: "editor",
  verifying: "verifier",
  fixing: "fixer",
};

/**
 * Returns the best available AI client for a given build phase.
 * User's selected provider always wins if it's configured; otherwise
 * falls through the phase-specific preference list.
 * Provider availability is determined by env vars at runtime.
 */
export function getOptimalClient(
  phase: BuildPhase,
  userPreferredProvider: AIProvider,
): { client: OpenAI; model: string } {
  const decision = resolveAgentModel(PHASE_TO_ROLE[phase], userPreferredProvider);
  return { client: decision.client, model: decision.model };
}
