import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Globe, Link2, Lock, Code2, EyeOff } from "lucide-react";

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

const VISIBILITY_OPTIONS: { value: Visibility; icon: React.ReactNode; labelKey: string; descKey: string }[] = [
  {
    value: "public",
    icon: <Globe className="w-4 h-4" />,
    labelKey: "publish.visPublic",
    descKey: "publish.visPublicDesc",
  },
  {
    value: "link_only",
    icon: <Link2 className="w-4 h-4" />,
    labelKey: "publish.visLinkOnly",
    descKey: "publish.visLinkOnlyDesc",
  },
  {
    value: "private",
    icon: <Lock className="w-4 h-4" />,
    labelKey: "publish.visPrivate",
    descKey: "publish.visPrivateDesc",
  },
];

export function PublishDialog({
  open,
  onClose,
  projectId,
  projectName,
  existing,
  onPublished,
  onUnpublished,
}: PublishDialogProps) {
  const t = useT();
  const [title, setTitle] = useState(existing?.title ?? projectName);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [isOpenSource, setIsOpenSource] = useState(existing?.isOpenSource ?? false);
  const [visibility, setVisibility] = useState<Visibility>(existing?.visibility ?? "public");
  const [screenshot, setScreenshot] = useState(existing?.previewScreenshot ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(existing?.title ?? projectName);
      setDescription(existing?.description ?? "");
      setIsOpenSource(existing?.isOpenSource ?? false);
      setVisibility(existing?.visibility ?? "public");
      setScreenshot(existing?.previewScreenshot ?? "");
      setError("");
      setShowUnpublishConfirm(false);
    }
  }, [open, existing, projectName]);

  async function handleSubmit() {
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
          previewScreenshot: screenshot.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      onPublished?.(data.app);
      onClose();
    } catch {
      setError(t("publish.errorMsg"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnpublish() {
    if (!existing) return;
    setSubmitting(true);
    try {
      await fetch(`/api/square/${existing.id}`, { method: "DELETE" });
      onUnpublished?.();
      onClose();
    } catch {
      setError(t("publish.errorMsg"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg w-full p-0 overflow-hidden rounded-2xl border-0 shadow-2xl bg-white dark:bg-[#111]">
        <div
          className="px-6 pt-6 pb-5"
          style={{
            background: "linear-gradient(135deg, rgba(99,102,255,0.07) 0%, rgba(139,92,246,0.05) 100%)",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-[17px] font-semibold tracking-tight text-gray-900 dark:text-white">
              {existing ? t("publish.update") : t("publish.title")}
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[70vh]">
          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-gray-700 dark:text-gray-300">{t("publish.appTitle")}</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("publish.appTitlePlaceholder")}
              className="h-9 text-sm rounded-xl border-gray-200 dark:border-gray-700 focus-visible:ring-1 focus-visible:ring-gray-400"
              maxLength={100}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-gray-700 dark:text-gray-300">{t("publish.description")}</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("publish.descPlaceholder")}
              className="text-sm rounded-xl min-h-[76px] resize-none border-gray-200 dark:border-gray-700 focus-visible:ring-1 focus-visible:ring-gray-400"
              maxLength={500}
            />
          </div>

          {/* Source type */}
          <div className="space-y-2">
            <label className="text-[13px] font-medium text-gray-700 dark:text-gray-300">{t("publish.sourceType")}</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: true, icon: <Code2 className="w-4 h-4" />, label: t("publish.openSource"), desc: t("publish.openSourceDesc") },
                { value: false, icon: <EyeOff className="w-4 h-4" />, label: t("publish.closedSource"), desc: t("publish.closedSourceDesc") },
              ].map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => setIsOpenSource(opt.value)}
                  className={cn(
                    "flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all duration-150",
                    isOpenSource === opt.value
                      ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-[#1a1a1a] dark:text-gray-300",
                  )}
                >
                  <div className="flex items-center gap-1.5 font-medium text-[13px]">
                    {opt.icon}
                    {opt.label}
                  </div>
                  <p className={cn("text-[11px] leading-snug", isOpenSource === opt.value ? "text-white/70 dark:text-gray-700" : "text-gray-400")}>
                    {opt.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Visibility */}
          <div className="space-y-2">
            <label className="text-[13px] font-medium text-gray-700 dark:text-gray-300">{t("publish.visibility")}</label>
            <div className="space-y-1.5">
              {VISIBILITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVisibility(opt.value)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all duration-150",
                    visibility === opt.value
                      ? "border-gray-900 bg-gray-50 dark:border-gray-300 dark:bg-gray-800"
                      : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-[#1a1a1a]",
                  )}
                >
                  <div className={cn("shrink-0", visibility === opt.value ? "text-gray-900 dark:text-white" : "text-gray-400")}>
                    {opt.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-[13px] font-medium", visibility === opt.value ? "text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400")}>
                      {t(opt.labelKey)}
                    </p>
                    <p className="text-[11px] text-gray-400 leading-snug">{t(opt.descKey)}</p>
                  </div>
                  <div className={cn(
                    "w-4 h-4 rounded-full border-2 shrink-0",
                    visibility === opt.value ? "border-gray-900 bg-gray-900 dark:border-white dark:bg-white" : "border-gray-300 dark:border-gray-600",
                  )}>
                    {visibility === opt.value && (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-gray-900" />
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Screenshot URL */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-gray-700 dark:text-gray-300">{t("publish.screenshot")}</label>
            <Input
              value={screenshot}
              onChange={(e) => setScreenshot(e.target.value)}
              placeholder={t("publish.screenshotHint")}
              className="h-9 text-sm rounded-xl border-gray-200 dark:border-gray-700 focus-visible:ring-1 focus-visible:ring-gray-400"
            />
          </div>

          {error && <p className="text-[12px] text-red-500">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
          {existing && !showUnpublishConfirm && (
            <button
              type="button"
              onClick={() => setShowUnpublishConfirm(true)}
              className="text-[12px] text-red-500 hover:text-red-600 transition-colors"
            >
              {t("publish.unpublish")}
            </button>
          )}
          {existing && showUnpublishConfirm && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-500">{t("publish.unpublishConfirm")}</span>
              <button
                type="button"
                onClick={handleUnpublish}
                disabled={submitting}
                className="text-[12px] text-red-500 font-medium hover:text-red-600"
              >
                {t("dashboard.delete")}
              </button>
              <button
                type="button"
                onClick={() => setShowUnpublishConfirm(false)}
                className="text-[12px] text-gray-400 hover:text-gray-600"
              >
                {t("dashboard.cancel")}
              </button>
            </div>
          )}
          {!existing && <div />}
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="ghost" size="sm" onClick={onClose} className="rounded-xl h-8 text-[13px]">
              {t("publish.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={submitting || !title.trim()}
              onClick={handleSubmit}
              className="rounded-xl h-8 text-[13px] bg-gray-900 hover:bg-gray-800 text-white dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              {submitting ? t("publish.submitting") : t("publish.submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
