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
  manager:   ["kimi", "deepseek-pro", "doubao"],
  editor:    ["deepseek-pro", "kimi", "doubao"],
  verifier:  ["deepseek-flash", "minimax", "doubao", "kimi"],
  fixer:     ["deepseek-pro", "kimi", "doubao"],
};

export function buildFallbackChain(role: AgentRole, userProvider: AIProvider): AIProvider[] {
  return [userProvider, ...SYSTEM_FALLBACK_DEFAULTS[role].filter(p => p !== userProvider)];
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
  planning:  ["kimi", "deepseek-pro", "doubao"],
  editing:   ["deepseek-pro", "kimi", "doubao"],
  verifying: ["deepseek-flash", "minimax", "doubao", "kimi"],
  fixing:    ["deepseek-pro", "kimi", "doubao"],
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
  // Check which providers are actually configured
  const configured = new Set<AIProvider>(["doubao"]); // doubao is always the fallback
  if (process.env.KIMI_API_KEY)     configured.add("kimi");
  if (process.env.MINIMAX_API_KEY)  configured.add("minimax");
  if (process.env.GLM_API_KEY)      configured.add("glm");
  if (process.env.DEEPSEEK_API_KEY) { configured.add("deepseek-pro"); configured.add("deepseek-flash"); }

  // User's choice first
  if (configured.has(userPreferredProvider)) {
    return getAIClient(userPreferredProvider);
  }
  // Fall through phase preference list
  for (const p of PHASE_PROVIDER_PREFERENCE[phase]) {
    if (configured.has(p)) return getAIClient(p);
  }
  // Last resort
  return getAIClient("doubao");
}
