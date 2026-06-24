import { useState, useRef, useEffect } from "react";
import logoBlack from "@/assets/Logo_simple_black.svg";
import logoWhite from "@/assets/Logo_simple_white.svg";
import { useIDEStore, type FileNode } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useTheme } from "@/components/theme-provider";
import { useLocation } from "wouter";
import { Home, Clock, Sun, Moon, HelpCircle, LogOut, ChevronDown, Maximize, Minimize, Languages, Monitor, Smartphone, Terminal, Type, Gift, Copy, Check, Megaphone, Bell, Send } from "lucide-react";
import { type ThemeId } from "@/lib/themes";
import { getMainEntryFile } from "@/lib/preview-adapters";
import { useT } from "@/lib/i18n";
import { useLanguageStore } from "@/stores/language-store";
import { getFirstDeviceForPlatform } from "@/lib/device-specs";
import { cn } from "@/lib/utils";
import { ChangelogModal } from "./changelog-modal";
import { PublishDialog } from "@/components/square/publish-dialog";

// 字体大小档位：value = html font-size 百分比
export const FONT_SIZES = [
  { key: "small", value: 87.5 },
  { key: "medium", value: 100 },
  { key: "large", value: 112.5 },
  { key: "xlarge", value: 125 },
] as const;
type FontSizeKey = typeof FONT_SIZES[number]["key"];

const FONT_SIZE_STORAGE_KEY = "cascade-font-size";

export function getFontSizeKey(): FontSizeKey {
  try {
    const v = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (v && FONT_SIZES.some((f) => f.key === v)) return v as FontSizeKey;
  } catch {}
  return "medium";
}

export function applyFontSize(key: FontSizeKey) {
  const size = FONT_SIZES.find((f) => f.key === key);
  if (!size) return;
  document.documentElement.style.fontSize = `${size.value}%`;
  try { localStorage.setItem(FONT_SIZE_STORAGE_KEY, key); } catch {}
}

interface NavbarProps {
  projectName: string;
  leftWidth: number;
  midWidth: number;
  previewTabs: { id: string; label: string; closable: boolean }[];
  activePreviewTab: string;
  toolsPanelOpen: boolean;
  isFullscreen: boolean;
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
  onAddTab: () => void;
  onToggleTools: () => void;
  onFullscreen: () => void;
  onOpenNotification: (type: "changelog", refId: number) => void;
}

