import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../infra/db";
import { userFeedback } from "@cascade/database";
import { getConcurrencyMetrics } from "../../infra/concurrency";
import { isCaptchaEnabled, getCaptchaAppId } from "../../infra/captcha";

/**
 * Misc structural routes (Step C): provider availability, concurrency metrics,
 * captcha config, and user feedback submission. Small self-contained endpoints
 * with no closure-state dependencies.
 */
export function registerMiscRoutes(app: Express): void {
  app.get("/api/providers", (_req, res) => {
    res.json({
      doubao: !!process.env.DOUBAO_API_KEY,
      kimi: !!process.env.KIMI_API_KEY,
      minimax: !!process.env.MINIMAX_API_KEY,
      glm: !!process.env.GLM_API_KEY,
      "deepseek-pro": !!process.env.DEEPSEEK_API_KEY,
      "deepseek-flash": !!process.env.DEEPSEEK_API_KEY,
    });
  });

  app.get("/api/concurrency", (_req, res) => {
    res.json(getConcurrencyMetrics());
  });

  // 前端 TCaptcha 初始化所需的公开 CaptchaAppId。enabled=false 时前端跳过取票。
  app.get("/api/config/captcha", (_req, res) => {
    res.json({ enabled: isCaptchaEnabled(), appId: getCaptchaAppId() });
  });

  // POST /api/feedback — submit user suggestion
  app.post("/api/feedback", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { content, source } = req.body as { content?: string; source?: string };
      if (!content?.trim()) return res.status(400).json({ error: "Content required" });
      await db.insert(userFeedback).values({
        userId,
        content: content.trim().slice(0, 2000),
        source: (source === "mobile" ? "mobile" : "pc"),
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("[feedback]", err);
      res.status(500).json({ error: "Failed to submit feedback" });
    }
  });
}
