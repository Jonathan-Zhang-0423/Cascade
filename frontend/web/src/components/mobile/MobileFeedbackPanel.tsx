import { useState } from "react";
import { useTheme } from "@/components/theme-provider";

function MessageSquareIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function MobileFeedbackPanel() {
  const { mode } = useTheme();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: text.trim(), source: "mobile" }),
      });
      setDone(true);
      setText("");
      setTimeout(() => { setDone(false); setOpen(false); }, 1800);
    } catch { /* non-fatal */ } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        className="flex items-center justify-center w-8 h-8 rounded-lg"
        style={{ color: open ? "#4f82ff" : "var(--foreground)", opacity: open ? 1 : 0.7 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="用户建议"
      >
        <MessageSquareIcon />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1.5 rounded-xl p-4 flex flex-col gap-3"
          style={{
            width: "min(320px, 90vw)",
            background: mode === "dark" ? "hsl(222,22%,11%)" : "#fff",
            border: "1px solid var(--panel-divider)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
            zIndex: 200,
          }}
        >
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-foreground">用户建议</p>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setOpen(false)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">你的建议将帮助我们改进产品，我们会认真阅读每一条反馈。</p>
          <textarea
            className="w-full rounded-lg px-3 py-2.5 text-[13px] text-foreground resize-none outline-none"
            style={{
              background: "var(--panel-left-bg)",
              border: "1px solid var(--panel-divider)",
              minHeight: 100,
            }}
            placeholder="请输入你的建议或反馈..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            autoFocus
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/60">{text.length}/2000</span>
            <button
              className="px-4 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
              style={{
                background: done ? "rgba(52,214,138,0.15)" : "#4f82ff",
                color: done ? "#34d68a" : "white",
                opacity: submitting ? 0.6 : 1,
              }}
              onClick={handleSubmit}
              disabled={submitting || !text.trim()}
            >
              {done ? "✓ 已提交" : submitting ? "提交中..." : "提交建议"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
