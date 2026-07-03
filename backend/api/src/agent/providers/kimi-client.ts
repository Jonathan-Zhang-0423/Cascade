import OpenAI from "openai";
import { doubaoClient, DOUBAO_MODEL, DOUBAO_LITE_MODEL } from "./doubao-client";
import { minimaxClient, MINIMAX_MODEL } from "./minimax-client";
import { glmClient, GLM_MODEL } from "./glm-client";
import { deepseekClient, DEEPSEEK_PRO_MODEL, DEEPSEEK_FLASH_MODEL } from "./deepseek-client";

export const kimiClient = new OpenAI({
  baseURL: "https://api.moonshot.ai/v1",
  apiKey: process.env.KIMI_API_KEY || "placeholder",
});

export const KIMI_MODEL = "kimi-k2.5";

export type AIProvider = "doubao" | "kimi" | "minimax" | "glm" | "deepseek-pro" | "deepseek-flash";

export type AgentRole = "manager" | "editor" | "verifier" | "fixer";

export type BuildPhase = "planning" | "editing" | "verifying" | "fixing";

const SYSTEM_FALLBACK_DEFAULTS: Record<AgentRole, AIProvider[]> = {
  manager:   ["kimi", "glm", "deepseek-pro", "doubao"],
  editor:    ["glm", "kimi", "doubao", "deepseek-flash"],
  verifier:  ["deepseek-flash", "minimax", "doubao", "kimi"],
  fixer:     ["glm", "kimi", "doubao", "deepseek-flash"],
};

export function isProviderConfigured(provider: AIProvider): boolean {
  if (provider === "doubao") return true;
  if (provider === "kimi") return !!process.env.KIMI_API_KEY;
  if (provider === "minimax") return !!process.env.MINIMAX_API_KEY;
  if (provider === "glm") return !!process.env.GLM_API_KEY;
  if (provider === "deepseek-pro" || provider === "deepseek-flash") return !!process.env.DEEPSEEK_API_KEY;
  return false;
}

export function buildFallbackChain(role: AgentRole, userProvider: AIProvider): AIProvider[] {
  const seen = new Set<AIProvider>();
  const chain: AIProvider[] = [];
  for (const provider of [userProvider, ...SYSTEM_FALLBACK_DEFAULTS[role]]) {
    if (seen.has(provider)) continue;
    seen.add(provider);
    if (isProviderConfigured(provider)) chain.push(provider);
  }
  return chain.length > 0 ? chain : ["doubao"];
}

export async function withFallback<T>(
  chain: AIProvider[],
  fn: (client: OpenAI, model: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const { client, model } = getAIClient(provider);
    try {
      return await fn(client, model);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (/503|429|overload|rate.?limit|quota/i.test(message)) {
        const nextProvider = chain[i + 1];
        if (nextProvider) {
          console.warn(`[withFallback] Provider ${provider} failed (${message}), trying ${nextProvider}...`);
        }
        lastError = err;
      } else {
        throw err;
      }
    }
  }
  throw lastError;
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

/**
 * A low-latency client for short, non-critical generations (e.g. end-of-round
 * summaries). Prefers MiniMax, then falls back to the Doubao "lite" model.
 */
export function getFastClient(): { client: OpenAI; model: string } {
  if (process.env.MINIMAX_API_KEY) {
    return { client: minimaxClient, model: MINIMAX_MODEL };
  }
  return { client: doubaoClient, model: DOUBAO_LITE_MODEL };
}
const PHASE_PROVIDER_PREFERENCE: Record<BuildPhase, AIProvider[]> = {
  planning:  ["kimi", "glm", "deepseek-pro", "doubao"],
  editing:   ["glm", "kimi", "doubao", "deepseek-flash"],
  verifying: ["deepseek-flash", "minimax", "doubao", "kimi"],
  fixing:    ["glm", "kimi", "doubao", "deepseek-flash"],
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
  // User's choice first
  if (isProviderConfigured(userPreferredProvider)) {
    return getAIClient(userPreferredProvider);
  }
  // Fall through phase preference list
  for (const p of PHASE_PROVIDER_PREFERENCE[phase]) {
    if (isProviderConfigured(p)) return getAIClient(p);
  }
  // Last resort
  return getAIClient("doubao");
}
