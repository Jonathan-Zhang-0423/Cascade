import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Code2, Lock, Globe, Link2, Camera, RefreshCw, Copy, Check, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const FONT = '"Inter", "Helvetica Neue", system-ui, sans-serif';

type Visibility = "public" | "link_only" | "private";

interface PublishDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  existing?: {
    id: string;
    title: string;
    description: string | null;
    isOpenSource: boolean;
    visibility: Visibility;
    previewScreenshot: string | null;
  } | null;
  onPublished?: (app: { id: string }) => void;
  onUnpublished?: () => void;
}

export function PublishDialog({
  open,
  onClose,
  projectId,
  projectName,
  existing,
  onPublished,
  onUnpublished,
}: PublishDialogProps) {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isOpenSource, setIsOpenSource] = useState<boolean | null>(null);   // null = not chosen yet
  const [visibility, setVisibility] = useState<Visibility | null>(null);     // null = not chosen yet
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [imgZoom, setImgZoom] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setScreenshot(existing?.previewScreenshot ?? null);
      setTitle(existing?.title ?? projectName);
      setDescription(existing?.description ?? "");
      setIsOpenSource(existing ? existing.isOpenSource : null);
      setVisibility(existing ? existing.visibility : null);
      setError("");
      setSubmitting(false);
      setPublishedId(existing?.id ?? null);
      setCopied(false);
    }
  }, [open, existing, projectName]);

  const publishedUrl =
    publishedId && visibility !== "private"
      ? `${window.location.origin}/BuilderSquare/app/${publishedId}`
      : null;

  // First-time publish requires both fields explicitly chosen
  const canPublish = !!(title.trim() && isOpenSource !== null && visibility !== null);

  const handleScreenshot = useCallback(async () => {
    setScreenshotLoading(true);
    try {
      const res = await fetch("/api/square/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("screenshot failed");
      const data = await res.json();
      setScreenshot(data.screenshot ?? null);
    } catch {
      // silently ignore
    } finally {
      setScreenshotLoading(false);
    }
  }, [projectId]);

  async function handlePublish() {
    if (!canPublish) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/square", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: title.trim(),
          description: description.trim() || undefined,
          isOpenSource: isOpenSource!,
          visibility: visibility!,
          previewScreenshot: screenshot ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setPublishedId(data.app.id);
      onPublished?.(data.app);
    } catch {
      setError("发布失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  function copyUrl() {
    if (!publishedUrl) return;
    navigator.clipboard?.writeText(publishedUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const el = document.createElement("textarea");
      el.value = publishedUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isUpdate = !!existing;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent
          className="max-w-md w-full p-0 overflow-hidden rounded-2xl border border-border shadow-xl bg-background"
          style={{ fontFamily: FONT }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
            <h2 className="text-[17px] font-semibold text-foreground">
              {isUpdate ? "更新发布" : "发布到创造者广场"}
            </h2>
          </div>

          <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[75vh]">

            {/* ── Cover screenshot ── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-medium text-foreground">封面截图</label>
                <button
                  type="button"
                  onClick={handleScreenshot}
                  disabled={screenshotLoading}
                  className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", screenshotLoading && "animate-spin")} />
                  {screenshotLoading ? "截图中…" : screenshot ? "重新截图" : "自动截图"}
                </button>
              </div>
              {/* Small 16:9 preview with zoom button */}
              <div className="relative w-full rounded-xl overflow-hidden bg-muted border border-border" style={{ aspectRatio: "16/9", maxHeight: 160 }}>
                {screenshot ? (
                  <>
                    <img src={screenshot} alt="cover" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImgZoom(true)}
                      className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-white" />
                    </button>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
                    <Camera className="w-6 h-6 text-muted-foreground/50" />
                    <span className="text-[11px] text-muted-foreground">点击右上角「自动截图」</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── App name ── */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">应用名称</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                placeholder="给你的应用起个名字"
                className="w-full h-10 px-3 text-[14px] text-foreground placeholder:text-muted-foreground border border-input rounded-xl outline-none focus:border-ring bg-background transition-colors"
              />
              <p className="text-[11px] text-muted-foreground text-right">{title.length}/80</p>
            </div>

            {/* ── Description ── */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">
                简介
                <span className="ml-1 font-normal text-muted-foreground">（可选）</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={300}
                rows={3}
                placeholder="简单描述一下这个应用的功能…"
                className="w-full px-3 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground border border-input rounded-xl outline-none focus:border-ring bg-background transition-colors resize-none"
              />
              <p className="text-[11px] text-muted-foreground text-right">{description.length}/300</p>
            </div>

            {/* ── Code visibility ── */}
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-foreground">代码可见性</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: true, icon: <Code2 className="w-4 h-4" />, label: "开源", desc: "他人可以 Fork 你的代码" },
                  { value: false, icon: <Lock className="w-4 h-4" />, label: "私有", desc: "仅供展示，不可 Fork" },
                ].map((opt) => {
                  const selected = isOpenSource === opt.value;
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => setIsOpenSource(opt.value)}
                      className={cn(
                        "flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all duration-150",
                        selected ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground hover:border-muted-foreground",
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-medium text-[13px]">{opt.icon}{opt.label}</div>
                      <p className={cn("text-[11px] leading-snug", selected ? "text-background/70" : "text-muted-foreground")}>{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Visibility scope ── */}
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-foreground">可见范围</label>
              <div className="space-y-1.5">
                {[
                  { value: "public" as Visibility, icon: <Globe className="w-4 h-4" />, label: "公开广场", desc: "所有人都能在广场中发现你的应用" },
                  { value: "link_only" as Visibility, icon: <Link2 className="w-4 h-4" />, label: "仅链接可访问", desc: "拥有链接的人才能访问" },
                  { value: "private" as Visibility, icon: <Lock className="w-4 h-4" />, label: "私有", desc: "仅自己可见" },
                ].map((opt) => {
                  const selected = visibility === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setVisibility(opt.value)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all duration-150",
                        selected ? "border-l-4 border-l-foreground border-t-border border-r-border border-b-border bg-muted" : "border-border bg-background hover:bg-muted/50",
                      )}
                    >
                      <div className={cn("shrink-0", selected ? "text-foreground" : "text-muted-foreground")}>{opt.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-[13px]", selected ? "font-bold text-foreground" : "font-medium text-muted-foreground")}>{opt.label}</p>
                        <p className="text-[11px] text-muted-foreground leading-snug">{opt.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Published URL bar (shown after publishing or if existing) ── */}
            {publishedId && (
              <div className="rounded-xl border border-border bg-muted px-3 py-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-muted-foreground mb-0.5">项目链接</p>
                  {publishedUrl ? (
                    <p className="text-[12px] text-foreground truncate font-mono">{publishedUrl}</p>
                  ) : (
                    <p className="text-[12px] text-muted-foreground italic">私有项目，仅自己可见</p>
                  )}
                </div>
                {publishedUrl && (
                  <button
                    type="button"
                    onClick={copyUrl}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-background border border-border text-[12px] text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "已复制" : "复制"}
                  </button>
                )}
              </div>
            )}

            {/* ── Error / validation hint ── */}
            {!canPublish && !existing && title.trim() && (
              <p className="text-[12px] text-amber-500">请选择代码可见性和可见范围后再发布</p>
            )}
            {error && <p className="text-[12px] text-red-500">{error}</p>}

            {/* ── Publish button ── */}
            <button
              type="button"
              onClick={handlePublish}
              disabled={submitting || !canPublish}
              className="w-full py-2.5 rounded-xl bg-foreground text-background text-[14px] font-medium hover:opacity-85 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "发布中…" : publishedId ? "更新发布" : "发布"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Image zoom overlay ── */}
      {imgZoom && screenshot && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80"
          onClick={() => { setImgZoom(false); onClose(); window.location.href = "/app"; }}
        >
          <button
            type="button"
            onClick={() => { setImgZoom(false); onClose(); window.location.href = "/app"; }}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <img
            src={screenshot}
            alt="cover fullscreen"
            className="max-w-[90vw] max-h-[85vh] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
