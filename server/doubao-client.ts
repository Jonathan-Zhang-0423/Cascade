import OpenAI from "openai";

export const doubaoClient = new OpenAI({
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: process.env.DOUBAO_API_KEY,
});

export const DOUBAO_MODEL = process.env.DOUBAO_MODEL || "Doubao-Seed-2.0-Code";
