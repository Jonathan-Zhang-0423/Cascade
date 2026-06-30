// AIGC provider abstraction — image and video generation.
// Default implementation calls Doubao's image generation API.
// Swap the provider by setting AIGC_PROVIDER env var or implementing a new class.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AigcImageRequest {
  prompt: string;
  negativePrompt?: string;
  style?: string;       // e.g. "anime", "photorealistic", "oil-painting"
  width?: number;
  height?: number;
  n?: number;           // number of images, default 1
}

export interface AigcImageResult {
  images: Array<{
    url?: string;
    b64?: string;        // base64 data URL when no CDN
  }>;
  provider: string;
}

export interface AigcVideoRequest {
  prompt: string;
  negativePrompt?: string;
  duration?: number;    // seconds, default 5
  style?: string;
  referenceImageUrl?: string;
}

export interface AigcVideoResult {
  // Async providers return a taskId; poll /api/aigc/video/status/:taskId
  taskId?: string;
  // Sync providers return the video URL directly
  videoUrl?: string;
  provider: string;
}

export interface IAigcProvider {
  generateImage(req: AigcImageRequest): Promise<AigcImageResult>;
  generateVideo(req: AigcVideoRequest): Promise<AigcVideoResult>;
  /** For async video providers: poll task status */
  getVideoStatus?(taskId: string): Promise<{ status: "pending" | "running" | "done" | "failed"; videoUrl?: string; progress?: number }>;
  readonly name: string;
}

// ─── Doubao image generation ──────────────────────────────────────────────────
// Uses the Doubao/Ark image generation endpoint (OpenAI-compatible images.generate)

class DoubaoAigcProvider implements IAigcProvider {
  readonly name = "doubao";

  async generateImage(req: AigcImageRequest): Promise<AigcImageResult> {
    const apiKey = process.env.DOUBAO_API_KEY;
    if (!apiKey) throw new Error("DOUBAO_API_KEY not configured");

    // Doubao image generation model — configurable via env
    const model = process.env.DOUBAO_IMAGE_MODEL || "doubao-seedream-3-0-t2i-250415";
    const size = req.width && req.height ? `${req.width}x${req.height}` : "1024x1024";

    const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: req.prompt,
        n: req.n ?? 1,
        size,
        response_format: "url",
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Doubao image API error ${response.status}: ${text}`);
    }

    const data = await response.json() as { data: Array<{ url?: string; b64_json?: string }> };
    return {
      provider: this.name,
      images: (data.data ?? []).map((d) => ({
        url: d.url,
        b64: d.b64_json ? `data:image/png;base64,${d.b64_json}` : undefined,
      })),
    };
  }

  async generateVideo(req: AigcVideoRequest): Promise<AigcVideoResult> {
    // Doubao video generation — uses the async task API
    const apiKey = process.env.DOUBAO_API_KEY;
    if (!apiKey) throw new Error("DOUBAO_API_KEY not configured");

    const model = process.env.DOUBAO_VIDEO_MODEL || "doubao-seedance-1-0-lite-t2v-250428";

    const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        content: [{ type: "text", text: req.prompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Doubao video API error ${response.status}: ${text}`);
    }

    const data = await response.json() as { id?: string };
    return {
      provider: this.name,
      taskId: data.id,
    };
  }

  async getVideoStatus(taskId: string): Promise<{ status: "pending" | "running" | "done" | "failed"; videoUrl?: string; progress?: number }> {
    const apiKey = process.env.DOUBAO_API_KEY;
    if (!apiKey) throw new Error("DOUBAO_API_KEY not configured");

    const response = await fetch(`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      return { status: "failed" };
    }

    const data = await response.json() as {
      status?: string;
      content?: Array<{ type: string; video_url?: { url: string } }>;
    };

    const statusMap: Record<string, "pending" | "running" | "done" | "failed"> = {
      queued: "pending",
      running: "running",
      succeeded: "done",
      failed: "failed",
    };

    const normalized = statusMap[data.status ?? ""] ?? "pending";
    const videoItem = data.content?.find((c) => c.type === "video");

    return {
      status: normalized,
      videoUrl: videoItem?.video_url?.url,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const aigcProvider: IAigcProvider = new DoubaoAigcProvider();
