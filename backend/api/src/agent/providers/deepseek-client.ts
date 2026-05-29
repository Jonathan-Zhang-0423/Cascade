import OpenAI from "openai";

export const deepseekClient = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY || "placeholder",
});

export const DEEPSEEK_PRO_MODEL = process.env.DEEPSEEK_PRO_MODEL || "deepseek-v4-pro";
export const DEEPSEEK_FLASH_MODEL = process.env.DEEPSEEK_FLASH_MODEL || "deepseek-v4-flash";
