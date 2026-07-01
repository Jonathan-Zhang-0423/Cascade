// AIGC Agent tools: screenshot, poster generation, video recording, watermark.
// These are the only tools the AIGC Agent has access to — no file writes.

import { writeFile, rm, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ToolSchema, ToolHandler } from "../loop/agent-loop";
import { storage } from "../../infra/storage";
import { aigcProvider } from "../../api/aigc/aigc-provider";
import { addImageWatermark, addVideoWatermark } from "../../infra/watermark";
import { videoStorage } from "../../infra/video-storage";
import { executeDslSequence, validateDslSequence } from "../../api/video/dsl-executor";
import { getFastClient } from "../providers/kimi-client";
import { evaluatePoster, incrementSessionRetry, incrementDailyUsage } from "../../infra/aigc-evaluator";

// ── Style tag extractor (fire-and-forget) ─────────────────────────────────────
// Runs after poster generation to update user style preferences asynchronously.
async function extractAndSaveStyleTags(userId: string, prompt: string, style: string | undefined): Promise<void> {
  try {
    const { client, model } = getFastClient();
    const completion = await client.chat.completions.create({
      model,
      max_tokens: 40,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `从以下图像生成描述中提取风格标签（最多3个中文词，如"极简","冷色调","商务感"）。只返回 JSON：{"tags":["极简","冷色调"]}`,
        },
        { role: "user", content: `提示词：${prompt}。风格选项：${style ?? "无"}` },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;
    const parsed = JSON.parse(match[0]) as { tags?: string[] };
    const tags = (parsed.tags ?? []).filter((t) => typeof t === "string").slice(0, 3);
    if (!tags.length) return;

    const existing = await storage.getAigcPreferences(userId);
    const merged = [...new Set([...(existing?.styleHistory ?? []), ...tags])].slice(-10);
    await storage.upsertAigcPreferences(userId, {
      styleHistory: merged,
      lastStyle: style ?? existing?.lastStyle ?? undefined,
      generationCount: (existing?.generationCount ?? 0) + 1,
    });
  } catch {
    // Non-critical — silently ignore
  }
}

const PORT = parseInt(process.env.PORT ?? "5000", 10);

// ── Prompt expander ───────────────────────────────────────────────────────────
// Expands a short user prompt into a rich image-generation prompt (English),
// adding style descriptors, composition hints, and negative keywords.
async function expandPosterPrompt(userPrompt: string, style?: string): Promise<string> {
  try {
    const { client, model } = getFastClient();
    const styleHint = style ? `视觉风格偏好：${style}。` : "";
    const completion = await client.chat.completions.create({
      model,
      max_tokens: 120,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `你是专业图像提示词工程师。将用户的简短需求扩写为高质量图像生成提示词（英文，80词以内）。
要求：加入设计风格、色调、构图、质量修饰词，最后加负向词 --no blur, watermark, low quality, text overlay。
只输出提示词本身，不要解释。`,
        },
        {
          role: "user",
          content: `用户需求：${userPrompt}。${styleHint}这是一个 App 的宣传海报，App 截图将作为参考图。`,
        },
      ],
    });
    const expanded = completion.choices[0]?.message?.content?.trim();
    if (expanded && expanded.length > 20) return expanded;
  } catch (err) {
    console.warn("[aigc-tools] prompt expansion failed, using original:", err instanceof Error ? err.message : err);
  }
  // Fallback: return original prompt if LLM fails
  return userPrompt;
}

export interface AigcToolContext {
  projectId: string;
  sessionId: string;
  userId?: string;
  emit: (event: Record<string, unknown>) => void;
}

