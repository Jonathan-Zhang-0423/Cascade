import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";

interface ChangelogEntry {
  id: number;
  version: string | null;
  title: string;
  content: string;
  publishedAt: string;
  isPublished: boolean;
}

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
}

export function ChangelogModal({ open, onClose }: ChangelogModalProps) {
  const t = useT();
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/changelog")
      .then((r) => r.json())
      .then((data) => setEntries(data.entries ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>🎉</span>
            <span>{t("changelog.title")}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto mt-2 space-y-4 pr-1">
          {loading && (
            <div className="text-sm text-muted-foreground text-center py-8">Loading…</div>
          )}
          {!loading && entries.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              {t("changelog.empty")}
            </div>
          )}
          {entries.map((entry) => (
            <div key={entry.id} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {entry.version && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    {entry.version}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.publishedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="text-sm font-semibold">{entry.title}</div>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {entry.content}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
