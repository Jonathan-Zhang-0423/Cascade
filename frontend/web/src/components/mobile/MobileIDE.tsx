import { useState, useRef, useCallback } from "react";
import { useProjectStore } from "@/stores/project-store";
import { MobileChatPanel } from "./MobileChatPanel";
import { MobilePreviewPanel } from "./MobilePreviewPanel";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/components/theme-provider";
import { CascadeLogo } from "@/assets/CascadeLogo";
import { applyFontSize, getFontSizeKey, FONT_SIZES } from "@/components/ide/navbar";
import { cn } from "@/lib/utils";
import { MobileInvitePanel } from "./MobileInvitePanel";
import { MobileFeedbackPanel } from "./MobileFeedbackPanel";

type Tab = "chat" | "preview";

interface MobileIDEProps {
  projectId: string;
}

export const INPUT_AREA_H = 84;
export const CAPSULE_H = 38; // 胶囊尺寸加大

// 顶部 bar 高度，MobileChatPanel 通过 padding-top 留出同等空间
export const TOP_BAR_H = 44;

export function MobileIDE({ projectId }: MobileIDEProps) {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const { projects } = useProjectStore();
  const project = projects.find((p) => p.id === projectId);
  const t = useT();
  const { mode } = useTheme();
  const [fontSize, setFontSize] = useState(() => getFontSizeKey());
  const [fontMenuOpen, setFontMenuOpen] = useState(false);

  const handleFontSize = (key: typeof FONT_SIZES[number]["key"]) => {
    setFontSize(key);
    applyFontSize(key);
    setFontMenuOpen(false);
  };

  const TAB_LABELS: Record<Tab, string> = {
    chat: t("mobile.chatTab"),
    preview: t("mobile.previewTab"),
  };

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) setActiveTab("preview");
    else setActiveTab("chat");
  }, []);

  const capsuleBottom = activeTab === "chat" ? INPUT_AREA_H + 24 : 16;

  return (
    <div
      className="h-screen w-screen overflow-hidden bg-background relative"
      style={{ paddingTop: "env(safe-area-inset-top)", overscrollBehaviorY: "none" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 内容区 — 两个面板始终挂载，CSS 控制显隐，彻底消除切换黑屏 */}
      <div className="h-full">
        <div style={{ display: activeTab === "chat" ? "block" : "none", height: "100%" }}>
          <MobileChatPanel />
        </div>
        <div style={{ display: activeTab === "preview" ? "block" : "none", height: "100%" }}>
          <MobilePreviewPanel />
        </div>
      </div>

      {/* ── 顶部 bar（仅对话页）：返回 + 项目名居中 + 字体大小按钮 ── */}
      {activeTab === "chat" && (
        <div
          className="fixed left-0 right-0 z-40 flex items-center px-3"
          style={{
            top: "env(safe-area-inset-top)",
            height: TOP_BAR_H,
            background: mode === "dark" ? "hsl(222,22%,11%)" : "#ffffff",
            opacity: 1,
            borderBottom: mode === "dark" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(0,0,0,0.10)",
          }}
        >
          {/* 返回按钮（左侧绝对定位，不占据 flex 空间） */}
          <a
            href="/app"
            className="absolute left-3 flex items-center justify-center"
            style={{ height: 30, textDecoration: "none", color: "var(--foreground)" }}
            aria-label="Back to home"
          >
            <CascadeLogo width={22} height={22} />
          </a>

          {/* 项目名居中 */}
          <div className="flex items-center justify-center w-full min-w-0">
            <span className="text-sm font-medium truncate max-w-[55vw]" style={{ color: "var(--foreground)" }}>
              {project?.name ?? ""}
            </span>
          </div>

          {/* 字体大小按钮 + 邀请按钮（右侧绝对定位） */}
          <div className="absolute right-3 flex items-center gap-1">
            <button
              className="flex items-center justify-center w-8 h-8 rounded-lg"
              style={{ color: "var(--foreground)", opacity: 0.7 }}
              onClick={() => setFontMenuOpen((v) => !v)}
              aria-label={t("navbar.fontSize")}
            >
              <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1 }}>A</span>
            </button>
            {fontMenuOpen && (
              <div
                className="absolute top-full right-8 mt-1 rounded-xl py-2 px-3 flex gap-2 items-center"
                style={{
                  background: mode === "dark" ? "hsl(222,22%,11%)" : "#F5F4F2",
                  border: "1px solid var(--panel-divider)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                  zIndex: 100,
                }}
              >
                {FONT_SIZES.map((f, fi) => (
                  <button
                    key={f.key}
                    onClick={() => handleFontSize(f.key)}
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                      fontSize === f.key
                        ? "bg-[#4f82ff] text-white"
                        : "text-muted-foreground hover:bg-accent/30"
                    )}
                    style={{ fontSize: 9 + fi * 2 }}
                  >
                    A
                  </button>
                ))}
              </div>
            )}
            <MobileInvitePanel />
            <MobileFeedbackPanel />
          </div>
        </div>
      )}

      {/* ── 悬浮胶囊 tab ── */}
      <div
        className="fixed left-0 right-0 z-50 flex justify-center pointer-events-none"
        style={{ bottom: capsuleBottom }}
      >
        <div
          className="flex items-center gap-0.5 px-1.5 py-1.5 pointer-events-auto"
          style={{
            height: CAPSULE_H,
            borderRadius: 999,
            background: activeTab === "preview" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.55)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            border: activeTab === "preview" ? "1px solid rgba(255,255,255,0.20)" : "1px solid rgba(0,0,0,0.10)",
            boxShadow: activeTab === "preview" ? "0 2px 12px rgba(0,0,0,0.30)" : "0 2px 12px rgba(0,0,0,0.12)",
            transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s",
          }}
        >
          {(["chat", "preview"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                fontSize: 12,
                fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? "#FFFFFF" : "#1A1A1A",
                background: activeTab === tab ? "#1A1A1A" : "transparent",
                border: "none",
                borderRadius: 999,
                padding: "4px 20px",
                lineHeight: "22px",
                transition: "all 0.15s",
                cursor: "pointer",
              }}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