function findFileContent(nodes: FileNode[], targetPath: string): string | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node.content ?? "";
    if (node.children) {
      const found = findFileContent(node.children, targetPath);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function buildReactPreviewHtml(source: string): string {
  const match = source.match(/export\s+default\s+(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
  const componentName = match?.[1] ?? "App";
  const stripped = source
    .replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, "")
    .replace(/^import\s+['"][^'"]+['"]\s*;?\s*$/gm, "");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <style>body { margin: 0; font-family: -apple-system, system-ui, sans-serif; }</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
${stripped}
const __root = ReactDOM.createRoot(document.getElementById('root'));
__root.render(React.createElement(${componentName}));
  </script>
</body>
</html>`;
}

export function Navbar({
  projectName,
  leftWidth,
  midWidth,
  previewTabs,
  activePreviewTab,
  toolsPanelOpen,
  isFullscreen,
  onTabClick,
  onTabClose,
  onAddTab,
  onToggleTools,
  onFullscreen,
  onOpenNotification,
}: NavbarProps) {
  const {
    activeFile, setPreviewFile, setPreviewOverrideHtml, refreshPreview,
    files, saveProject, addConsoleEntry, projectId,
    isConsoleOpen, toggleConsole, devicePlatform, setDevicePlatform, setSelectedDevice,
  } = useIDEStore();
  const { projects } = useProjectStore();
  const { setThemeId, mode } = useTheme();
  const { lang, setLang } = useLanguageStore();
  const [, navigate] = useLocation();
  const t = useT();

  // dropdown menu
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // invite panel
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const invitePanelRef = useRef<HTMLDivElement>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referralCount, setReferralCount] = useState<number>(0);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // feedback panel
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);

  // publish dialog
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishedAppId, setPublishedAppId] = useState<string | null>(null);

  // changelog modal
  const [changelogOpen, setChangelogOpen] = useState(false);

  // notification modal
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<{id:number;type:string;title:string;body:string|null;refId:number|null;isRead:boolean;createdAt:string}[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [selectedNotifId, setSelectedNotifId] = useState<number|null>(null);
  const [replyOpen, setReplyOpen] = useState<number|null>(null); // refId of feedback being replied to
  const [replyText, setReplyText] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyDone, setReplyDone] = useState(false);

  const unreadCount = notifs.filter((n) => !n.isRead).length;

  const fetchNotifs = async () => {
    setNotifLoading(true);
    try {
      const res = await fetch("/api/notifications", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setNotifs(data.notifications ?? []);
      }
    } catch { /* non-fatal */ } finally {
      setNotifLoading(false);
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

  const handleReplySubmit = async () => {
    if (!replyText.trim() || replySubmitting || replyOpen === null) return;
    setReplySubmitting(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: replyText.trim(), source: "pc" }),
      });
      setReplyDone(true);
      setReplyText("");
      setTimeout(() => { setReplyDone(false); setReplyOpen(null); }, 1800);
    } catch { /* non-fatal */ } finally {
      setReplySubmitting(false);
    }
  };

  useEffect(() => {
    fetchNotifs();
  }, []);

  useEffect(() => {
    if (notifOpen) fetchNotifs();
  }, [notifOpen]);

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim() || feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: feedbackText.trim(), source: "pc" }),
      });
      setFeedbackDone(true);
      setFeedbackText("");
      setTimeout(() => { setFeedbackDone(false); setFeedbackOpen(false); }, 1800);
    } catch { /* non-fatal */ } finally {
      setFeedbackSubmitting(false);
    }
  };

  useEffect(() => {
    if (!invitePanelOpen || referralCode) return;
    setInviteLoading(true);
    fetch("/api/referral/my-code", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.referralCode) {
          setReferralCode(d.referralCode);
          setReferralLink(d.referralLink);
          setReferralCount(d.referralCount ?? 0);
        }
      })
      .catch(() => {})
      .finally(() => setInviteLoading(false));
  }, [invitePanelOpen, referralCode]);

  const copyToClipboard = (text: string, type: "code" | "link") => {
    navigator.clipboard.writeText(text).then(() => {
      if (type === "code") { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000); }
      else { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }
    });
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!invitePanelRef.current) return;
      if (!invitePanelRef.current.contains(e.target as Node)) {
        setInvitePanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const [fontSize, setFontSize] = useState<FontSizeKey>(getFontSizeKey);

  const handleFontSize = (key: FontSizeKey) => {
    setFontSize(key);
    applyFontSize(key);
  };

  // close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setLogoMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentProject = projects.find((p) => p.id === projectId);
  const currentFramework = (currentProject as any)?.framework ?? "web";

  const lightThemeId: ThemeId = "vs-light";
  const darkThemeId: ThemeId = "vs-dark";

  const handleBack = () => { saveProject(); navigate("/app"); };

  const handleRun = async () => {
    if (!activeFile) return;
    const cp = projects.find((p) => p.id === projectId);
    const framework = cp?.framework || "web";
    if (framework === "web") { setPreviewOverrideHtml(null); setPreviewFile(getMainEntryFile("web")); return; }
    if (["rn-expo","flutter","kotlin","swiftui","wechat"].includes(framework)) { refreshPreview(); return; }
    const ext = activeFile.split(".").pop()?.toLowerCase() ?? "";
    if (["html","htm"].includes(ext)) {
      const content = findFileContent(files, activeFile);
      if (content) setPreviewOverrideHtml(content);
      return;
    }
    if (["jsx","tsx"].includes(ext)) {
      const content = findFileContent(files, activeFile);
      if (content) setPreviewOverrideHtml(buildReactPreviewHtml(content));
      return;
    }
    addConsoleEntry({ level: "warn", message: t("navbar.noRunHint") });
  };

  // fullscreen — 由外部传入，只全屏右内容区
  const handleFullscreen = onFullscreen;

  const menuItems = [
    { icon: <Home className="w-3.5 h-3.5" />, label: t("navbar.home"), action: () => { handleBack(); setLogoMenuOpen(false); } },
    { icon: <Clock className="w-3.5 h-3.5" />, label: t("navbar.recentProjects"), action: () => { navigate("/app"); setLogoMenuOpen(false); } },
    null,
    {
      icon: mode === "light" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />,
      label: mode === "light" ? t("navbar.darkMode") : t("navbar.lightMode"),
      action: () => { setThemeId(mode === "light" ? darkThemeId : lightThemeId); setLogoMenuOpen(false); }
    },
    {
      icon: <Languages className="w-3.5 h-3.5" />,
      label: lang === "zh" ? t("navbar.langEn") : t("navbar.langZh"),
      action: () => { setLang(lang === "zh" ? "en" : "zh"); setLogoMenuOpen(false); }
    },
    null,
    { icon: <HelpCircle className="w-3.5 h-3.5" />, label: t("navbar.help"), action: () => { setLogoMenuOpen(false); setFeedbackOpen(true); } },
    {
      icon: <Bell className="w-3.5 h-3.5" />,
      label: "消息通知",
      action: () => { setNotifOpen((v) => !v); setLogoMenuOpen(false); },
      badge: unreadCount,
    },
  ];

  return (
    <>
    <header
      className="flex items-stretch shrink-0"
      style={{ height: 40, background: "var(--panel-nav-bg)", borderBottom: "1px solid var(--panel-divider)" }}
      data-testid="navbar"
    >
      {/* ① 左导航区 */}
      <div
        className="flex items-center px-3 shrink-0"
        style={{ width: leftWidth }}
      >
        <div className="relative" ref={menuRef}>
          <button
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-accent/20 transition-colors relative"
            onClick={() => setLogoMenuOpen((v) => !v)}
          >
            <img
              src={mode === "dark" ? logoBlack : logoWhite}
              alt="logo"
              style={{ height: 20, width: "auto" }}
            />
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white font-bold"
                style={{ minWidth: 14, height: 14, fontSize: 9, background: "#ef4444", padding: "0 3px" }}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {logoMenuOpen && (
            <div
              className="absolute top-full left-0 mt-1 w-52 rounded-lg py-1 z-50"
              style={{
                background: mode === "dark" ? "hsl(222,22%,11%)" : "#F5F4F2",
                border: "1px solid var(--panel-divider)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                opacity: 1,
              }}
            >
              {menuItems.map((item, i) =>
                item === null ? (
                  <div key={`d${i}`} className="h-px my-1" style={{ background: "var(--panel-divider)" }} />
                ) : (
                  <button
                    key={item.label}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-foreground hover:bg-accent/20 transition-colors text-left"
                    onClick={item.action}
                  >
                    <span className="text-muted-foreground shrink-0">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {item.badge != null && item.badge > 0 && (
                      <span
                        className="flex items-center justify-center rounded-full text-white font-bold"
                        style={{ minWidth: 16, height: 16, fontSize: 9, background: "#ef4444", padding: "0 4px" }}
                      >
                        {item.badge > 9 ? "9+" : item.badge}
                      </span>
                    )}
                  </button>
                )
              )}
              {/* 字体大小 */}
              <div className="h-px my-1" style={{ background: "var(--panel-divider)" }} />
              <div className="px-3 py-1.5 flex items-center gap-2">
                <Type className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-[12px] text-foreground flex-1">{t("navbar.fontSize")}</span>
                <div className="flex gap-1 items-center">
                  {FONT_SIZES.map((f, fi) => (
                    <button
                      key={f.key}
                      onClick={() => handleFontSize(f.key)}
                      className={cn(
                        "w-7 h-7 rounded flex items-center justify-center transition-colors",
                        fontSize === f.key
                          ? "bg-[#4f82ff] text-white"
                          : "bg-accent/20 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                      )}
                      title={t(`navbar.fontSize${f.key.charAt(0).toUpperCase() + f.key.slice(1)}` as any)}
                      style={{ fontSize: 9 + fi * 2 }}
                    >
                      A
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 弹性间距，把 Home 推到最右侧 */}
        <div className="flex-1" />

        {/* Home 按钮 */}
        <button
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-accent/20 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          onClick={handleBack}
          title={t("navbar.home")}
        >
          <Home className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 竖线占位 5px，与 ide.tsx 绝对定位竖线宽度一致 */}
      <div style={{ width: 5, flexShrink: 0 }} />

      {/* ② 中导航区 */}
      <div
        className="flex items-center justify-center px-3 shrink-0 min-w-0"
        style={{ width: midWidth }}
      >
        <span className="text-[13px] font-medium text-foreground truncate" data-testid="text-project-name">
          {projectName}
        </span>
      </div>

      {/* 竖线占位 5px，与 ide.tsx 绝对定位竖线宽度一致 */}
      <div style={{ width: 5, flexShrink: 0 }} />

      {/* ③ 右导航区 */}
      <div className="flex-1 flex items-center px-2 min-w-0 overflow-visible gap-0.5">

        {/* Tab 列表 */}
        {previewTabs.map((tab) => (
          <div
            key={tab.id}
            className="flex items-center gap-1.5 px-2.5 h-full text-[12px] cursor-pointer transition-colors shrink-0 border-b-2 select-none"
            style={{
              borderBottomColor: activePreviewTab === tab.id ? "hsl(var(--primary))" : "transparent",
              color: activePreviewTab === tab.id ? "hsl(var(--primary))" : "var(--muted-foreground)",
            }}
            onClick={() => onTabClick(tab.id)}
          >
            {tab.id === "preview" && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            )}
            <span>{tab.label}</span>
            {tab.closable && (
              <button
                className="flex items-center justify-center w-3.5 h-3.5 rounded hover:bg-accent/20 text-muted-foreground transition-colors ml-0.5"
                onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
        ))}

        {/* Tools & files 或 + 按钮（有 New Tab 时只显示 +） */}
        {previewTabs.length <= 1 ? (
          <button
            className="flex items-center gap-1.5 h-[26px] px-2.5 rounded-[5px] text-[11px] font-medium transition-colors shrink-0 ml-1 border"
            style={{
              background: toolsPanelOpen ? "hsl(var(--accent))" : "var(--panel-nav-bg)",
              borderColor: toolsPanelOpen ? "hsl(var(--primary)/0.3)" : "var(--panel-divider)",
              color: toolsPanelOpen ? "hsl(var(--primary))" : "var(--foreground)",
            }}
            onClick={onToggleTools}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {t("navbar.toolsFiles")}
          </button>
        ) : (
          <button
            className="flex items-center justify-center w-[26px] h-[26px] rounded-[5px] text-muted-foreground hover:bg-accent/20 transition-colors shrink-0 ml-1 border"
            style={{ borderColor: "var(--panel-divider)", background: "var(--panel-nav-bg)" }}
            onClick={onAddTab}
            title={t("navbar.newTab")}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        )}

        <div className="flex-1" />

        {/* 控制台 icon */}
        <button
          className={cn("flex items-center justify-center w-[28px] h-[26px] border rounded-[6px] transition-colors shrink-0", isConsoleOpen ? "bg-[#F0F7FF] border-[#BFD9F2] text-[#0A66C2]" : "text-muted-foreground hover:text-foreground")}
          style={!isConsoleOpen ? { background: "var(--panel-nav-bg)", borderColor: "var(--panel-divider)" } : {}}
          onClick={toggleConsole}
          title="Terminal"
        >
          <Terminal className="w-[13px] h-[13px]" />
        </button>

        {/* 平台切换 */}
        <div className="flex items-center rounded-[6px] p-[2px] gap-[1px] shrink-0 ml-1 border" style={{ background: "var(--panel-nav-bg)", borderColor: "var(--panel-divider)" }}>
          <button
            className={cn("flex items-center justify-center w-[26px] h-[22px] rounded-[4px] transition-colors", devicePlatform === "android" ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            style={devicePlatform === "android" ? { background: "var(--panel-left-bg)" } : {}}
            onClick={() => { setDevicePlatform("android"); setSelectedDevice(getFirstDeviceForPlatform("android")); }}
            title="Desktop"
          >
            <Monitor className="w-[13px] h-[13px]" />
          </button>
          <button
            className={cn("flex items-center justify-center w-[26px] h-[22px] rounded-[4px] transition-colors", devicePlatform === "ios" ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            style={devicePlatform === "ios" ? { background: "var(--panel-left-bg)" } : {}}
            onClick={() => { setDevicePlatform("ios"); setSelectedDevice(getFirstDeviceForPlatform("ios")); }}
            title="Mobile"
          >
            <Smartphone className="w-[13px] h-[13px]" />
          </button>
        </div>

        {/* 发布按钮 */}
        <button
          className={cn(
            "flex items-center gap-1 h-[26px] px-2.5 rounded-[5px] text-[11px] font-medium transition-colors border shrink-0 ml-1",
            publishOpen
              ? "bg-[#4f82ff]/10 border-[#4f82ff]/30 text-[#4f82ff]"
              : "text-muted-foreground hover:text-foreground border-[var(--panel-divider)]"
          )}
          style={!publishOpen ? { background: "var(--panel-nav-bg)" } : {}}
          onClick={() => setPublishOpen(true)}
          title={t("navbar.publish")}
        >
          <Send className="w-[12px] h-[12px]" />
          <span className="hidden sm:inline">{t("navbar.publish")}</span>
        </button>

        {/* 邀请按钮 */}
        <div className="relative shrink-0 ml-1" ref={invitePanelRef}>
          <button
            className={cn(
              "flex items-center gap-1 h-[26px] px-2.5 rounded-[5px] text-[11px] font-medium transition-colors border",
              invitePanelOpen
                ? "bg-[#4f82ff]/10 border-[#4f82ff]/30 text-[#4f82ff]"
                : "text-muted-foreground hover:text-foreground border-[var(--panel-divider)]"
            )}
            style={!invitePanelOpen ? { background: "var(--panel-nav-bg)" } : {}}
            onClick={() => setInvitePanelOpen((v) => !v)}
            title={t("navbar.invite")}
          >
            <Gift className="w-[12px] h-[12px]" />
            <span className="hidden sm:inline">{t("navbar.invite")}</span>
          </button>

          {invitePanelOpen && (
            <div
              className="absolute top-full right-0 mt-1.5 w-72 rounded-xl p-4 z-50 flex flex-col gap-3"
              style={{
                background: mode === "dark" ? "hsl(222,22%,11%)" : "#fff",
                border: "1px solid var(--panel-divider)",
                boxShadow: "0 4px 24px rgba(0,0,0,0.14)",
              }}
            >
              <div>
                <p className="text-[13px] font-semibold text-foreground">{t("navbar.invitePanel.title")}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{t("navbar.invitePanel.desc")}</p>
              </div>

              {inviteLoading ? (
                <p className="text-[12px] text-muted-foreground">{t("navbar.invitePanel.loading")}</p>
              ) : referralCode ? (
                <>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      {t("navbar.invitePanel.yourCode")}
                    </p>
                    <div className="flex items-center gap-2">
                      <code
                        className="flex-1 text-[13px] font-mono tracking-widest px-3 py-2 rounded-lg"
                        style={{ background: "var(--panel-left-bg)", color: "var(--foreground)" }}
                      >
                        {referralCode}
                      </code>
                      <button
                        className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
                        style={{ background: "var(--panel-left-bg)" }}
                        onClick={() => copyToClipboard(referralCode, "code")}
                        title={t("navbar.invitePanel.copyCode")}
                      >
                        {copiedCode
                          ? <Check className="w-3.5 h-3.5 text-green-500" />
                          : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                      </button>
                    </div>
                  </div>

                  <button
                    className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-[12px] font-medium transition-colors"
                    style={{
                      background: copiedLink ? "rgba(52,214,138,0.12)" : "#4f82ff",
                      color: copiedLink ? "#34d68a" : "white",
                    }}
                    onClick={() => referralLink && copyToClipboard(referralLink, "link")}
                  >
                    {copiedLink
                      ? <><Check className="w-3.5 h-3.5" />{t("navbar.invitePanel.copied")}</>
                      : <><Copy className="w-3.5 h-3.5" />{t("navbar.invitePanel.copyLink")}</>}
                  </button>

                  <p className="text-[11px] text-muted-foreground text-center">
                    {t("navbar.invitePanel.referralCount").replace("{n}", String(referralCount))}
                  </p>
                </>
              ) : (
                <p className="text-[12px] text-muted-foreground">{t("navbar.invitePanel.loading")}</p>
              )}
            </div>
          )}
        </div>

        {/* 全屏按钮 */}
        <button
          className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:bg-accent/20 transition-colors shrink-0 ml-0.5"
          onClick={handleFullscreen}
          title={isFullscreen ? t("navbar.exitFullscreen") : t("navbar.enterFullscreen")}
        >
          {isFullscreen
            ? <Minimize className="w-[13px] h-[13px]" />
            : <Maximize className="w-[13px] h-[13px]" />}
        </button>
      </div>
    </header>

    {/* ── 用户建议弹窗 ── */}
    {feedbackOpen && (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.45)" }}
        onClick={(e) => { if (e.target === e.currentTarget) setFeedbackOpen(false); }}
      >
        <div
          ref={feedbackRef}
          className="w-full max-w-md mx-4 rounded-2xl p-6 flex flex-col gap-4"
          style={{ background: "var(--panel-mid-bg)", border: "1px solid var(--panel-divider)", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-foreground">{t("navbar.help")}</h2>
            <button className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => setFeedbackOpen(false)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <p className="text-[12px] text-muted-foreground">你的建议将帮助我们改进产品，我们会认真阅读每一条反馈。</p>
          <textarea
            className="w-full rounded-lg px-3 py-2.5 text-[13px] text-foreground resize-none outline-none focus:ring-1 focus:ring-[#4f82ff]"
            style={{ background: "var(--panel-left-bg)", border: "1px solid var(--panel-divider)", minHeight: 120 }}
            placeholder="请输入你的建议或反馈..."
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            maxLength={2000}
            autoFocus
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/60">{feedbackText.length}/2000</span>
            <button
              className="px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
              style={{
                background: feedbackDone ? "rgba(52,214,138,0.15)" : "#4f82ff",
                color: feedbackDone ? "#34d68a" : "white",
                opacity: feedbackSubmitting ? 0.6 : 1,
              }}
              onClick={handleFeedbackSubmit}
              disabled={feedbackSubmitting || !feedbackText.trim()}
            >
              {feedbackDone ? "✓ 已提交" : feedbackSubmitting ? "提交中..." : "提交建议"}
            </button>
          </div>
        </div>
      </div>
    )}

    <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />

    {/* ── 消息通知居中大弹窗 ── */}
    {notifOpen && (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
        onClick={(e) => { if (e.target === e.currentTarget) setNotifOpen(false); }}
      >
        <div
          className="rounded-2xl flex flex-col overflow-hidden"
          style={{
            width: "min(780px, 88vw)",
            height: "min(620px, 85vh)",
            background: "var(--panel-mid-bg)",
            border: "1px solid var(--panel-divider)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-3.5 shrink-0" style={{ borderBottom: "1px solid var(--panel-divider)" }}>
            <div className="flex items-center gap-2.5">
              <span className="text-[13px] font-semibold text-foreground tracking-tight">消息通知</span>
              {unreadCount > 0 && (
                <span className="flex items-center justify-center rounded-full text-white font-bold text-[10px]"
                  style={{ minWidth: 17, height: 17, background: "#4f82ff", padding: "0 4px" }}>
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-[11px] transition-opacity hover:opacity-70" style={{ color: "#4f82ff" }}>
                  全部已读
                </button>
              )}
              <button className="flex items-center justify-center w-5 h-5 rounded transition-colors text-muted-foreground hover:text-foreground" onClick={() => setNotifOpen(false)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          {/* 双栏内容区 */}
          <div className="flex flex-1 overflow-hidden">

            {/* 左栏：通知列表 */}
            <div className="flex flex-col overflow-y-auto shrink-0" style={{ width: 260, borderRight: "1px solid var(--panel-divider)" }}>
              {notifLoading && (
                <div className="flex items-center justify-center flex-1 py-12">
                  <div className="w-4 h-4 rounded-full border-2 border-[#4f82ff] border-t-transparent animate-spin" />
                </div>
              )}
              {!notifLoading && notifs.length === 0 && (
                <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 py-12">
                  <Bell className="w-6 h-6 text-muted-foreground opacity-40" />
                  <p className="text-[12px] text-muted-foreground text-center">暂无通知</p>
                </div>
              )}
              {notifs.map((n, idx) => {
                const isSelected = (selectedNotifId ?? notifs[0]?.id) === n.id;
                return (
                  <div
                    key={n.id}
                    className="relative flex items-center gap-2.5 px-4 cursor-pointer transition-colors shrink-0"
                    style={{
                      height: 72,
                      borderBottom: "1px solid var(--panel-divider)",
                      background: isSelected ? "rgba(79,130,255,0.08)" : n.isRead ? "transparent" : "rgba(79,130,255,0.04)",
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(79,130,255,0.06)"; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = n.isRead ? "transparent" : "rgba(79,130,255,0.04)"; }}
                    onClick={() => {
                      markRead(n.id);
                      setSelectedNotifId(n.id);
                    }}
                  >
                    {!n.isRead && (
                      <div className="absolute left-0 top-4 bottom-4 rounded-r-full" style={{ width: 2.5, background: "#4f82ff" }} />
                    )}
                    <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg mt-0.5"
                      style={{ background: n.type === "changelog" ? "rgba(79,130,255,0.10)" : "rgba(52,214,138,0.10)" }}>
                      <span className="text-[12px]">{n.type === "changelog" ? "🎉" : "💬"}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] leading-snug truncate" style={{ fontWeight: n.isRead ? 400 : 600, color: "var(--foreground)" }}>
                        {n.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {new Date(n.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    {isSelected && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-l-full" style={{ background: "#4f82ff" }} />}
                  </div>
                );
              })}
            </div>

            {/* 右栏：详情展示 */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {notifs.length === 0 && !notifLoading ? (
                <div className="flex flex-col items-center justify-center flex-1 gap-3">
                  <div className="flex items-center justify-center w-14 h-14 rounded-2xl"
                    style={{ background: "rgba(79,130,255,0.07)", border: "1px solid rgba(79,130,255,0.12)" }}>
                    <Bell className="w-6 h-6" style={{ color: "#4f82ff", opacity: 0.6 }} />
                  </div>
                  <div className="text-center">
                    <p className="text-[13px] font-medium text-foreground">收件箱是空的</p>
                    <p className="text-[12px] text-muted-foreground mt-1">新消息会出现在这里</p>
                  </div>
                </div>
              ) : (() => {
                const active = notifs.find(n => n.id === (selectedNotifId ?? notifs[0]?.id)) ?? notifs[0];
                if (!active) return null;
                return (
                  <div className="flex flex-col h-full">
                    {/* 详情头部 — 固定高度与左栏第一条对齐 */}
                    <div className="px-6 shrink-0 flex flex-col justify-center" style={{ height: 72, borderBottom: "1px solid var(--panel-divider)" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(79,130,255,0.10)", color: "#4f82ff" }}>
                          {active.type === "changelog" ? "更新公告" : "系统消息"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(active.createdAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <h3 className="text-[14px] font-semibold text-foreground leading-snug truncate">{active.title}</h3>
                    </div>
                    {/* 详情内容 */}
                    <div className="flex-1 overflow-y-auto px-6 py-5">
                      {active.body ? (
                        <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{active.body}</p>
                      ) : (
                        <p className="text-[13px] text-muted-foreground">暂无详细内容。</p>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

          </div>
        </div>
      </div>
    )}

    {/* ── 管理员回复：用户回复弹窗 ── */}
    {replyOpen !== null && (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.45)" }}
        onClick={(e) => { if (e.target === e.currentTarget) { setReplyOpen(null); setReplyText(""); } }}
      >
        <div
          className="w-full max-w-md mx-4 rounded-2xl p-6 flex flex-col gap-4"
          style={{ background: "var(--panel-mid-bg)", border: "1px solid var(--panel-divider)", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-foreground">回复管理员</h2>
            <button className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setReplyOpen(null); setReplyText(""); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <p className="text-[12px] text-muted-foreground">你的回复将作为新的意见反馈发送给团队。</p>
          <textarea
            className="w-full rounded-lg px-3 py-2.5 text-[13px] text-foreground resize-none outline-none focus:ring-1 focus:ring-[#4f82ff]"
            style={{ background: "var(--panel-left-bg)", border: "1px solid var(--panel-divider)", minHeight: 100 }}
            placeholder="输入你的回复..."
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            maxLength={2000}
            autoFocus
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/60">{replyText.length}/2000</span>
            <button
              className="px-4 py-2 rounded-lg text-[13px] font-medium transition-colors"
              style={{
                background: replyDone ? "rgba(52,214,138,0.15)" : "#4f82ff",
                color: replyDone ? "#34d68a" : "white",
                opacity: replySubmitting ? 0.6 : 1,
              }}
              onClick={handleReplySubmit}
              disabled={replySubmitting || !replyText.trim()}
            >
              {replyDone ? "✓ 已发送" : replySubmitting ? "发送中..." : "发送"}
            </button>
          </div>
        </div>
      </div>
    )}

    {projectId && (
      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        projectId={projectId}
        projectName={projectName}
        onPublished={(app) => { setPublishedAppId(app.id); setPublishOpen(false); }}
        onUnpublished={() => { setPublishedAppId(null); }}
      />
    )}
  </>
  );
}
