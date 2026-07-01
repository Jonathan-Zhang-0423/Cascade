// Intercepts chat input for poster/video generation intent.
// Two-level detection: fast keyword match → LLM classify on miss.
// Returns { intercepted: true } when intent is detected — caller should NOT proceed with normal send.

import { useState, useCallback } from "react";

export type MediaIntent = "poster" | "video";

// ── Level 1: keyword lists ────────────────────────────────────────────────────

const POSTER_KW_ZH = ["生图", "生成图片", "做海报", "生成海报", "宣传图", "宣传海报", "设计海报", "推广图", "封面图", "做张图", "生成封面", "帮我画", "生成宣传", "做个海报", "app海报", "应用海报", "产品海报", "生成poster"];
const POSTER_KW_REGEX = /生成.{0,6}海报|做.{0,4}海报/;
const POSTER_KW_EN = ["generate image", "create poster", "make poster", "promotional image", "create image", "make image", "design poster"];

const VIDEO_KW_ZH = ["生成视频", "录制视频", "录视频", "生成演示", "录制演示", "分享视频", "生成分享视频", "视频分享", "做个视频", "录个视频", "生成一段视频", "演示视频"];
const VIDEO_KW_EN = ["generate video", "record video", "create video", "demo video", "share video", "record demo"];

function keywordDetect(text: string): MediaIntent | null {
  const lower = text.toLowerCase();
  if (
    POSTER_KW_ZH.some((k) => text.includes(k)) ||
    POSTER_KW_EN.some((k) => lower.includes(k)) ||
    POSTER_KW_REGEX.test(text)
  ) return "poster";
  if (VIDEO_KW_ZH.some((k) => text.includes(k)) || VIDEO_KW_EN.some((k) => lower.includes(k))) return "video";
  return null;
}

// ── Level 2: LLM classify (MiniMax via backend proxy) ────────────────────────

