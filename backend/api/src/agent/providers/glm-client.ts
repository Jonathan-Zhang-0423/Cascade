import OpenAI from "openai";

export const glmClient = new OpenAI({
  baseURL: "https://open.bigmodel.cn/api/paas/v4",
  apiKey: process.env.GLM_API_KEY || "placeholder",
});

export const GLM_MODEL = "glm-5";
