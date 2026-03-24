import OpenAI from "openai";
import { doubaoClient, DOUBAO_MODEL } from "./doubao-client";

export const kimiClient = new OpenAI({
  baseURL: "https://api.moonshot.ai/v1",
  apiKey: process.env.KIMI_API_KEY || "placeholder",
});

export const KIMI_MODEL = "kimi-k2.5";

export type AIProvider = "doubao" | "kimi";

export function getAIClient(provider: AIProvider): { client: OpenAI; model: string } {
  if (provider === "kimi") {
    return { client: kimiClient, model: KIMI_MODEL };
  }
  return { client: doubaoClient, model: DOUBAO_MODEL };
}