export function buildAigcTools(ctx: AigcToolContext): {
  schemas: ToolSchema[];
  handlers: Record<string, ToolHandler>;
} {
  const schemas: ToolSchema[] = [
    {
      type: "function",
      function: {
        name: "capture_screenshot",
        description: "Capture a real screenshot of the current App preview. Returns a base64 JPEG. Use this as the reference image before calling generate_poster.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "generate_poster",
        description: "Generate an AI-styled promotional poster using the App screenshot as reference image plus the user's style prompt. Returns a base64 PNG with watermark.",
        parameters: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Style and content description for the poster, e.g. 'cyberpunk neon style, dark background, add title CascadeAI'" },
            style: { type: "string", description: "Optional style preset: photorealistic | anime | oil-painting | watercolor | cyberpunk" },
          },
          required: ["prompt"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "record_demo_video",
        description: "Record a real demo video of the App running. Uses the pre-generated interaction script to simulate real user interactions. Returns a download URL.",
        parameters: {
          type: "object",
          properties: {
            duration: { type: "number", description: "Target video duration in seconds (10-30). Defaults to the duration hint from the interaction script." },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finish_aigc",
        description: "Signal that all AIGC tasks are complete. Call this after generating all requested media.",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Brief summary of what was generated" },
          },
          required: ["summary"],
        },
      },
    },
  ];

  // Shared screenshot state (reused across generate_poster calls in same session)
  let capturedScreenshotB64: string | null = null;

  const handlers: Record<string, ToolHandler> = {
    capture_screenshot: async (_args, emit) => {
      emit({ type: "aigc_action", label: "截取 App 真实画面" });
      try {
        const pwModule = "playwright";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { chromium } = await import(/* @vite-ignore */ pwModule) as any;
        const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
        const page = await browser.newPage();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`http://localhost:${PORT}/preview/${ctx.projectId}`, {
          waitUntil: "networkidle",
          timeout: 20_000,
        });
        // Brief wait for animations to settle
        await new Promise<void>((r) => setTimeout(r, 1500));
        const buffer: Buffer = await page.screenshot({ type: "jpeg", quality: 90 });
        await browser.close();
        capturedScreenshotB64 = buffer.toString("base64");
        emit({ type: "aigc_screenshot", dataUrl: `data:image/jpeg;base64,${capturedScreenshotB64}` });
        return "Screenshot captured successfully. You can now call generate_poster with a style prompt.";
      } catch (err) {
        throw new Error(`Screenshot failed: ${err instanceof Error ? err.message : err}`);
      }
    },

    generate_poster: async (args, emit) => {
      if (!capturedScreenshotB64) {
        throw new Error("No screenshot available. Call capture_screenshot first.");
      }
      const rawPrompt = args.prompt as string;
      const style = args.style as string | undefined;
      emit({ type: "aigc_action", label: "优化提示词…" });

      const expandedPrompt = await expandPosterPrompt(rawPrompt, style);
      emit({ type: "aigc_action", label: `生成海报: ${expandedPrompt.slice(0, 40)}…` });

      const result = await aigcProvider.generatePoster({
        prompt: expandedPrompt,
        referenceImageB64: capturedScreenshotB64,
        style,
      });

      // Apply watermark via FFmpeg
      const tmpIn = join(tmpdir(), `aigc-poster-in-${Date.now()}.png`);
      const tmpOut = join(tmpdir(), `aigc-poster-out-${Date.now()}.png`);
      let finalB64 = result.imageB64;
      try {
        await writeFile(tmpIn, Buffer.from(result.imageB64, "base64"));
        await addImageWatermark(tmpIn, tmpOut);
        const { readFile } = await import("fs/promises");
        finalB64 = (await readFile(tmpOut)).toString("base64");
      } catch (wmErr) {
        console.warn("[aigc-tools] watermark failed:", wmErr);
      } finally {
        rm(tmpIn, { force: true }).catch(() => {});
        rm(tmpOut, { force: true }).catch(() => {});
      }

      // ── Quality evaluation ───────────────────────────────────────────────
      emit({ type: "aigc_action", label: "质量检测中…" });
      const evalResult = await evaluatePoster(finalB64, expandedPrompt, ctx.sessionId);

      if (evalResult.shouldRetry) {
        // Auto-retry once with a freshened prompt
        incrementSessionRetry(ctx.sessionId);
        emit({ type: "aigc_action", label: `质量偏低(${evalResult.score}分)，自动优化重试…` });
        const retryPrompt = await expandPosterPrompt(`${rawPrompt}，注意提升视觉质量和专业感`, style);
        const retryResult = await aigcProvider.generatePoster({
          prompt: retryPrompt,
          referenceImageB64: capturedScreenshotB64!,
          style,
        });
        const tmpIn2 = join(tmpdir(), `aigc-poster-retry-in-${Date.now()}.png`);
        const tmpOut2 = join(tmpdir(), `aigc-poster-retry-out-${Date.now()}.png`);
        let retryB64 = retryResult.imageB64;
        try {
          await writeFile(tmpIn2, Buffer.from(retryResult.imageB64, "base64"));
          await addImageWatermark(tmpIn2, tmpOut2);
          const { readFile } = await import("fs/promises");
          retryB64 = (await readFile(tmpOut2)).toString("base64");
        } catch { /* watermark failure non-fatal */ } finally {
          rm(tmpIn2, { force: true }).catch(() => {});
          rm(tmpOut2, { force: true }).catch(() => {});
        }
        finalB64 = retryB64;
      }

      incrementDailyUsage(ctx.sessionId);

      // Fire-and-forget: extract style tags and update user preferences
      if (ctx.userId) {
        extractAndSaveStyleTags(ctx.userId, expandedPrompt, style).catch(() => {});
      }

      const dataUrl = `data:image/png;base64,${finalB64}`;
      const qualityHint = evalResult.score >= 70 ? "quality_good" : evalResult.score >= 55 ? "quality_fair" : "quality_low";
      emit({ type: "aigc_poster", dataUrl, prompt: expandedPrompt, score: evalResult.score, qualityHint });
      ctx.emit({ type: "aigc_poster_ready", dataUrl, sessionId: ctx.sessionId, score: evalResult.score, qualityHint });
      return `Poster generated. Score: ${evalResult.score}. DataURL length: ${dataUrl.length} chars.`;
    },

    record_demo_video: async (args, emit) => {
      emit({ type: "aigc_action", label: "录制 App 真实运行视频" });

      const projectRow = await storage.getProject(ctx.projectId).catch(() => null);
      const rawSequence = projectRow?.actionSequence;
      const durationHint = projectRow?.actionSequenceDuration ?? (args.duration as number | undefined) ?? 20;
      const duration = Math.min(Math.max(durationHint, 10), 30) as 10 | 20 | 30;

      const tmpDir = join(tmpdir(), `aigc-video-${ctx.sessionId}`);
      await mkdir(tmpDir, { recursive: true });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let browser: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let context: any = null;

      try {
        const pwModule = "playwright";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { chromium } = await import(/* @vite-ignore */ pwModule) as any;
        browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
        context = await browser.newContext({
          viewport: { width: 390, height: 844 },
          recordVideo: { dir: tmpDir, size: { width: 390, height: 844 } },
        });
        const page = await context.newPage();

        emit({ type: "aigc_action", label: "App 加载中…" });
        await page.goto(`http://localhost:${PORT}/preview/${ctx.projectId}`, {
          waitUntil: "networkidle",
          timeout: 30_000,
        });

        // Execute interaction script
        if (rawSequence) {
          try {
            const parsed = JSON.parse(rawSequence);
            const validation = validateDslSequence(parsed);
            if (validation.valid && validation.actions) {
              emit({ type: "aigc_action", label: `执行交互脚本 (${validation.actions.length} 步)` });
              const execResult = await executeDslSequence(page, validation.actions);
              if (execResult.failed > 0) {
                console.warn(`[aigc-tools] ${execResult.failed} DSL steps failed`);
              }
            }
          } catch (e) {
            console.warn("[aigc-tools] DSL execution error:", e);
          }
        } else {
          emit({ type: "aigc_action", label: "无交互脚本，录制静态展示" });
          await new Promise<void>((r) => setTimeout(r, (duration - 3) * 1000));
        }

        // Fill remaining time
        await new Promise<void>((r) => setTimeout(r, 2000));

        const videoHandle = await page.video();
        await context.close();
        context = null;
        await browser.close();
        browser = null;

        const rawVideoPath = await videoHandle?.path();
        if (!rawVideoPath || !existsSync(rawVideoPath)) {
          throw new Error("Playwright produced no video file");
        }

        // Watermark
        const watermarkedPath = rawVideoPath.replace(/\.\w+$/, "-wm.mp4");
        try {
          await addVideoWatermark(rawVideoPath, watermarkedPath);
          rm(rawVideoPath, { force: true }).catch(() => {});
        } catch {
          const { rename } = await import("fs/promises");
          await rename(rawVideoPath, watermarkedPath);
        }

        // Persist
        const videoId = `aigc-${ctx.sessionId}-${Date.now()}`;
        const storagePath = await videoStorage.save(videoId, watermarkedPath);
        const downloadUrl = videoStorage.getDownloadUrl(storagePath);

        // Save to DB
        const { randomUUID } = await import("crypto");
        const dbRecord = await storage.createProjectVideo({
          id: randomUUID(),
          projectId: ctx.projectId,
          status: "done",
          localPath: storagePath,
          duration,
          style: "raw",
        });
        // Mark finished
        await storage.updateProjectVideo(dbRecord.id, { finishedAt: new Date() });

        emit({ type: "aigc_video_ready", downloadUrl, storagePath });
        ctx.emit({ type: "aigc_video_ready", downloadUrl, sessionId: ctx.sessionId });
        return `Video recorded and saved. Download: ${downloadUrl}`;
      } finally {
        try { context?.close(); } catch {}
        try { browser?.close(); } catch {}
        rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    },

    finish_aigc: async (args, emit) => {
      emit({ type: "aigc_complete", summary: args.summary as string });
      return "AIGC tasks complete.";
    },
  };

  return { schemas, handlers };
}
