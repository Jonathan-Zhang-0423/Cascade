import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { ImageIcon, Video, Loader2, Download, ChevronLeft, Wand2, X } from "lucide-react";
import cascadeLogo from "@/assets/cascade-logo.png";

type Tab = "image" | "video";

interface ImageResult {
  images: Array<{ url?: string; b64?: string }>;
}

interface VideoResult {
  taskId?: string;
  videoUrl?: string;
}

interface VideoStatus {
  status: "pending" | "running" | "done" | "failed";
  videoUrl?: string;
  progress?: number;
}

const STYLE_PRESETS_IMAGE = [
  { value: "", label: "默认" },
  { value: "photorealistic", label: "写实" },
  { value: "anime", label: "动漫" },
  { value: "oil-painting", label: "油画" },
  { value: "watercolor", label: "水彩" },
  { value: "pixel-art", label: "像素" },
  { value: "cyberpunk", label: "赛博朋克" },
];

const STYLE_PRESETS_VIDEO = [
  { value: "", label: "默认" },
  { value: "cinematic", label: "电影质感" },
  { value: "anime", label: "动漫" },
  { value: "slow-motion", label: "慢镜头" },
];

const SIZES = [
  { value: "1024x1024", label: "1:1 方形" },
  { value: "1280x720", label: "16:9 横屏" },
  { value: "720x1280", label: "9:16 竖屏" },
  { value: "1024x768", label: "4:3" },
];