async function llmDetect(text: string): Promise<MediaIntent | null> {
  try {
    const res = await fetch("/api/aigc/classify-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { intent: string };
    if (data.intent === "poster" || data.intent === "video") return data.intent;
    return null;
  } catch {
    return null;
  }
}

// ── Status types ──────────────────────────────────────────────────────────────

export type MediaTriggerStatus =
  | { phase: "idle" }
  | { phase: "classifying" }
  | { phase: "generating"; type: MediaIntent; label: string; progress?: number; jobId?: string }
  | { phase: "done"; type: MediaIntent; downloadUrl: string; jobId?: string; videoId?: string }
  | { phase: "error"; message: string };

interface UseMediaTriggerOptions {
  projectId: string | undefined;
  onStatus?: (status: MediaTriggerStatus) => void;
}

const POLL_MS = 1500;

export function useMediaTrigger({ projectId, onStatus }: UseMediaTriggerOptions) {
  const [status, setStatus] = useState<MediaTriggerStatus>({ phase: "idle" });

  const update = useCallback((s: MediaTriggerStatus) => {
    setStatus(s);
    onStatus?.(s);
  }, [onStatus]);

  // ── Video flow (existing /api/video/generate) ──────────────────────────────
  const triggerVideo = useCallback(async (duration: 10 | 20 | 30 = 20) => {
    if (!projectId) { update({ phase: "error", message: "No active project" }); return; }
    update({ phase: "generating", type: "video", label: "准备录制视频…", progress: 0 });
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, duration }),
      });
      if (res.status === 422) {
        const body = await res.json().catch(() => ({})) as { framework?: string };
        update({ phase: "error", message: `当前框架（${body.framework ?? "未知"}）暂不支持视频录制` });
        return;
      }
      if (res.status === 429) { update({ phase: "error", message: "视频任务队列已满，请稍后再试" }); return; }
      if (!res.ok) { update({ phase: "error", message: "视频生成请求失败" }); return; }

      const { jobId, videoId } = await res.json() as { jobId: string; videoId?: string };
      update({ phase: "generating", type: "video", label: "录制中…", progress: 0, jobId });

      const poll = setInterval(async () => {
        try {
          const sr = await fetch(`/api/video/status/${jobId}`);
          if (!sr.ok) { clearInterval(poll); update({ phase: "error", message: "状态查询失败" }); return; }
          const s = await sr.json() as { status: string; progress: number; error?: string };
          if (s.status === "running" || s.status === "pending") {
            update({ phase: "generating", type: "video", label: `录制中… ${s.progress > 0 ? s.progress + "%" : ""}`, progress: s.progress, jobId });
          } else if (s.status === "done") {
            clearInterval(poll);
            const downloadUrl = videoId ? `/api/video/file/${videoId}` : `/api/video/download/${jobId}`;
            update({ phase: "done", type: "video", downloadUrl, jobId, videoId });
          } else if (s.status === "error") {
            clearInterval(poll);
            update({ phase: "error", message: s.error ?? "录制失败" });
          }
        } catch { clearInterval(poll); update({ phase: "error", message: "网络错误" }); }
      }, POLL_MS);
    } catch { update({ phase: "error", message: "视频生成请求异常" }); }
  }, [projectId, update]);

  // ── Poster flow (AIGC session) ─────────────────────────────────────────────
  const triggerPoster = useCallback(async (prompt: string) => {
    if (!projectId) { update({ phase: "error", message: "No active project" }); return; }
    update({ phase: "generating", type: "poster", label: "启动 AIGC 会话…" });
    try {
      const res = await fetch("/api/aigc/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) { update({ phase: "error", message: "AIGC 会话启动失败" }); return; }
      const { sessionId } = await res.json() as { sessionId: string };

      // Listen for SSE events
      const es = new EventSource(`/api/aigc/session/${sessionId}/stream`);
      es.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as { type: string; label?: string; dataUrl?: string; downloadUrl?: string };
          if (event.type === "aigc_action") {
            update({ phase: "generating", type: "poster", label: event.label ?? "生成中…" });
          } else if (event.type === "aigc_poster_ready" && event.dataUrl) {
            es.close();
            update({ phase: "done", type: "poster", downloadUrl: event.dataUrl });
          } else if (event.type === "aigc_done") {
            es.close();
          }
        } catch {}
      };
      es.onerror = () => {
        es.close();
        update((prev) => prev.phase === "generating" ? { phase: "error", message: "连接中断" } : prev);
      };

      // Send the message
      await fetch(`/api/aigc/session/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `请为这个 App 生成宣传海报。风格要求：${prompt}` }),
      });
    } catch { update({ phase: "error", message: "海报生成请求异常" }); }
  }, [projectId, update]);

  // ── Main intercept ─────────────────────────────────────────────────────────
  const tryIntercept = useCallback(async (text: string): Promise<boolean> => {
    // Level 1: keyword — fast, no LLM cost
    const kw = keywordDetect(text);
    if (kw === "video") { triggerVideo(20); return true; }
    if (kw === "poster") { triggerPoster(text); return true; }

    // Level 2: LLM classify — only when text strongly suggests media intent.
    // Skip if: too short (<6 chars), looks like a build/code request, or
    // contains common non-media verbs that would never be media intent.
    const SKIP_PATTERNS = [
      /做.*游戏|写.*代码|开发|实现|帮我做|帮我写|帮我建|帮我搭|创建|新建|生成.*页面|生成.*功能|生成.*组件|修复|debug|fix|build|create.*app|make.*app/i,
    ];
    const MEDIA_HINTS = /图|视频|海报|封面|宣传|分享|录|截图|poster|video|image|share|screenshot/i;

    const likelyMedia = MEDIA_HINTS.test(text);
    const likelyBuild = SKIP_PATTERNS.some((p) => p.test(text));

    if (!likelyMedia || likelyBuild || text.length < 6) {
      return false;
    }

    // Only reach LLM when text has media-related words but no keyword matched
    update({ phase: "classifying" });
    const llm = await llmDetect(text);
    if (llm === "video") { triggerVideo(20); return true; }
    if (llm === "poster") { triggerPoster(text); return true; }

    update({ phase: "idle" });
    return false;
  }, [triggerVideo, triggerPoster, update]);

  const reset = useCallback(() => update({ phase: "idle" }), [update]);

  return { status, tryIntercept, triggerVideo, triggerPoster, reset };
}
