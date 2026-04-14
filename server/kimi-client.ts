import OpenAI from "openai";
import { doubaoClient, DOUBAO_MODEL } from "./doubao-client";
import { minimaxClient, MINIMAX_MODEL } from "./minimax-client";
import { glmClient, GLM_MODEL } from "./glm-client";

export const kimiClient = new OpenAI({
  baseURL: "https://api.moonshot.ai/v1",
  apiKey: process.env.KIMI_API_KEY || "placeholder",
});

export const KIMI_MODEL = "kimi-k2.5";

export type AIProvider = "doubao" | "kimi" | "minimax" | "glm";

export type AgentRole = "manager" | "editor" | "verifier" | "fixer";

const SYSTEM_FALLBACK_DEFAULTS: Record<AgentRole, AIProvider[]> = {
  manager:   ["kimi", "doubao", "glm"],
  editor:    ["doubao", "kimi", "minimax"],
  verifier:  ["minimax", "doubao", "kimi"],
  fixer:     ["doubao", "kimi", "minimax"],
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
  return { client: doubaoClient, model: DOUBAO_MODEL };
}
