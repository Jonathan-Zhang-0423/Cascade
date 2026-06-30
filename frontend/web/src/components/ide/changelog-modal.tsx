import { useState, useEffect } from "react";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/components/theme-provider";

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
  const { mode } = useTheme();
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-2xl flex flex-col"
        style={{
          width: "60vw",
          height: "60vh",
          background: "var(--panel-mid-bg)",
          border: "1px solid var(--panel-divider)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4" style={{ borderBottom: "1px solid var(--panel-divider)" }}>
          <h2 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
            <span>🎉</span>
            <span>{t("changelog.title")}</span>
          </h2>
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading && (
            <div className="text-[13px] text-muted-foreground text-center py-10">加载中…</div>
          )}
          {!loading && entries.length === 0 && (
            <div className="text-[13px] text-muted-foreground text-center py-10">
              {t("changelog.empty")}
            </div>
          )}
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl p-4 space-y-2"
              style={{
                background: mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                border: "1px solid var(--panel-divider)",
              }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                {entry.version && (
                  <span
                    className="text-[11px] font-mono px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "rgba(79,130,255,0.12)", color: "#4f82ff" }}
                  >
                    {entry.version}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {new Date(entry.publishedAt).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}
                </span>
              </div>
              <div className="text-[13px] font-semibold text-foreground">{entry.title}</div>
              <div className="text-[12px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {entry.content}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
