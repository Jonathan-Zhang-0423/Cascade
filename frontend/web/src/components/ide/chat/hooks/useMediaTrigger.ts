// Intercepts chat input for poster/video generation intent.
// Two-level detection: fast keyword match → LLM classify on miss.
// Returns { intercepted: true } when intent is detected — caller should NOT proceed with normal send.

import { useState, useCallback, useEffect, useRef } from "react";

export type MediaIntent = "poster" | "video";

// ── Level 1: keyword lists ────────────────────────────────────────────────────
// HIGH-PRECISION only. Ambiguous phrases (生成演示 / 做个视频 / 帮我画 / 做张图 / 生成封面 …)
// are intentionally NOT here — they collide with build intent ("生成演示页面", "做一个图片轮播组件")
// and are left to the Level-2 LLM classifier instead. Broad lists here caused the regression where
// normal build prompts were intercepted and swallowed.

const POSTER_KW_ZH = ["生成海报", "宣传海报", "设计海报", "推广海报", "产品海报", "应用海报", "生成poster"];
// Regex kept tight: requires the literal "海报" anchored to a generation/design verb.
const POSTER_KW_REGEX = /生成.{0,10}海报|设计.{0,6}海报|做.{0,4}海报/;
const POSTER_KW_EN = ["generate poster", "create poster", "make poster", "design poster"];

const VIDEO_KW_ZH = ["生成视频", "录制视频", "录视频", "分享视频"];
const VIDEO_KW_EN = ["generate video", "record video", "create video", "share video"];

// Strong build-intent signals. If ANY is present we NEVER intercept as AIGC — the user wants code,
// not media. These are build-specific nouns/verbs that pure media requests rarely contain, so this
// is a safe negative gate that stops e.g. "做一个图片轮播组件" / "生成演示页面" from being misrouted.
const BUILD_INTENT =
  /组件|页面|功能|界面|登录|轮播|表单|按钮|导航|弹窗|api|后端|前端|数据库|写代码|开发|实现|修复|debug|写一个|建一个|做个app|做一个app|做个应用|做一个应用|create.*app|make.*app|build.*app/i;

/** Whether the text carries strong build intent (→ should NOT trigger AIGC). Exported for tests. */
export function hasBuildIntent(text: string): boolean {
  return BUILD_INTENT.test(text);
}

/**
 * Level-1 detection. Build-intent veto runs FIRST: even a hard media keyword is ignored when the
 * prompt is clearly a build request (e.g. "生成海报组件" = build a poster component).
 */
