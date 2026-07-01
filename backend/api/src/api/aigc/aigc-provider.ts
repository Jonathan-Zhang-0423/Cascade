// AIGC provider: image-to-image (poster) and text-to-video via Doubao API.

export interface AigcPosterRequest {
  prompt: string;
  referenceImageB64: string;   // base64 JPEG/PNG from App screenshot
  style?: string;
}

export interface AigcPosterResult {
  imageB64: string;   // base64 PNG with watermark applied later
  provider: string;
}

export interface AigcVideoRequest {
  prompt: string;
  style?: string;
  duration?: number;
}

export interface AigcVideoResult {
  taskId?: string;
  videoUrl?: string;
  provider: string;
}

export interface AigcVideoStatus {
  status: "pending" | "running" | "done" | "failed";
  videoUrl?: string;
  progress?: number;
}

export interface IAigcProvider {
  readonly name: string;
  generatePoster(req: AigcPosterRequest): Promise<AigcPosterResult>;
  generateVideo(req: AigcVideoRequest): Promise<AigcVideoResult>;
  getVideoStatus(taskId: string): Promise<AigcVideoStatus>;
}

// ── Doubao implementation ────────────────────────────────────────────────────

const BASE = "https://ark.cn-beijing.volces.com/api/v3";

class DoubaoAigcProvider implements IAigcProvider {
  readonly name = "doubao";

  private async post<T>(path: string, body: unknown): Promise<T> {
    const apiKey = process.env.DOUBAO_API_KEY;
    if (!apiKey) throw new Error("DOUBAO_API_KEY not configured");
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Doubao API ${path} error ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<T>;
  }

  async generatePoster(req: AigcPosterRequest): Promise<AigcPosterResult> {
    const model = process.env.DOUBAO_IMAGE_I2I_MODEL ?? "doubao-seedream-3-0-i2i-250415";

    const data = await this.post<{ data: Array<{ b64_json?: string; url?: string }> }>(
      "/images/generations",
      {
        model,
        prompt: req.prompt,
        n: 1,
        size: "1024x1024",
        response_format: "b64_json",
        // Image reference passed as extra param — Doubao i2i API
        image: `data:image/jpeg;base64,${req.referenceImageB64}`,
      },
    );

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("Doubao i2i returned no image data");
    return { imageB64: b64, provider: this.name };
  }

  async generateVideo(req: AigcVideoRequest): Promise<AigcVideoResult> {
    const model = process.env.DOUBAO_VIDEO_MODEL ?? "doubao-seedance-1-0-lite-t2v-250428";
    const data = await this.post<{ id?: string; video_url?: string }>(
      "/contents/generations/tasks",
      { model, content: [{ type: "text", text: req.prompt }] },
    );
    return { provider: this.name, taskId: data.id, videoUrl: data.video_url };
  }

  async getVideoStatus(taskId: string): Promise<AigcVideoStatus> {
    const apiKey = process.env.DOUBAO_API_KEY;
    if (!apiKey) return { status: "failed" };
    const res = await fetch(`${BASE}/contents/generations/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { status: "failed" };
    const data = await res.json() as {
      status?: string;
      content?: Array<{ type: string; video_url?: { url: string } }>;
    };
    const map: Record<string, AigcVideoStatus["status"]> = {
      queued: "pending", running: "running", succeeded: "done", failed: "failed",
    };
    const videoItem = data.content?.find((c) => c.type === "video");
    return {
      status: map[data.status ?? ""] ?? "pending",
      videoUrl: videoItem?.video_url?.url,
    };
  }
}

export const aigcProvider: IAigcProvider = new DoubaoAigcProvider();
