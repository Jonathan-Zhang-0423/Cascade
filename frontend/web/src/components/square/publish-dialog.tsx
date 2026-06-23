import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Code2, Lock, Globe, Link2, Camera, RefreshCw, ChevronRight, ChevronLeft } from "lucide-react";
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

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const steps = [
    { label: "截图" },
    { label: "信息" },
    { label: "发布" },
  ];
  return (
    <div className="flex items-center justify-center gap-6 py-4" style={{ fontFamily: FONT }}>
      {steps.map((s, i) => {
        const done = i <= current;
        return (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full transition-colors duration-200",
                done ? "bg-black" : "bg-gray-200",
              )}
            />
            <span
              className={cn(
                "text-[11px] transition-colors duration-200",
                done ? "text-gray-900 font-medium" : "text-gray-400",
              )}
            >
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main dialog ─────────────────────────────────────────────────────────────

export function PublishDialog({
  open,
  onClose,
  projectId,
  projectName,
  existing,
  onPublished,
  onUnpublished,
}: PublishDialogProps) {
  const [step, setStep] = useState(0);

  // Step 1 — screenshot
  const [screenshot, setScreenshot] = useState<string | null>(existing?.previewScreenshot ?? null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);

  // Step 2 — app info
  const [title, setTitle] = useState(existing?.title ?? projectName);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [isOpenSource, setIsOpenSource] = useState(existing?.isOpenSource ?? false);

  // Step 3 — visibility & publish
  const [visibility, setVisibility] = useState<Visibility>(existing?.visibility ?? "public");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(0);
      setScreenshot(existing?.previewScreenshot ?? null);
      setTitle(existing?.title ?? projectName);
      setDescription(existing?.description ?? "");
      setIsOpenSource(existing?.isOpenSource ?? false);
      setVisibility(existing?.visibility ?? "public");
      setError("");
      setSubmitting(false);
      setScreenshotLoading(false);
    }
  }, [open, existing, projectName]);

  async function handleScreenshot() {
    setScreenshotLoading(true);
    try {
      const res = await fetch("/api/square/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("screenshot failed");
      const data = await res.json();
      setScreenshot(data.screenshot ?? data.dataUrl ?? data.url ?? null);
    } catch {
      // silently ignore — user can retry
    } finally {
      setScreenshotLoading(false);
    }
  }

  async function handlePublish() {
    if (!title.trim()) return;
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
          isOpenSource,
          visibility,
          previewScreenshot: screenshot ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      onPublished?.(data.app);
      onClose();
    } catch {
      setError("发布失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnpublish() {
    if (!existing) return;
    setSubmitting(true);
    setError("");
    try {
      await fetch(`/api/square/${existing.id}`, { method: "DELETE" });
      onUnpublished?.();
      onClose();
    } catch {
      setError("操作失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Shared button styles ──────────────────────────────────────────────────
  const btnPrimary =
    "w-full py-2.5 rounded-xl bg-black text-white text-[14px] font-medium hover:opacity-85 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed";
  const btnSecondary =
    "flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-800 transition-colors";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-md w-full p-0 overflow-hidden rounded-2xl border border-gray-100 shadow-xl bg-white"
        style={{ fontFamily: FONT }}
      >
        {/* Step indicator */}
        <div className="border-b border-gray-100">
          <StepIndicator current={step} />
        </div>

        {/* ── Step 1: Cover screenshot ──────────────────────────────────── */}
        {step === 0 && (
          <div className="px-6 py-5 space-y-5">
            <h2 className="text-[17px] font-semibold text-gray-900">封面截图</h2>

            {/* 16:9 preview area */}
            <div
              className={cn(
                "w-full rounded-xl overflow-hidden",
                !screenshot && "border-2 border-dashed border-gray-200 bg-gray-50",
              )}
              style={{ aspectRatio: "16/9" }}
            >
              {screenshot ? (
                <img
                  src={screenshot}
                  alt="cover"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                  <Camera className="w-8 h-8 text-gray-300" />
                  <span className="text-[12px] text-gray-400">暂无截图</span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleScreenshot}
                disabled={screenshotLoading}
                className={cn(btnPrimary, "flex items-center justify-center gap-2")}
              >
                {screenshotLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    截图中…
                  </>
                ) : screenshot ? (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    重新截图
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4" />
                    自动截图
                  </>
                )}
              </button>
            </div>

            {/* Next */}
            <button
              type="button"
              onClick={() => setStep(1)}
              className={cn(btnPrimary, "flex items-center justify-center gap-1")}
            >
              下一步
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 2: App info ──────────────────────────────────────────── */}
        {step === 1 && (
          <div className="px-6 py-5 space-y-5">
            <h2 className="text-[17px] font-semibold text-gray-900">应用信息</h2>

            {/* App name */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-gray-700">应用名称</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                placeholder="给你的应用起个名字"
                className="w-full h-10 px-3 text-[14px] text-gray-900 placeholder-gray-400 border border-gray-200 rounded-xl outline-none focus:border-gray-400 transition-colors"
              />
              <p className="text-[11px] text-gray-400 text-right">{title.length}/80</p>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-gray-700">
                简介
                <span className="ml-1 font-normal text-gray-400">（可选）</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={300}
                rows={3}
                placeholder="简单描述一下这个应用的功能…"
                className="w-full px-3 py-2.5 text-[14px] text-gray-900 placeholder-gray-400 border border-gray-200 rounded-xl outline-none focus:border-gray-400 transition-colors resize-none"
              />
              <p className="text-[11px] text-gray-400 text-right">{description.length}/300</p>
            </div>

            {/* Open source toggle */}
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-gray-700">代码可见性</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    value: true,
                    icon: <Code2 className="w-4 h-4" />,
                    label: "开源",
                    desc: "他人可以 Fork 你的代码",
                  },
                  {
                    value: false,
                    icon: <Lock className="w-4 h-4" />,
                    label: "私有",
                    desc: "仅供展示，不可 Fork",
                  },
                ].map((opt) => {
                  const selected = isOpenSource === opt.value;
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => setIsOpenSource(opt.value)}
                      className={cn(
                        "flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all duration-150",
                        selected
                          ? "border-black bg-black text-white"
                          : "border-gray-200 bg-white text-gray-700 hover:border-gray-300",
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-medium text-[13px]">
                        {opt.icon}
                        {opt.label}
                      </div>
                      <p
                        className={cn(
                          "text-[11px] leading-snug",
                          selected ? "text-white/70" : "text-gray-400",
                        )}
                      >
                        {opt.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={() => setStep(0)} className={btnSecondary}>
                <ChevronLeft className="w-4 h-4" />
                返回
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!title.trim()}
                className="flex items-center gap-1 py-2.5 px-5 rounded-xl bg-black text-white text-[14px] font-medium hover:opacity-85 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                下一步
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Visibility & publish ─────────────────────────────── */}
        {step === 2 && (
          <div className="px-6 py-5 space-y-5">
            <h2 className="text-[17px] font-semibold text-gray-900">发布设置</h2>

            {/* Preview card */}
            <div className="rounded-xl border border-gray-100 overflow-hidden bg-gray-50">
              {screenshot ? (
                <img
                  src={screenshot}
                  alt="preview"
                  className="w-full object-cover"
                  style={{ aspectRatio: "16/9" }}
                />
              ) : (
                <div
                  className="w-full bg-gray-100 flex items-center justify-center"
                  style={{ aspectRatio: "16/9" }}
                >
                  <Camera className="w-6 h-6 text-gray-300" />
                </div>
              )}
              <div className="px-3 py-2.5">
                <p className="text-[13px] font-semibold text-gray-900 truncate">{title || "（未命名）"}</p>
                {description && (
                  <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{description}</p>
                )}
                <p className="text-[11px] text-gray-400 mt-1">你</p>
              </div>
            </div>

            {/* Visibility options */}
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-gray-700">可见范围</label>
              <div className="space-y-1.5">
                {[
                  {
                    value: "public" as Visibility,
                    icon: <Globe className="w-4 h-4" />,
                    label: "公开广场",
                    desc: "所有人都能在广场中发现你的应用",
                  },
                  {
                    value: "link_only" as Visibility,
                    icon: <Link2 className="w-4 h-4" />,
                    label: "仅链接可访问",
                    desc: "拥有链接的人才能访问",
                  },
                  {
                    value: "private" as Visibility,
                    icon: <Lock className="w-4 h-4" />,
                    label: "私有",
                    desc: "仅自己可见",
                  },
                ].map((opt) => {
                  const selected = visibility === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setVisibility(opt.value)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all duration-150",
                        selected
                          ? "border-l-4 border-l-black border-t-gray-200 border-r-gray-200 border-b-gray-200 bg-gray-50"
                          : "border-gray-200 bg-white hover:bg-gray-50",
                      )}
                    >
                      <div className={cn("shrink-0", selected ? "text-black" : "text-gray-400")}>
                        {opt.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-[13px]",
                            selected ? "font-bold text-gray-900" : "font-medium text-gray-600",
                          )}
                        >
                          {opt.label}
                        </p>
                        <p className="text-[11px] text-gray-400 leading-snug">{opt.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Error */}
            {error && <p className="text-[12px] text-red-500">{error}</p>}

            {/* Navigation + publish */}
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={() => setStep(1)} className={btnSecondary}>
                <ChevronLeft className="w-4 h-4" />
                返回
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={submitting || !title.trim()}
                className="flex items-center gap-1.5 py-2.5 px-5 rounded-xl bg-black text-white text-[14px] font-medium hover:opacity-85 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? "发布中…" : existing ? "更新发布" : "发布"}
              </button>
            </div>

            {/* Unpublish */}
            {existing && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={handleUnpublish}
                  disabled={submitting}
                  className="text-[12px] text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40"
                >
                  取消发布
                </button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