export function keywordDetect(text: string): MediaIntent | null {
  if (hasBuildIntent(text)) return null;
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
  | { phase: "awaiting_style"; currentStep: number; screenshotUrl?: string }
  | { phase: "generating"; type: MediaIntent; currentStep: number; label?: string; progress?: number; jobId?: string }
  | { phase: "done"; type: MediaIntent; downloadUrl?: string; currentStep: number; jobId?: string; videoId?: string; noMedia?: boolean }
  | { phase: "error"; message: string; currentStep: number };

interface UseMediaTriggerOptions {
  projectId: string | undefined;
  onStatus?: (status: MediaTriggerStatus) => void;
  /** Push AIGC progress/result as chat messages into the conversation flow */
  onMessage?: (content: string, role?: "assistant" | "system") => void;
  /** Add user message to chat flow (called before onMessage) */
  onUserMessage?: (content: string) => void;
  /** Abort the in-flight manager/build stream so a late Level-2 AIGC switch
   *  doesn't run concurrently with normal planning. No-op if nothing is running. */
  abortManager?: () => void;
}

const POLL_MS = 1500;

export function useMediaTrigger({ projectId, onStatus, onMessage, onUserMessage, abortManager }: UseMediaTriggerOptions) {
  const [status, setStatus] = useState<MediaTriggerStatus>({ phase: "idle" });

  const update = useCallback((s: MediaTriggerStatus) => {
    setStatus(s);
    onStatus?.(s);
  }, [onStatus]);

  // ── Resource tracking + watchdog (robustness) ───────────────────────────────
  // Hold live handles so we can tear them down on cancel, on terminal event,
  // on watchdog timeout, and on unmount — preventing EventSource/setInterval
  // leaks and stuck "generating" state when the backend never sends a terminal
  // event.
  const esRef = useRef<EventSource | null>(null);
  // Current AIGC poster sessionId — needed by submitStyle to POST /style.
  const sessionIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic token per tryIntercept call — a late Level-2 LLM resolution
  // checks this to avoid triggering AIGC on a stale prompt after the user has
  // already sent another message.
  const sendTokenRef = useRef(0);
  // Current fixed-step index (see AIGC_STEPS in chat-panel). Tracked in a ref so
  // error/timeout handlers know which step failed.
  const currentStepRef = useRef(0);
  const setStep = useCallback((n: number) => { currentStepRef.current = n; return n; }, []);
  const WATCHDOG_MS = 90_000;

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
  }, []);

  const cleanupResources = useCallback(() => {
    clearWatchdog();
    if (esRef.current) { try { esRef.current.close(); } catch {} esRef.current = null; }
    sessionIdRef.current = null;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, [clearWatchdog]);

  const startWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      cleanupResources();
      update({ phase: "error", message: "生成超时，请重试", currentStep: currentStepRef.current });
      onMessage?.("⏱ 生成超时，已自动取消，请重试。", "assistant");
    }, WATCHDOG_MS);
  }, [clearWatchdog, cleanupResources, update, onMessage]);

  // Tear down everything on unmount so navigating away mid-generation doesn't
  // leak an EventSource / polling interval or call setState after unmount.
  useEffect(() => () => cleanupResources(), [cleanupResources]);

  /** User-initiated cancel: release resources and return to idle. */
  const cancel = useCallback(() => {
    cleanupResources();
    currentStepRef.current = 0;
    update({ phase: "idle" });
  }, [cleanupResources, update]);

  /** User submitted a poster style — resume the agent's request_style step. */
  const submitStyle = useCallback(async (style: string) => {
    const trimmed = style.trim();
    const sid = sessionIdRef.current;
    if (!trimmed) return;
    if (!sid) {
      update({ phase: "error", message: "会话已失效，请重试", currentStep: currentStepRef.current });
      return;
    }
    setStep(2); // → "生成海报" step
    update({ phase: "generating", type: "poster", currentStep: 2, label: "正在生成海报" });
    startWatchdog();
    try {
      const r = await fetch(`/api/aigc/session/${sid}/style`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: trimmed }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `style submit failed (${r.status})`);
      }
      // The agent now proceeds to generate_poster; further aigc_action /
      // aigc_poster_ready events arrive via the still-open EventSource.
    } catch (err) {
      cleanupResources();
      update({ phase: "error", message: err instanceof Error ? err.message : "风格提交失败", currentStep: currentStepRef.current });
    }
  }, [setStep, update, startWatchdog, cleanupResources]);

  // ── Video flow (existing /api/video/generate) ──────────────────────────────
  const triggerVideo = useCallback(async (duration: 10 | 20 | 30 = 20) => {
    if (!projectId) { update({ phase: "error", message: "No active project", currentStep: setStep(0) }); return; }
    cleanupResources();
    setStep(0); // → "录制视频" step
    update({ phase: "generating", type: "video", currentStep: 0, label: "准备录制视频", progress: 0 });
    startWatchdog();
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, duration }),
      });
      if (res.status === 422) {
        const body = await res.json().catch(() => ({})) as { framework?: string };
        cleanupResources();
        update({ phase: "error", message: `当前框架（${body.framework ?? "未知"}）暂不支持视频录制`, currentStep: currentStepRef.current });
        return;
      }
      if (res.status === 429) { cleanupResources(); update({ phase: "error", message: "视频任务队列已满，请稍后再试", currentStep: currentStepRef.current }); return; }
      if (!res.ok) { cleanupResources(); update({ phase: "error", message: "视频生成请求失败", currentStep: currentStepRef.current }); return; }

      const { jobId, videoId } = await res.json() as { jobId: string; videoId?: string };
      update({ phase: "generating", type: "video", currentStep: 0, label: "录制中", progress: 0, jobId });

      const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
      const poll = setInterval(async () => {
        try {
          const sr = await fetch(`/api/video/status/${jobId}`);
          if (!sr.ok) { stopPoll(); clearWatchdog(); update({ phase: "error", message: "状态查询失败", currentStep: currentStepRef.current }); return; }
          const s = await sr.json() as { status: string; progress: number; error?: string };
          if (s.status === "running" || s.status === "pending") {
            update({ phase: "generating", type: "video", currentStep: 0, label: `录制中 ${s.progress > 0 ? s.progress + "%" : ""}`, progress: s.progress, jobId });
          } else if (s.status === "done") {
            stopPoll(); clearWatchdog();
            const downloadUrl = videoId ? `/api/video/file/${videoId}` : `/api/video/download/${jobId}`;
            update({ phase: "done", type: "video", downloadUrl, currentStep: setStep(1), jobId, videoId });
          } else if (s.status === "error") {
            stopPoll(); clearWatchdog();
            update({ phase: "error", message: s.error ?? "录制失败", currentStep: currentStepRef.current });
          }
        } catch { stopPoll(); clearWatchdog(); update({ phase: "error", message: "网络错误", currentStep: currentStepRef.current }); }
      }, POLL_MS);
      pollRef.current = poll;
    } catch { cleanupResources(); update({ phase: "error", message: "视频生成请求异常", currentStep: currentStepRef.current }); }
  }, [projectId, update, cleanupResources, startWatchdog, clearWatchdog, setStep]);

  // ── Poster flow (AIGC session) ─────────────────────────────────────────────
  const triggerPoster = useCallback(async (prompt: string) => {
    if (!projectId) { update({ phase: "error", message: "No active project", currentStep: setStep(0) }); return; }
    // NOTE: the user bubble is added by tryIntercept() at interception time,
    // so we do NOT call onUserMessage here — otherwise the Level-2 async path
    // (which runs after the normal send already added a bubble) would double-add.
    cleanupResources();
    setStep(0); // → "截取 App 画面" step
    update({ phase: "generating", type: "poster", currentStep: 0, label: "截取 App 画面" });
    startWatchdog();
    try {
      const res = await fetch("/api/aigc/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        cleanupResources();
        update({ phase: "error", message: "AIGC 会话启动失败", currentStep: currentStepRef.current });
        onMessage?.("❌ AIGC 会话启动失败", "assistant");
        return;
      }
      const { sessionId } = await res.json() as { sessionId: string };
      sessionIdRef.current = sessionId;

      // Listen for SSE events
      const es = new EventSource(`/api/aigc/session/${sessionId}/stream`);
      esRef.current = es;
      const finish = (terminalUpdate: MediaTriggerStatus, chatMsg?: string) => {
        clearWatchdog();
        try { es.close(); } catch {}
        esRef.current = null;
        sessionIdRef.current = null;
        update(terminalUpdate);
        if (chatMsg) onMessage?.(chatMsg, "assistant");
      };
      es.onmessage = (ev) => {
        // Ignore events after a terminal event already fired (finish() sets
        // esRef.current = null). Without this, a replayed aigc_done following
        // aigc_poster_ready would overwrite the poster with a no-media state.
        if (esRef.current !== es) return;
        let event: { type: string; label?: string; dataUrl?: string; score?: number; qualityHint?: string };
        try {
          event = JSON.parse(ev.data);
        } catch (err) {
          // Malformed frame — log instead of silently swallowing (a swallowed
          // terminal frame would otherwise hang the UI; the watchdog covers it).
          console.warn("[useMediaTrigger] malformed SSE frame:", err, ev.data);
          return;
        }
        console.log("[AIGC SSE]", event.type, event.dataUrl ? `(dataUrl ${event.dataUrl.length} chars)` : "");
        if (event.type === "aigc_action") {
          // Map granular action labels to the fixed step index:
          //   质量*  → step 3 (质量检测)
          //   others (优化提示词/生成海报/风格) → step 2 (生成海报)
          const label = event.label ?? "生成中";
          const step = /质量/.test(label) ? setStep(3) : (currentStepRef.current >= 2 ? currentStepRef.current : setStep(2));
          update({ phase: "generating", type: "poster", currentStep: step, label });
        } else if (event.type === "aigc_screenshot" && event.dataUrl) {
          // Screenshot captured — pause the watchdog and ask the user for style.
          // The user may take a while to choose; resume on submitStyle.
          clearWatchdog();
          update({ phase: "awaiting_style", currentStep: setStep(1), screenshotUrl: event.dataUrl });
        } else if (event.type === "aigc_need_style") {
          // Belt-and-suspenders: ensure we're in awaiting_style even if the
          // screenshot frame was missed.
          clearWatchdog();
          update({ phase: "awaiting_style", currentStep: setStep(1), screenshotUrl: undefined });
        } else if (event.type === "aigc_poster_ready" && event.dataUrl) {
          const scoreText = event.score ? ` (质量评分: ${event.score}/100)` : "";
          finish(
            { phase: "done", type: "poster", downloadUrl: event.dataUrl, currentStep: setStep(4) },
            `宣传海报已生成${scoreText}：\n\n![海报](${event.dataUrl})`,
          );
        } else if (event.type === "aigc_done") {
          // Agent finished without producing media (e.g. called finish_aigc with
          // no poster_ready). KEEP the card visible with the step log — do NOT
          // reset to idle (that used to make the card vanish, leaving only the
          // prompt with zero feedback).
          finish(
            { phase: "done", type: "poster", noMedia: true, currentStep: currentStepRef.current },
            "生成已结束，但未产出媒体。",
          );
        } else if (event.type === "aigc_error") {
          const msg = (event as any).message ?? "生成失败";
          finish({ phase: "error", message: msg, currentStep: currentStepRef.current }, `❌ 海报生成失败: ${msg}`);
        }
      };
      es.onerror = () => {
        // Only surface as error if we were still actively generating — a done/
        // error/cancel already closed the ES and this is a harmless close event.
        if (esRef.current === es) {
          finish({ phase: "error", message: "连接中断", currentStep: currentStepRef.current }, "❌ AIGC 连接中断，请重试");
        }
      };

      // Send the message. If this throws or returns non-ok after the ES is
      // already open, tear the ES down too — otherwise it would wait for events
      // that will never come.
      const msgRes = await fetch(`/api/aigc/session/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `请为这个 App 生成宣传海报。风格要求：${prompt}` }),
      });
      if (!msgRes.ok) {
        finish({ phase: "error", message: "AIGC 消息发送失败", currentStep: currentStepRef.current }, "❌ AIGC 消息发送失败，请重试");
      }
    } catch {
      cleanupResources();
      update({ phase: "error", message: "海报生成请求异常", currentStep: currentStepRef.current });
      onMessage?.("❌ 海报生成请求异常", "assistant");
    }
  }, [projectId, update, onMessage, cleanupResources, startWatchdog, clearWatchdog, setStep]);

  // ── Main intercept (synchronous like MVP's useVideoTrigger) ─────────────────
  const tryIntercept = useCallback((text: string): boolean => {
    // Invalidate any pending Level-2 resolution from a prior send.
    sendTokenRef.current++;

    // Level 1: keyword — fast, synchronous.
    // The user's prompt MUST appear in chat regardless of which AIGC path
    // fires, so add the user bubble before triggering (and before the caller
    // clears the input). Returning true tells the caller to skip the normal
    // manager/build send.
    const kw = keywordDetect(text);
    if (kw === "video") { onUserMessage?.(text); triggerVideo(20); return true; }
    if (kw === "poster") { onUserMessage?.(text); triggerPoster(text); return true; }

    // Level 2: LLM classify — don't block the normal send (avoids a dry wait).
    // Only runs when there's a media hint but NO strong build intent (same gate as Level-1).
    // If the LLM later confirms AIGC intent, abort the in-flight manager stream
    // and switch to AIGC — so manager-planning and AIGC don't run concurrently.
    // The normal send already added the user bubble, so no onUserMessage here.
    const MEDIA_HINTS = /图|视频|海报|封面|宣传|分享|录|截图|poster|video|image|share|screenshot/i;

    const likelyMedia = MEDIA_HINTS.test(text);
    const likelyBuild = hasBuildIntent(text);

    if (likelyMedia && !likelyBuild && text.length >= 6) {
      const token = sendTokenRef.current;
      llmDetect(text).then((intent) => {
        // Stale — user sent another message in the meantime.
        if (token !== sendTokenRef.current) return;
        if (intent !== "video" && intent !== "poster") return;
        abortManager?.();
        if (intent === "video") triggerVideo(20);
        else triggerPoster(text);
      }).catch(() => {});
    }

    // Don't block — let normal send flow proceed
    return false;
  }, [triggerVideo, triggerPoster, onUserMessage, abortManager]);

  // reset/cancel: tear down any live generation and return to idle. Used by the
  // "关闭" button on done/error cards AND the "取消" button shown while generating.
  const reset = useCallback(() => {
    cleanupResources();
    currentStepRef.current = 0;
    update({ phase: "idle" });
  }, [cleanupResources, update]);

  return { status, tryIntercept, triggerVideo, triggerPoster, submitStyle, reset, cancel: reset };
}