export default function AigcPage() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>("image");

  // Image state
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageStyle, setImageStyle] = useState("");
  const [imageSize, setImageSize] = useState("1024x1024");
  const [imageCount, setImageCount] = useState(1);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageResults, setImageResults] = useState<ImageResult["images"]>([]);
  const [imageError, setImageError] = useState("");

  // Video state
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoStyle, setVideoStyle] = useState("");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoTaskId, setVideoTaskId] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState<VideoStatus | null>(null);
  const [videoError, setVideoError] = useState("");
  const [pollingTimer, setPollingTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  const generateImage = useCallback(async () => {
    if (!imagePrompt.trim() || imageLoading) return;
    setImageLoading(true);
    setImageError("");
    setImageResults([]);
    try {
      const [w, h] = imageSize.split("x").map(Number);
      const res = await fetch("/api/aigc/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imagePrompt.trim(), style: imageStyle || undefined, width: w, height: h, n: imageCount }),
      });
      if (res.status === 401) { setImageError("请先登录"); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        setImageError(body.message ?? "生成失败，请重试");
        return;
      }
      const data = await res.json() as ImageResult;
      setImageResults(data.images ?? []);
    } catch {
      setImageError("网络错误，请重试");
    } finally {
      setImageLoading(false);
    }
  }, [imagePrompt, imageStyle, imageSize, imageCount, imageLoading]);

  const startVideoPolling = useCallback((taskId: string) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/aigc/video/status/${taskId}`);
        if (!res.ok) return;
        const s = await res.json() as VideoStatus;
        setVideoStatus(s);
        if (s.status === "done" || s.status === "failed") {
          clearInterval(timer);
          setPollingTimer(null);
          setVideoLoading(false);
          if (s.status === "failed") setVideoError("视频生成失败，请重试");
        }
      } catch {
        // keep polling
      }
    }, 3000);
    setPollingTimer(timer);
  }, []);

  const generateVideo = useCallback(async () => {
    if (!videoPrompt.trim() || videoLoading) return;
    if (pollingTimer) { clearInterval(pollingTimer); setPollingTimer(null); }
    setVideoLoading(true);
    setVideoError("");
    setVideoStatus(null);
    setVideoTaskId(null);
    try {
      const res = await fetch("/api/aigc/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: videoPrompt.trim(), style: videoStyle || undefined, duration: videoDuration }),
      });
      if (res.status === 401) { setVideoError("请先登录"); setVideoLoading(false); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        setVideoError(body.message ?? "生成失败，请重试");
        setVideoLoading(false);
        return;
      }
      const data = await res.json() as VideoResult;
      if (data.videoUrl) {
        setVideoStatus({ status: "done", videoUrl: data.videoUrl });
        setVideoLoading(false);
        return;
      }
      if (data.taskId) {
        setVideoTaskId(data.taskId);
        setVideoStatus({ status: "pending" });
        startVideoPolling(data.taskId);
      }
    } catch {
      setVideoError("网络错误，请重试");
      setVideoLoading(false);
    }
  }, [videoPrompt, videoStyle, videoDuration, videoLoading, pollingTimer, startVideoPolling]);

  return (
    <div className="min-h-screen" style={{ background: "#0d0d0f", color: "#e8e8f0", fontFamily: '"Inter","Helvetica Neue",system-ui,sans-serif' }}>
      {/* Header */}
      <header style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "#111114" }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/app")}
              className="flex items-center gap-1 text-muted-foreground/60 hover:text-muted-foreground/90 transition-colors text-[13px]"
            >
              <ChevronLeft className="w-4 h-4" />
              返回
            </button>
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.1)" }} />
            <img src={cascadeLogo} alt="Cascade" width={22} height={22} />
            <span className="text-[14px] font-medium">AIGC 创作</span>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-lg mb-8 w-fit" style={{ background: "rgba(255,255,255,0.05)" }}>
          {([["image", "生图", ImageIcon], ["video", "生视频", Video]] as const).map(([t, label, Icon]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium transition-all"
              style={{
                background: tab === t ? "rgba(79,130,255,0.15)" : "transparent",
                color: tab === t ? "#4f82ff" : "rgba(232,232,240,0.5)",
                border: tab === t ? "1px solid rgba(79,130,255,0.3)" : "1px solid transparent",
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* ── Image tab ── */}
        {tab === "image" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: controls */}
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] text-muted-foreground/60 mb-1.5">提示词</label>
                <textarea
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="描述你想要的图片，例如：一只在星空下奔跑的赛博朋克狐狸"
                  rows={4}
                  className="w-full rounded-md px-3 py-2.5 text-[13px] resize-none outline-none focus:ring-1 focus:ring-[#4f82ff]"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e8f0" }}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generateImage(); }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] text-muted-foreground/60 mb-1.5">风格</label>
                  <select
                    value={imageStyle}
                    onChange={(e) => setImageStyle(e.target.value)}
                    className="w-full rounded-md px-3 py-2 text-[13px] outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e8f0" }}
                  >
                    {STYLE_PRESETS_IMAGE.map((s) => <option key={s.value} value={s.value} style={{ background: "#1a1a1f" }}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] text-muted-foreground/60 mb-1.5">尺寸</label>
                  <select
                    value={imageSize}
                    onChange={(e) => setImageSize(e.target.value)}
                    className="w-full rounded-md px-3 py-2 text-[13px] outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e8f0" }}
                  >
                    {SIZES.map((s) => <option key={s.value} value={s.value} style={{ background: "#1a1a1f" }}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[12px] text-muted-foreground/60 mb-1.5">生成数量：{imageCount}</label>
                <input
                  type="range" min={1} max={4} value={imageCount}
                  onChange={(e) => setImageCount(Number(e.target.value))}
                  className="w-full accent-[#4f82ff]"
                />
              </div>

              <button
                onClick={generateImage}
                disabled={!imagePrompt.trim() || imageLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-[13px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "#4f82ff", color: "#fff" }}
              >
                {imageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {imageLoading ? "生成中…" : "生成图片"}
              </button>

              {imageError && (
                <div className="flex items-center gap-2 text-[12px] text-[#ef4444] bg-[rgba(239,68,68,0.08)] rounded-md px-3 py-2">
                  <X className="w-3.5 h-3.5 shrink-0" />
                  {imageError}
                </div>
              )}
            </div>

            {/* Right: results */}
            <div>
              {imageResults.length > 0 ? (
                <div className={`grid gap-3 ${imageResults.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {imageResults.map((img, i) => {
                    const src = img.url ?? img.b64;
                    if (!src) return null;
                    return (
                      <div key={i} className="relative group rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                        <img src={src} alt={`生成图 ${i + 1}`} className="w-full object-cover" />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(0,0,0,0.5)" }}>
                          <a
                            href={src}
                            download={`aigc-image-${i + 1}.png`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium"
                            style={{ background: "rgba(79,130,255,0.9)", color: "#fff" }}
                          >
                            <Download className="w-3.5 h-3.5" />
                            下载
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-64 rounded-lg flex flex-col items-center justify-center gap-3"
                  style={{ border: "1px dashed rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)" }}>
                  <ImageIcon className="w-8 h-8 text-muted-foreground/20" />
                  <span className="text-[13px] text-muted-foreground/40">输入提示词后点击生成</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Video tab ── */}
        {tab === "video" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: controls */}
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] text-muted-foreground/60 mb-1.5">提示词</label>
                <textarea
                  value={videoPrompt}
                  onChange={(e) => setVideoPrompt(e.target.value)}
                  placeholder="描述你想要的视频，例如：一朵云在蓝天中缓缓飘动，电影级质感"
                  rows={4}
                  className="w-full rounded-md px-3 py-2.5 text-[13px] resize-none outline-none focus:ring-1 focus:ring-[#4f82ff]"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e8f0" }}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generateVideo(); }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] text-muted-foreground/60 mb-1.5">风格</label>
                  <select
                    value={videoStyle}
                    onChange={(e) => setVideoStyle(e.target.value)}
                    className="w-full rounded-md px-3 py-2 text-[13px] outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e8f0" }}
                  >
                    {STYLE_PRESETS_VIDEO.map((s) => <option key={s.value} value={s.value} style={{ background: "#1a1a1f" }}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] text-muted-foreground/60 mb-1.5">时长：{videoDuration}s</label>
                  <input
                    type="range" min={3} max={15} step={1} value={videoDuration}
                    onChange={(e) => setVideoDuration(Number(e.target.value))}
                    className="w-full mt-2 accent-[#4f82ff]"
                  />
                </div>
              </div>

              <button
                onClick={generateVideo}
                disabled={!videoPrompt.trim() || videoLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-[13px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "#4f82ff", color: "#fff" }}
              >
                {videoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
                {videoLoading ? "生成中…" : "生成视频"}
              </button>

              {videoError && (
                <div className="flex items-center gap-2 text-[12px] text-[#ef4444] bg-[rgba(239,68,68,0.08)] rounded-md px-3 py-2">
                  <X className="w-3.5 h-3.5 shrink-0" />
                  {videoError}
                </div>
              )}

              {videoLoading && videoStatus && (
                <div className="text-[12px] text-muted-foreground/60 text-center animate-pulse">
                  {videoStatus.status === "pending" ? "等待队列…" : "渲染中，请耐心等待…"}
                </div>
              )}
            </div>

            {/* Right: result */}
            <div>
              {videoStatus?.status === "done" && videoStatus.videoUrl ? (
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                  <video
                    src={videoStatus.videoUrl}
                    controls
                    autoPlay
                    loop
                    className="w-full"
                  />
                  <div className="flex justify-end px-3 py-2" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <a
                      href={videoStatus.videoUrl}
                      download="aigc-video.mp4"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium"
                      style={{ background: "rgba(79,130,255,0.15)", color: "#4f82ff", border: "1px solid rgba(79,130,255,0.3)" }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      下载视频
                    </a>
                  </div>
                </div>
              ) : (
                <div className="h-64 rounded-lg flex flex-col items-center justify-center gap-3"
                  style={{ border: "1px dashed rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)" }}>
                  {videoLoading ? (
                    <>
                      <Loader2 className="w-8 h-8 text-[#4f82ff] animate-spin" />
                      <span className="text-[13px] text-muted-foreground/40">视频生成需要 30s–3min，请耐心等待</span>
                    </>
                  ) : (
                    <>
                      <Video className="w-8 h-8 text-muted-foreground/20" />
                      <span className="text-[13px] text-muted-foreground/40">输入提示词后点击生成</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
