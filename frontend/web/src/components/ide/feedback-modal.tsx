import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const t = useT();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: t("feedback.success") });
      setContent("");
      onClose();
    } catch {
      toast({ title: t("feedback.error"), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>💬</span>
            <span>{t("feedback.title")}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          <textarea
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            rows={5}
            placeholder={t("feedback.placeholder")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={2000}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{content.length}/2000</span>
            <button
              onClick={handleSubmit}
              disabled={submitting || !content.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "…" : t("feedback.submit")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
