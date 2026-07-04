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
import { evaluatePoster, incrementSessionRetry, incrementDailyUsage, checkDailyQuota } from "../../infra/aigc-evaluator";

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
    }, { signal: AbortSignal.timeout(10_000) });
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
    }, { signal: AbortSignal.timeout(15_000) });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    // MiniMax/reasoning models sometimes prepend <think>...</think> blocks.
    // Strip them — otherwise the tag leaks into the card's step label AND into
    // the Doubao image prompt (which can make generation fail).
    const expanded = stripThink(raw);
    if (expanded && expanded.length > 20) return expanded;
  } catch (err) {
    console.warn("[aigc-tools] prompt expansion failed, using original:", err instanceof Error ? err.message : err);
  }
  // Fallback: return original prompt if LLM fails (stripped, in case kimi
  // passed <think> tags in the prompt arg).
  return stripThink(userPrompt);
}

/** Strip <think>...</think> (and unclosed <think>...) blocks from LLM output. */
function stripThink(s: string): string {
  return s
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

export interface AigcToolContext {
  projectId: string;
  sessionId: string;
  userId?: string;
  emit: (event: Record<string, unknown>) => void;
  /** Blocks until the user submits a poster style (resolved by POST /style). */
  requestStyle: () => Promise<string>;
  /** User's session cookie header — injected into the screenshot browser so
   *  /preview/:projectId doesn't redirect to login. */
  cookie?: string;
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
        name: "request_style",
        description: "Ask the user to choose/enter a poster style. BLOCKS until the user submits a style, then returns the style string. Call this immediately after capture_screenshot, and use the returned string as the prompt for generate_poster.",
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
  // Workflow guards — track what has actually been produced so finish_aigc
  // can refuse to exit prematurely (the LLM sometimes calls finish_aigc right
  // after capture_screenshot, skipping generate_poster, yielding no media).
  let posterGenerated = false;
  let videoStarted = false;
  let videoGenerated = false;

  const handlers: Record<string, ToolHandler> = {
    capture_screenshot: async (_args, emit) => {
      emit({ type: "aigc_action", label: "截取 App 真实画面" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let browser: any = null;
      try {
        const pwModule = "playwright";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { chromium } = await import(/* @vite-ignore */ pwModule) as any;
        browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
        // Inject the user's session cookie so /preview/:projectId (which calls
        // authed project APIs) doesn't redirect to the login page — without
        // this the screenshot was capturing the login screen.
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        if (ctx.cookie) {
          const cookies = ctx.cookie.split(";").map((c) => {
            const idx = c.indexOf("=");
            const name = (idx >= 0 ? c.slice(0, idx) : c).trim();
            const value = idx >= 0 ? c.slice(idx + 1).trim() : "";
            return name ? { name, value, domain: "localhost", path: "/" } : null;
          }).filter(Boolean) as Array<{ name: string; value: string; domain: string; path: string }>;
          if (cookies.length) await context.addCookies(cookies);
        }
        const page = await context.newPage();
        await page.goto(`http://localhost:${PORT}/preview/${ctx.projectId}`, {
          waitUntil: "networkidle",
          timeout: 20_000,
        });
        // If the page redirected to /login, the project preview isn't accessible
        // (missing/invalid session) — fail loudly with an actionable message.
        const url = page.url();
        if (url.includes("/login") || url.includes("/auth")) {
          throw new Error("截图被重定向到登录页（会话 cookie 未生效），无法获取 App 预览。请确认已登录后重试。");
        }
        // Brief wait for animations to settle
        await new Promise<void>((r) => setTimeout(r, 1500));
        const buffer: Buffer = await page.screenshot({ type: "jpeg", quality: 90 });
        capturedScreenshotB64 = buffer.toString("base64");
        emit({ type: "aigc_screenshot", dataUrl: `data:image/jpeg;base64,${capturedScreenshotB64}` });
        return "Screenshot captured successfully. You can now call request_style to ask the user for a poster style.";
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error("[aigc-tools] screenshot failed:", detail);
        throw new Error("截图失败：请先确保 App 已初步构建完成且可正常预览，再重新生成海报。");
      } finally {
        // Always release the Chromium process — a throw on goto/screenshot used
        // to skip browser.close() and leak a full browser + children per failure.
        try { await browser?.close(); } catch {}
      }
    },

    request_style: async (_args, emit) => {
      emit({ type: "aigc_action", label: "等待用户选择风格" });
      emit({ type: "aigc_need_style" });
      // Blocks inside the agent loop until POST /api/aigc/session/:id/style
      // resolves session.styleResolver. Returns the user's style string.
      const style = await ctx.requestStyle();
      return `User selected style: ${style}. Use this as the prompt for generate_poster.`;
    },

    generate_poster: async (args, emit) => {
      // Screenshot is required — the poster is meant to reflect the real App UI.
      const refImage = capturedScreenshotB64;
      if (!refImage) {
        throw new Error("尚未截取 App 画面。请先确保 App 已初步构建完成且可正常预览，再重新生成海报。");
      }
      // kimi sometimes wraps the prompt arg in <think>...</think> tags; strip
      // them at the entry so no think content leaks into the card label or the
      // image-generation prompt.
      const rawPrompt = stripThink((args.prompt as string) ?? "");
      const style = args.style as string | undefined;

      // Per-user daily quota. Previously incrementDailyUsage was keyed by
      // sessionId (bug) and checkDailyQuota was never called, so the 20/day
      // limit was never enforced. Enforce here, keyed by userId.
      if (ctx.userId) {
        const quota = checkDailyQuota(ctx.userId);
        if (!quota.allowed) {
          throw new Error("今日海报生成次数已达上限（20次），请明日再试。");
        }
      }

      emit({ type: "aigc_action", label: "优化提示词" });

      const expandedPrompt = await expandPosterPrompt(rawPrompt, style);
      emit({ type: "aigc_action", label: "生成海报" });

      const result = await aigcProvider.generatePoster({
        prompt: expandedPrompt,
        referenceImageB64: refImage,
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
        // Watermarking is a hard requirement — fail loudly rather than emit an
        // unwatermarked poster (silent policy bypass).
        console.error("[aigc-tools] watermark failed:", wmErr);
        throw new Error("海报水印添加失败，请重试。");
      } finally {
        rm(tmpIn, { force: true }).catch(() => {});
        rm(tmpOut, { force: true }).catch(() => {});
      }

      // ── Quality evaluation ───────────────────────────────────────────────
      emit({ type: "aigc_action", label: "质量检测中" });
      const evalResult = await evaluatePoster(finalB64, expandedPrompt, ctx.sessionId);

      if (evalResult.shouldRetry) {
        // Auto-retry once with a freshened prompt
        incrementSessionRetry(ctx.sessionId);
        emit({ type: "aigc_action", label: `质量偏低(${evalResult.score}分)，自动优化重试` });
        const retryPrompt = await expandPosterPrompt(`${rawPrompt}，注意提升视觉质量和专业感`, style);
        const retryResult = await aigcProvider.generatePoster({
          prompt: retryPrompt,
          referenceImageB64: refImage,
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
        } catch (wmErr) {
          console.error("[aigc-tools] retry watermark failed:", wmErr);
          throw new Error("海报水印添加失败，请重试。");
        } finally {
          rm(tmpIn2, { force: true }).catch(() => {});
          rm(tmpOut2, { force: true }).catch(() => {});
        }
        finalB64 = retryB64;
      }

      // Key by userId (was sessionId — quota was never actually enforced per user).
      if (ctx.userId) incrementDailyUsage(ctx.userId);

      // Fire-and-forget: extract style tags and update user preferences
      if (ctx.userId) {
        extractAndSaveStyleTags(ctx.userId, expandedPrompt, style).catch(() => {});
      }

      const dataUrl = `data:image/png;base64,${finalB64}`;
      const qualityHint = evalResult.score >= 70 ? "quality_good" : evalResult.score >= 55 ? "quality_fair" : "quality_low";
      emit({ type: "aigc_poster", dataUrl, prompt: expandedPrompt, score: evalResult.score, qualityHint });
      ctx.emit({ type: "aigc_poster_ready", dataUrl, sessionId: ctx.sessionId, score: evalResult.score, qualityHint });
      posterGenerated = true;
      return `Poster generated. Score: ${evalResult.score}. DataURL length: ${dataUrl.length} chars.`;
    },

    record_demo_video: async (args, emit) => {
      videoStarted = true;
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
        // Inject user session cookie so /preview doesn't redirect to login.
        if (ctx.cookie) {
          const vcookies = ctx.cookie.split(";").map((c) => {
            const idx = c.indexOf("=");
            const name = (idx >= 0 ? c.slice(0, idx) : c).trim();
            const value = idx >= 0 ? c.slice(idx + 1).trim() : "";
            return name ? { name, value, domain: "localhost", path: "/" } : null;
          }).filter(Boolean) as Array<{ name: string; value: string; domain: string; path: string }>;
          if (vcookies.length) await context.addCookies(vcookies);
        }
        const page = await context.newPage();

        emit({ type: "aigc_action", label: "App 加载中" });
        await page.goto(`http://localhost:${PORT}/preview/${ctx.projectId}`, {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        const vurl = page.url();
        if (vurl.includes("/login") || vurl.includes("/auth")) {
          throw new Error("录屏被重定向到登录页（会话 cookie 未生效），无法获取 App 预览。");
        }

        // Execute interaction script
        if (rawSequence) {
          try {
            const parsed = JSON.parse(rawSequence);
            const validation = validateDslSequence(parsed);
            if (validation.valid && validation.actions) {
              emit({ type: "aigc_action", label: `执行交互脚本 (${validation.actions.length} 步)` });
              // Bound DSL execution — an unbounded waitForSelector/waitForTimeout
              // step would otherwise hang the recording forever, and the finally
              // below (browser/tmpDir cleanup) only runs on throw/return, not hang.
              const execResult = await Promise.race([
                executeDslSequence(page, validation.actions),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error("DSL 执行超时")), 60_000),
                ),
              ]);
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
        videoGenerated = true;
        return `Video recorded and saved. Download: ${downloadUrl}`;
      } finally {
        try { context?.close(); } catch {}
        try { browser?.close(); } catch {}
        rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    },

    finish_aigc: async (args, emit) => {
      // Hard workflow guard: the LLM sometimes calls finish_aigc right after
      // capture_screenshot, skipping generate_poster — which yields a "done"
      // with no media. Refuse to exit until the requested media actually exists,
      // so the loop re-prompts the LLM to call generate_poster / record_demo_video.
      if (capturedScreenshotB64 && !posterGenerated) {
        throw new Error("你已截取 App 画面，但还未生成海报。请先调用 generate_poster（带上 style prompt）生成海报，然后再调用 finish_aigc。禁止在生成海报之前结束。");
      }
      if (videoStarted && !videoGenerated) {
        throw new Error("你已开始录制视频，但还未产出视频。请先完成 record_demo_video，再调用 finish_aigc。");
      }
      emit({ type: "aigc_complete", summary: args.summary as string });
      return "AIGC tasks complete.";
    },
  };

  return { schemas, handlers };
}
