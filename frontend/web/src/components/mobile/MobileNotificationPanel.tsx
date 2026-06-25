import { useState, useEffect, useRef } from "react";
import { useTheme } from "@/components/theme-provider";
import { TOP_BAR_H } from "./MobileIDE";

function BellIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

type Notif = { id: number; type: string; title: string; body: string | null; isRead: boolean; createdAt: string };

export function MobileNotificationPanel() {
  const { mode } = useTheme();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifs.filter((n) => !n.isRead).length;

  const fetchNotifs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setNotifs(data.notifications ?? []);
      }
    } catch { /* non-fatal */ } finally {
      setLoading(false);
    }
  };

  const markRead = async (id: number) => {
    setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
    await fetch(`/api/notifications/${id}/read`, { method: "PATCH", credentials: "include" }).catch(() => {});
  };

  const markAllRead = async () => {
    setNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await fetch("/api/notifications/read-all", { method: "PATCH", credentials: "include" }).catch(() => {});
  };

  const handleItemClick = (n: Notif) => {
    markRead(n.id);
    setExpandedId((prev) => prev === n.id ? null : n.id);
  };

  useEffect(() => { fetchNotifs(); }, []);
  useEffect(() => { if (open) fetchNotifs(); }, [open]);

  // 计算顶栏实际底部位置（像素）
  const topOffset = TOP_BAR_H; // 顶栏固定高度，safe-area 已由 MobileIDE 父容器处理

  return (
    <>
      {/* 铃铛按钮 */}
      <button
        className="relative flex items-center justify-center w-8 h-8 rounded-lg"
        style={{ color: open ? "#4f82ff" : "var(--foreground)", opacity: open ? 1 : 0.7 }}
        onClick={() => setOpen((v) => !v)}
        aria-label="通知"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white font-bold"
            style={{ background: "#ef4444", fontSize: 9, minWidth: 14, height: 14, padding: "0 3px" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* 背景蒙层——覆盖整个屏幕 */}
          <div
            className="fixed inset-0"
            style={{ zIndex: 300, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
            onClick={() => setOpen(false)}
          />

          {/* 通知面板——紧贴顶栏底部，铺满剩余屏幕 */}
          <div
            ref={panelRef}
            className="fixed left-0 right-0 flex flex-col"
            style={{
              top: topOffset,
              bottom: 0,
              zIndex: 301,
              background: mode === "dark" ? "hsl(222,22%,10%)" : "#ffffff",
              borderTop: `1px solid var(--panel-divider)`,
              overflowY: "hidden",
            }}
          >
            {/* 头部工具栏 */}
            <div
              className="flex items-center justify-between px-4 shrink-0"
              style={{ height: 48, borderBottom: "1px solid var(--panel-divider)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-foreground">消息通知</span>
                {unreadCount > 0 && (
                  <span
                    className="flex items-center justify-center rounded-full text-white font-bold text-[10px]"
                    style={{ minWidth: 17, height: 17, background: "#4f82ff", padding: "0 4px" }}
                  >
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    className="text-[12px] font-medium"
                    style={{ color: "#4f82ff" }}
                    onClick={markAllRead}
                  >
                    全部已读
                  </button>
                )}
                <button
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setOpen(false)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* 通知列表——可滚动 */}
            <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              {loading && (
                <div className="flex items-center justify-center py-16">
                  <div className="w-5 h-5 rounded-full border-2 border-[#4f82ff] border-t-transparent animate-spin" />
                </div>
              )}

              {!loading && notifs.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 py-24">
                  <div className="flex items-center justify-center w-14 h-14 rounded-2xl"
                    style={{ background: "rgba(79,130,255,0.07)", border: "1px solid rgba(79,130,255,0.12)" }}>
                    <BellIcon size={24} />
                  </div>
                  <p className="text-[13px] font-medium text-foreground">收件箱是空的</p>
                  <p className="text-[12px] text-muted-foreground">新消息会出现在这里</p>
                </div>
              )}

              {notifs.map((n) => {
                const isExpanded = expandedId === n.id;
                return (
                  <div
                    key={n.id}
                    className="relative"
                    style={{ borderBottom: "1px solid var(--panel-divider)" }}
                  >
                    {/* 条目行 */}
                    <div
                      className="flex items-center gap-3 px-4 py-3.5 cursor-pointer active:opacity-70 transition-opacity select-none"
                      style={{ background: n.isRead ? "transparent" : "rgba(79,130,255,0.04)" }}
                      onClick={() => handleItemClick(n)}
                    >
                      {/* 未读蓝条 */}
                      {!n.isRead && (
                        <div className="absolute left-0 top-3 bottom-3 rounded-r-full"
                          style={{ width: 3, background: "#4f82ff" }} />
                      )}

                      {/* 图标 */}
                      <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-xl"
                        style={{ background: n.type === "changelog" ? "rgba(79,130,255,0.10)" : "rgba(52,214,138,0.10)" }}>
                        <span className="text-[16px]">{n.type === "changelog" ? "🎉" : "💬"}</span>
                      </div>

                      {/* 文字 */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] leading-snug"
                          style={{ fontWeight: n.isRead ? 400 : 600, color: "var(--foreground)" }}>
                          {n.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {new Date(n.createdAt).toLocaleString("zh-CN", {
                            month: "2-digit", day: "2-digit",
                            hour: "2-digit", minute: "2-digit"
                          })}
                        </p>
                      </div>

                      {/* 展开箭头 */}
                      {n.body && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2"
                          className="shrink-0 text-muted-foreground transition-transform duration-200"
                          style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      )}
                    </div>

                    {/* 展开内容 */}
                    {isExpanded && n.body && (
                      <div
                        className="px-4 pb-4 pt-2"
                        style={{
                          background: mode === "dark"
                            ? "rgba(255,255,255,0.025)"
                            : "rgba(0,0,0,0.018)",
                          borderTop: "1px solid var(--panel-divider)",
                        }}
                      >
                        <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
                          {n.body}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 底部安全区域占位 */}
              <div style={{ height: "env(safe-area-inset-bottom, 16px)" }} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
