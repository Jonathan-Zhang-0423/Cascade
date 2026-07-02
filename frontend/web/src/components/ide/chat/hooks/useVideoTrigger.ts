// Intercepts chat input for video-generation intent before it reaches the AI pipeline.
// Returns { intercepted: true } when the input matches a video trigger keyword,
// and fires the video generation flow — the caller should NOT proceed with normal send.

import { useState, useCallback } from "react";

const VIDEO_KEYWORDS_ZH = ["生成视频", "录制视频", "录视频", "生成演示", "录制演示", "分享视频", "生成分享视频", "视频分享"];
const VIDEO_KEYWORDS_EN = ["generate video", "record video", "create video", "demo video", "share video"];

function isVideoIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return VIDEO_KEYWORDS_ZH.some((k) => text.includes(k)) ||
    VIDEO_KEYWORDS_EN.some((k) => lower.includes(k));
}

export type VideoTriggerStatus =
  | { phase: "idle" }
  | { phase: "generating"; jobId: string; progress: number }
  | { phase: "done"; jobId: string; videoId?: string; downloadUrl: string }
  | { phase: "error"; message: string };

interface UseVideoTriggerOptions {
  projectId: string | undefined;
  /** Called on every status change so the parent can surface UI */
  onStatus?: (status: VideoTriggerStatus) => void;
}

const POLL_INTERVAL_MS = 1500;

export function useVideoTrigger({ projectId, onStatus }: UseVideoTriggerOptions) {
  const [status, setStatus] = useState<VideoTriggerStatus>({ phase: "idle" });

  const update = useCallback((s: VideoTriggerStatus) => {
    setStatus(s);
    onStatus?.(s);
  }, [onStatus]);

  const triggerVideo = useCallback(async (duration: 10 | 20 | 30 = 20) => {
    if (!projectId) {
      update({ phase: "error", message: "No active project" });
      return;
    }

    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, duration }),
      });

      if (res.status === 422) {
        const body = await res.json().catch(() => ({})) as { framework?: string };
        update({ phase: "error", message: `当前框架（${body.framework ?? "未知"}）暂不支持视频录制，仅支持 Web App。` });
        return;
      }
      if (res.status === 429) {
        update({ phase: "error", message: "视频任务队列已满，请稍后再试。" });
        return;
      }
      if (!res.ok) {
        update({ phase: "error", message: "视频生成请求失败" });
        return;
      }

      const { jobId, videoId } = await res.json() as { jobId: string; videoId?: string };
      update({ phase: "generating", jobId, progress: 0 });

      // Poll status
      const poll = setInterval(async () => {
        try {
          const sr = await fetch(`/api/video/status/${jobId}`);
          if (!sr.ok) { clearInterval(poll); update({ phase: "error", message: "状态查询失败" }); return; }
          const s = await sr.json() as { status: string; progress: number; error?: string };

          if (s.status === "running" || s.status === "pending") {
            update({ phase: "generating", jobId, progress: s.progress });
          } else if (s.status === "done") {
            clearInterval(poll);
            const downloadUrl = videoId
              ? `/api/video/file/${videoId}`
              : `/api/video/download/${jobId}`;
            update({ phase: "done", jobId, videoId, downloadUrl });
          } else if (s.status === "error") {
            clearInterval(poll);
            update({ phase: "error", message: s.error ?? "录制失败" });
          }
        } catch {
          clearInterval(poll);
          update({ phase: "error", message: "网络错误" });
        }
      }, POLL_INTERVAL_MS);
    } catch {
      update({ phase: "error", message: "视频生成请求异常" });
    }
  }, [projectId, update]);

  /** Try to intercept input — returns true if intercepted (caller should not proceed with normal send) */
  const tryIntercept = useCallback((text: string): boolean => {
    if (!isVideoIntent(text)) return false;
    triggerVideo(20);
    return true;
  }, [triggerVideo]);

  const reset = useCallback(() => update({ phase: "idle" }), [update]);

  return { status, tryIntercept, triggerVideo, reset };
}
