import { useState, useRef, useEffect, useCallback } from "react";
import { useIDEStore, type ManagerPlan } from "@/stores/ide-store";
import { Video, ImageIcon, Loader2, Download, Share2, Check, X, Wand2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { MediaSharePanel } from "./MediaSharePanel";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | { state: "idle" }
  | { state: "creating_session" }
  | { state: "running"; taskType: "poster" | "video"; label: string }
  | { state: "done_poster"; dataUrl: string }
  | { state: "done_video"; downloadUrl: string }
  | { state: "error"; message: string };

interface AigcEvent {
  type: string;
  [key: string]: unknown;
}

// ── Hook: AIGC session ────────────────────────────────────────────────────────

function useAigcSession(projectId: string) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const [promptInput, setPromptInput] = useState("");
  const esRef = useRef<EventSource | null>(null);

  const startSession = useCallback(async () => {
    setPhase({ state: "creating_session" });
    try {
      const res = await fetch("/api/aigc/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("Session creation failed");
      const { sessionId: sid } = await res.json() as { sessionId: string };
      setSessionId(sid);

      // Open SSE stream
      const es = new EventSource(`/api/aigc/session/${sid}/stream`);
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as AigcEvent;
          handleAigcEvent(event);
        } catch {}
      };
      es.onerror = () => {
        setPhase((p) => p.state === "running" ? { state: "error", message: "连接中断" } : p);
      };

      return sid;
    } catch (err) {
      setPhase({ state: "error", message: err instanceof Error ? err.message : "启动失败" });
      return null;
    }
  }, [projectId]);

  const handleAigcEvent = useCallback((event: AigcEvent) => {
    if (event.type === "aigc_action") {
      setPhase((p) => ({
        state: "running",
        taskType: (p as { taskType?: "poster" | "video" }).taskType ?? "poster",
        label: event.label as string ?? "处理中…",
      }));
    } else if (event.type === "aigc_poster_ready") {
      setPhase({ state: "done_poster", dataUrl: event.dataUrl as string });
    } else if (event.type === "aigc_video_ready") {
      setPhase({ state: "done_video", downloadUrl: event.downloadUrl as string });
    } else if (event.type === "aigc_done") {
      // keep result state as-is
    }
  }, []);

  const sendMessage = useCallback(async (sid: string, message: string, taskType: "poster" | "video") => {
    setPhase({ state: "running", taskType, label: taskType === "poster" ? "截取 App 画面…" : "准备录制视频…" });
    await fetch(`/api/aigc/session/${sid}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  }, []);

  const reset = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setSessionId(null);
    setPhase({ state: "idle" });
    setPromptInput("");
  }, []);

  useEffect(() => () => { esRef.current?.close(); }, []);

  return { sessionId, phase, promptInput, setPromptInput, startSession, sendMessage, reset };
}

// ── MediaPlanCard ─────────────────────────────────────────────────────────────

interface Props {
  plan: ManagerPlan;
  onCancel: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  poster: "宣传海报",
  video: "演示视频",
  both: "海报 + 演示视频",
};

const STYLE_PRESETS = ["极简", "商务感", "赛博朋克", "插画风", "水彩", "写实"];

export function MediaPlanCard({ plan, onCancel }: Props) {
  const projectId = useIDEStore((s) => s.projectId);
  const { toast } = useToast();
  const [shareOpen, setShareOpen] = useState(false);
  const [publishedAppId, setPublishedAppId] = useState<string | null>(null);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [recommendedStyles, setRecommendedStyles] = useState<string[]>([]);

  // Load user style preferences
  useEffect(() => {
    fetch("/api/aigc/preferences")
      .then((r) => r.ok ? r.json() : null)
      .then((prefs: { styleHistory?: string[]; lastStyle?: string | null } | null) => {
        if (!prefs) return;
        if (prefs.lastStyle) setSelectedStyle(prefs.lastStyle);
        if (prefs.styleHistory?.length) setRecommendedStyles(prefs.styleHistory.slice(-3).reverse());
      })
      .catch(() => {});
  }, []);

  const mediaTask = plan.media_task;
  const taskType = mediaTask?.type ?? "poster";

  const {
    sessionId, phase, promptInput, setPromptInput,
    startSession, sendMessage, reset,
  } = useAigcSession(projectId ?? "");

  const handleStart = useCallback(async () => {
    const initialPrompt = mediaTask?.prompt ?? plan.summary;
    const sid = await startSession();
    if (!sid) return;

    const styleNote = selectedStyle ? `，视觉风格：${selectedStyle}` : (mediaTask?.style ? `，视觉风格：${mediaTask.style}` : "");
    const message = taskType === "video"
      ? `请录制这个 App 的演示视频，时长约 ${mediaTask?.duration ?? 20} 秒`
      : `请为这个 App 生成宣传海报。风格要求：${initialPrompt}${styleNote}`;

    await sendMessage(sid, message, taskType === "both" ? "poster" : taskType as "poster" | "video");
  }, [mediaTask, plan.summary, taskType, startSession, sendMessage, selectedStyle]);

  const handleRefine = useCallback(async () => {
    if (!refinePrompt.trim() || !sessionId) return;
    const t = refinePrompt.trim();
    setRefinePrompt("");
    await sendMessage(sessionId, t, "poster");
  }, [refinePrompt, sessionId, sendMessage]);

  const handleVideoRefine = useCallback(async () => {
    if (!refinePrompt.trim() || !sessionId) return;
    const t = refinePrompt.trim();
    setRefinePrompt("");
    await sendMessage(sessionId, t, "video");
  }, [refinePrompt, sessionId, sendMessage]);

  const handleCopyLink = useCallback(async () => {
    const url = publishedAppId
      ? `${window.location.origin}/CreateSquare/app/${publishedAppId}`
      : window.location.href;
    await navigator.clipboard.writeText(url).catch(() => {});
    toast({ description: "链接已复制", duration: 1500 });
  }, [publishedAppId, toast]);

  const mediaTypeBadge = TYPE_LABEL[taskType] ?? "多媒体创作";

  return (
    <div
      className="mx-3 my-2 rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(79,130,255,0.25)", background: "var(--panel-mid-bg)" }}
      data-testid="media-plan-card"
    >
      {/* Header — same visual language as TaskPlanCard */}
      <div className="flex items-center gap-2.5 px-4 py-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(79,130,255,0.07)" }}>
        <Sparkles className="w-3.5 h-3.5 text-[#4f82ff] shrink-0" />
        <span className="text-[13px] font-semibold text-[#4f82ff]">多媒体创作</span>
        <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded-full"
          style={{ background: "rgba(79,130,255,0.15)", color: "#4f82ff" }}>
          {mediaTypeBadge}
        </span>
      </div>

      {/* Summary */}
      <div className="px-4 pt-3 pb-2">
        <p className="text-[13px] text-foreground/80">{plan.summary}</p>
        {mediaTask?.style && (
          <p className="text-[12px] text-muted-foreground/60 mt-1">风格：{mediaTask.style}</p>
        )}
      </div>

      {/* Task params */}
      <div className="mx-4 mb-3 rounded-lg px-3 py-2.5 text-[12px] space-y-1"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex gap-2">
          <span className="text-muted-foreground/50 w-16 shrink-0">类型</span>
          <span className="text-foreground/70">{mediaTypeBadge}</span>
        </div>
        {mediaTask?.prompt && (
          <div className="flex gap-2">
            <span className="text-muted-foreground/50 w-16 shrink-0">提示词</span>
            <span className="text-foreground/70 break-words">{mediaTask.prompt}</span>
          </div>
        )}
        {/* Style selector — only for poster tasks */}
        {(taskType === "poster" || taskType === "both") && phase.state === "idle" && (
          <div className="flex gap-2 items-start pt-0.5">
            <span className="text-muted-foreground/50 w-16 shrink-0 mt-1">风格</span>
            <div className="flex flex-wrap gap-1.5">
              {/* Recommended styles from history (shown first) */}
              {recommendedStyles.map((s) => (
                <button
                  key={`rec-${s}`}
                  onClick={() => setSelectedStyle(selectedStyle === s ? null : s)}
                  className="px-2 py-0.5 rounded-full text-[11px] transition-all"
                  style={selectedStyle === s
                    ? { background: "#4f82ff", color: "#fff" }
                    : { background: "rgba(79,130,255,0.12)", color: "#4f82ff", border: "1px solid rgba(79,130,255,0.3)" }}
                >
                  ★ {s}
                </button>
              ))}
              {/* Standard presets */}
              {STYLE_PRESETS.filter((s) => !recommendedStyles.includes(s)).map((s) => (
                <button
                  key={s}
                  onClick={() => setSelectedStyle(selectedStyle === s ? null : s)}
                  className="px-2 py-0.5 rounded-full text-[11px] transition-all"
                  style={selectedStyle === s
                    ? { background: "#4f82ff", color: "#fff" }
                    : { background: "rgba(255,255,255,0.05)", color: "var(--muted-foreground)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {(taskType === "video" || taskType === "both") && (
          <div className="flex gap-2">
            <span className="text-muted-foreground/50 w-16 shrink-0">时长</span>
            <span className="text-foreground/70">{mediaTask?.duration ?? 20} 秒</span>
          </div>
        )}
        {(taskType === "poster" || taskType === "both") && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground/50 w-16 shrink-0">画面</span>
            <span className="text-[#34d68a]">✓ App 真实截图 · AI 风格化</span>
          </div>
        )}
        {(taskType === "video" || taskType === "both") && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground/50 w-16 shrink-0">录制</span>
            <span className="text-[#34d68a]">✓ 真实运行录制，含交互操作</span>
          </div>
        )}
      </div>

      {/* Result area */}
      {phase.state === "done_poster" && (
        <div className="mx-4 mb-3 rounded-lg overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          <img
            src={phase.dataUrl}
            alt="Generated poster"
            className="w-full object-cover max-h-72"
          />
          {/* Action row */}
          <div className="flex items-center gap-2 px-3 py-2.5 flex-wrap"
            style={{ background: "rgba(255,255,255,0.02)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <a
              href={phase.dataUrl}
              download="cascade-poster.png"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors"
              style={{ background: "rgba(79,130,255,0.15)", color: "#4f82ff", border: "1px solid rgba(79,130,255,0.3)" }}
            >
              <Download className="w-3 h-3" />
              下载
            </a>
            <button
              onClick={() => setShareOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors"
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--foreground)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <Share2 className="w-3 h-3" />
              分享
            </button>
            {/* Style refinement */}
            <div className="flex items-center gap-1.5 ml-auto">
              <input
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRefine(); }}
                placeholder="换个风格…"
                className="text-[12px] bg-transparent border rounded-md px-2 py-1 outline-none focus:border-[#4f82ff] w-28"
                style={{ borderColor: "rgba(255,255,255,0.15)", color: "var(--foreground)" }}
              />
              <button
                onClick={handleRefine}
                disabled={!refinePrompt.trim() || phase.state !== "done_poster"}
                className="p-1.5 rounded-md disabled:opacity-40 transition-colors"
                style={{ background: "rgba(79,130,255,0.15)", color: "#4f82ff" }}
              >
                <Wand2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          {shareOpen && (
            <MediaSharePanel
              onClose={() => setShareOpen(false)}
              publishedAppId={publishedAppId ?? undefined}
              projectId={projectId ?? ""}
            />
          )}
        </div>
      )}

      {phase.state === "done_video" && (
        <div className="mx-4 mb-3 rounded-lg overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          <video
            src={phase.downloadUrl}
            controls
            autoPlay
            loop
            muted
            className="w-full"
          />
          <div className="flex items-center gap-2 px-3 py-2.5 flex-wrap"
            style={{ background: "rgba(255,255,255,0.02)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <a
              href={phase.downloadUrl}
              download="cascade-demo.mp4"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium"
              style={{ background: "rgba(79,130,255,0.15)", color: "#4f82ff", border: "1px solid rgba(79,130,255,0.3)" }}
            >
              <Download className="w-3 h-3" />
              下载视频
            </a>
            <button
              onClick={() => setShareOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium"
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--foreground)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <Share2 className="w-3 h-3" />
              分享
            </button>
            {/* Video style refinement hint — reserved for future */}
            <span className="ml-auto text-[11px] text-muted-foreground/40 italic">风格润色 · 即将推出</span>
          </div>
          {shareOpen && (
            <MediaSharePanel
              onClose={() => setShareOpen(false)}
              publishedAppId={publishedAppId ?? undefined}
              projectId={projectId ?? ""}
            />
          )}
        </div>
      )}

      {/* Progress / error */}
      {phase.state === "running" && (
        <div className="mx-4 mb-3 flex items-center gap-2 text-[12px] text-muted-foreground/70">
          {phase.taskType === "video"
            ? <Video className="w-3.5 h-3.5 text-[#4f82ff] shrink-0" />
            : <ImageIcon className="w-3.5 h-3.5 text-[#4f82ff] shrink-0" />}
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          <span>{phase.label}</span>
        </div>
      )}

      {phase.state === "error" && (
        <div className="mx-4 mb-3 flex items-center gap-2 text-[12px] text-[#ef4444]"
          style={{ background: "rgba(239,68,68,0.07)", borderRadius: 6, padding: "8px 10px" }}>
          <X className="w-3.5 h-3.5 shrink-0" />
          {phase.message}
        </div>
      )}

      {/* Action buttons */}
      {phase.state === "idle" || phase.state === "creating_session" ? (
        <div className="flex items-center gap-2 px-4 pb-4 mt-1">
          <button
            onClick={handleStart}
            disabled={phase.state === "creating_session"}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-all disabled:opacity-50"
            style={{ background: "#4f82ff", color: "#fff" }}
            data-testid="button-start-aigc"
          >
            {phase.state === "creating_session"
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />启动中…</>
              : <><Sparkles className="w-3.5 h-3.5" />开始生成</>}
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-lg text-[13px] text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors"
          >
            取消
          </button>
        </div>
      ) : phase.state !== "running" ? (
        <div className="flex items-center gap-2 px-4 pb-4 mt-1">
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors"
          >
            重新生成
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-[12px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
          >
            关闭
          </button>
        </div>
      ) : null}
    </div>
  );
}
