import OpenAI from "openai";

export const kimiClient = new OpenAI({
  baseURL: "https://api.moonshot.ai/v1",
  apiKey: process.env.KIMI_API_KEY || "placeholder",
});

export const KIMI_MODEL = "kimi-k2.5";

