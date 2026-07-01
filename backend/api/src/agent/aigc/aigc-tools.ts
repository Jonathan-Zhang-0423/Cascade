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

const PORT = parseInt(process.env.PORT ?? "5000", 10);

export interface AigcToolContext {
  projectId: string;
  sessionId: string;
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
      const prompt = args.prompt as string;
      emit({ type: "aigc_action", label: `生成海报: ${prompt.slice(0, 40)}` });

      const result = await aigcProvider.generatePoster({
        prompt,
        referenceImageB64: capturedScreenshotB64,
        style: args.style as string | undefined,
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

      const dataUrl = `data:image/png;base64,${finalB64}`;
      emit({ type: "aigc_poster", dataUrl, prompt });
      ctx.emit({ type: "aigc_poster_ready", dataUrl, sessionId: ctx.sessionId });
      return `Poster generated. DataURL length: ${dataUrl.length} chars.`;
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
