import type OpenAI from "openai";
import { doubaoClient, DOUBAO_LITE_MODEL, DOUBAO_MODEL } from "./doubao-client";
import { minimaxClient, MINIMAX_MODEL } from "./minimax-client";
import { glmClient, GLM_MODEL } from "./glm-client";
import { deepseekClient, DEEPSEEK_FLASH_MODEL, DEEPSEEK_PRO_MODEL } from "./deepseek-client";
import { kimiClient, KIMI_MODEL } from "./kimi-base-client";

export type AIProvider = "doubao" | "kimi" | "minimax" | "glm" | "deepseek-pro" | "deepseek-flash";

export type AgentModelRole =
  | "manager"
  | "explorer"
  | "editor"
  | "verifier"
  | "fixer"
  | "research"
  | "communicator"
  | "memory";

export type AgentRoutingMode = "role_first" | "user_first";

export interface AgentModelDecision {
  role: AgentModelRole;
  provider: AIProvider;
  model: string;
  client: OpenAI;
  reason: "role-primary" | "user-preferred" | "role-fallback" | "system-fallback";
  routingMode: AgentRoutingMode;
  fallbackIndex: number;
  userPreferredProvider?: AIProvider;
}

const ROLE_PROVIDER_DEFAULTS: Record<AgentModelRole, AIProvider[]> = {
  manager: ["kimi", "glm", "deepseek-pro", "doubao"],
  explorer: ["minimax", "doubao", "deepseek-flash"],
  editor: ["glm", "kimi", "doubao", "deepseek-flash"],
  verifier: ["deepseek-flash", "minimax", "doubao", "kimi"],
  fixer: ["glm", "kimi", "doubao", "deepseek-flash"],
  research: ["minimax", "doubao"],
  communicator: ["minimax", "doubao"],
  memory: ["minimax", "doubao"],
};

function routingModeFromEnv(): AgentRoutingMode {
  return process.env.AGENT_ROUTING_MODE === "user_first" ? "user_first" : "role_first";
}

export function isProviderConfigured(provider: AIProvider): boolean {
  if (provider === "doubao") return true;
  if (provider === "kimi") return !!process.env.KIMI_API_KEY;
  if (provider === "minimax") return !!process.env.MINIMAX_API_KEY;
  if (provider === "glm") return !!process.env.GLM_API_KEY;
  if (provider === "deepseek-pro" || provider === "deepseek-flash") return !!process.env.DEEPSEEK_API_KEY;
  return false;
}

export function getAIClient(provider: AIProvider): { client: OpenAI; model: string } {
  if (provider === "kimi") {
    if (!process.env.KIMI_API_KEY) {
      console.warn("[getAIClient] KIMI_API_KEY not set, falling back to Doubao");
      return { client: doubaoClient, model: DOUBAO_MODEL };
    }
    return { client: kimiClient, model: KIMI_MODEL };
  }
  if (provider === "minimax") {
    if (!process.env.MINIMAX_API_KEY) {
      console.warn("[getAIClient] MINIMAX_API_KEY not set, falling back to Doubao");
      return { client: doubaoClient, model: DOUBAO_MODEL };
    }
    return { client: minimaxClient, model: MINIMAX_MODEL };
  }
  if (provider === "glm") {
    if (!process.env.GLM_API_KEY) {
      console.warn("[getAIClient] GLM_API_KEY not set, falling back to Doubao");
      return { client: doubaoClient, model: DOUBAO_MODEL };
    }
    return { client: glmClient, model: GLM_MODEL };
  }
  if (provider === "deepseek-pro") {
    if (!process.env.DEEPSEEK_API_KEY) {
      console.warn("[getAIClient] DEEPSEEK_API_KEY not set, falling back to Doubao");
      return { client: doubaoClient, model: DOUBAO_MODEL };
    }
    return { client: deepseekClient, model: DEEPSEEK_PRO_MODEL };
  }
  if (provider === "deepseek-flash") {
    if (!process.env.DEEPSEEK_API_KEY) {
      console.warn("[getAIClient] DEEPSEEK_API_KEY not set, falling back to Doubao");
      return { client: doubaoClient, model: DOUBAO_MODEL };
    }
    return { client: deepseekClient, model: DEEPSEEK_FLASH_MODEL };
  }
  return { client: doubaoClient, model: DOUBAO_MODEL };
}

