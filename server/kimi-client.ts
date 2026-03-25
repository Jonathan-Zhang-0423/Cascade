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
