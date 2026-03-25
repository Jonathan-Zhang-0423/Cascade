import OpenAI from "openai";

export const minimaxClient = new OpenAI({
  baseURL: "https://api.minimax.io/v1",
  apiKey: process.env.MINIMAX_API_KEY || "placeholder",
});

export const MINIMAX_MODEL = "MiniMax-M2.7";