function uniqueProviders(providers: AIProvider[]): AIProvider[] {
  const seen = new Set<AIProvider>();
  const out: AIProvider[] = [];
  for (const provider of providers) {
    if (seen.has(provider)) continue;
    seen.add(provider);
    out.push(provider);
  }
  return out;
}

export function getRoleProviderDefaults(role: AgentModelRole): AIProvider[] {
  return [...ROLE_PROVIDER_DEFAULTS[role]];
}

export function resolveAgentModelChain(
  role: AgentModelRole,
  userPreferredProvider: AIProvider = "glm",
  opts?: { routingMode?: AgentRoutingMode },
): AgentModelDecision[] {
  const routingMode = opts?.routingMode ?? routingModeFromEnv();
  const roleDefaults = ROLE_PROVIDER_DEFAULTS[role];
  const ordered = routingMode === "user_first"
    ? uniqueProviders([userPreferredProvider, ...roleDefaults])
    : uniqueProviders([...roleDefaults, userPreferredProvider]);
  const configured = ordered.filter(isProviderConfigured);
  const providers = configured.length > 0 ? configured : ["doubao" as AIProvider];

  return providers.map((provider, index) => {
    const { client, model } = getAIClient(provider);
    const isUserPreferred = provider === userPreferredProvider;
    const isRolePrimary = provider === roleDefaults[0];
    return {
      role,
      provider,
      model,
      client,
      routingMode,
      fallbackIndex: index,
      userPreferredProvider,
      reason:
        routingMode === "user_first" && index === 0 && isUserPreferred ? "user-preferred" :
        index === 0 && isRolePrimary ? "role-primary" :
        index === 0 ? "system-fallback" :
        "role-fallback",
    };
  });
}

export function resolveAgentModel(
  role: AgentModelRole,
  userPreferredProvider: AIProvider = "glm",
  opts?: { routingMode?: AgentRoutingMode; log?: boolean },
): AgentModelDecision {
  const decision = resolveAgentModelChain(role, userPreferredProvider, opts)[0];
  if (opts?.log !== false) {
    console.log(
      `[agent-router] role=${decision.role} provider=${decision.provider} model=${decision.model} ` +
        `reason=${decision.reason} routingMode=${decision.routingMode} ` +
        `fallbackIndex=${decision.fallbackIndex} userPreferred=${decision.userPreferredProvider ?? "(none)"}`,
    );
  }
  return decision;
}

export function getFastAgentModel(role: "explorer" | "research" | "communicator" | "memory" = "communicator"): {
  client: OpenAI;
  model: string;
} {
  const decision = resolveAgentModel(role, "glm", { log: false });
  if (decision.provider === "doubao") {
    return { client: doubaoClient, model: DOUBAO_LITE_MODEL };
  }
  return { client: decision.client, model: decision.model };
}

export async function withModelFallback<T>(
  decisions: AgentModelDecision[],
  fn: (client: OpenAI, model: string, decision: AgentModelDecision) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i];
    try {
      if (i > 0) {
        console.warn(
          `[agent-router] fallback role=${decision.role} provider=${decision.provider} ` +
            `model=${decision.model} index=${i}`,
        );
      }
      return await fn(decision.client, decision.model, decision);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (/503|429|overload|rate.?limit|quota/i.test(message)) {
        const next = decisions[i + 1];
        if (next) {
          console.warn(
            `[agent-router] provider ${decision.provider} failed (${message}), trying ${next.provider}...`,
          );
        }
        lastError = err;
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}
