import OpenAI from "openai";

export const glmClient = new OpenAI({
  baseURL: "https://open.bigmodel.cn/api/paas/v4",
  apiKey: process.env.GLM_API_KEY || "placeholder",
});

// 型号可通过环境变量切换（如 glm-5.2 / glm-4.6 / glm-4-plus），不配则默认 glm-5.2。
export const GLM_MODEL = process.env.GLM_MODEL || "glm-5.2";
