import OpenAI from "openai";

export const doubaoClient = new OpenAI({
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: process.env.DOUBAO_API_KEY,
});

export const DOUBAO_MODEL = "doubao-1.5-pro-256k";
