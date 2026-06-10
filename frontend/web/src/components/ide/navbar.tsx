import { useState, useRef, useEffect } from "react";
import logoBlack from "@/assets/Logo_simple_black.svg";
import logoWhite from "@/assets/Logo_simple_white.svg";
import { useIDEStore, type FileNode } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useTheme } from "@/components/theme-provider";
import { useLocation } from "wouter";
import { Home, Clock, Sun, Moon, HelpCircle, LogOut, ChevronDown, Copy, Check, Download, Globe, QrCode, Maximize, Minimize, Languages } from "lucide-react";
import { type ThemeId } from "@/lib/themes";
import { getMainEntryFile } from "@/lib/preview-adapters";
import { useT } from "@/lib/i18n";
import { useLanguageStore } from "@/stores/language-store";

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
}: NavbarProps) {
  const {
    activeFile, setPreviewFile, setPreviewOverrideHtml, refreshPreview,
    files, saveProject, addConsoleEntry, projectId,
  } = useIDEStore();
  const { projects } = useProjectStore();
  const { setThemeId, mode } = useTheme();
  const { lang, setLang } = useLanguageStore();
  const [, navigate] = useLocation();
  const t = useT();

  // dropdown menu
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const inviteRef = useRef<HTMLDivElement>(null);

  // publish modal
  const [publishOpen, setPublishOpen] = useState(false);
  const publishRef = useRef<HTMLDivElement>(null);
  const [publishCopied, setPublishCopied] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  // close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setLogoMenuOpen(false);
      if (inviteRef.current && !inviteRef.current.contains(e.target as Node)) setInviteOpen(false);
      if (publishRef.current && !publishRef.current.contains(e.target as Node)) setPublishOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentProject = projects.find((p) => p.id === projectId);

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

  // invite — 前端占位链接，后端接口待实现
  const shareLink = `${window.location.origin}/invite/${projectId ?? ""}`;
  const handleInviteCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {}
  };

  // publish — export zip
  const handleExportZip = async () => {
    if (!projectId) return;
    setExportLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/export`);
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentProject?.name ?? "project"}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addConsoleEntry({ level: "error", message: "Export failed" });
    } finally {
      setExportLoading(false);
    }
  };

  const handlePublishCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setPublishCopied(true);
      setTimeout(() => setPublishCopied(false), 2000);
    } catch {}
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
    { icon: <HelpCircle className="w-3.5 h-3.5" />, label: t("navbar.help"), action: () => setLogoMenuOpen(false) },
    { icon: <LogOut className="w-3.5 h-3.5" />, label: t("navbar.logout"), action: () => { navigate("/login"); setLogoMenuOpen(false); } },
  ];

  return (
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
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-accent/20 transition-colors"
            onClick={() => setLogoMenuOpen((v) => !v)}
          >
            <img
              src={mode === "dark" ? logoBlack : logoWhite}
              alt="logo"
              style={{ height: 20, width: "auto" }}
            />
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>

          {logoMenuOpen && (
            <div
              className="absolute top-full left-0 mt-1 w-48 rounded-lg py-1 z-50"
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
                    {item.label}
                  </button>
                )
              )}
            </div>
          )}
        </div>
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
      <div className="flex-1 flex items-center px-2 min-w-0 overflow-hidden gap-0.5">

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

        {/* Invite */}
        <div className="relative" ref={inviteRef}>
          <button
            className="flex items-center h-[26px] px-2.5 rounded-[5px] text-[11px] font-medium transition-colors shrink-0 border"
            style={{ background: "var(--panel-nav-bg)", borderColor: "var(--panel-divider)", color: "var(--foreground)" }}
            onClick={() => { setInviteOpen((v) => !v); setPublishOpen(false); }}
          >
            {t("navbar.invite")}
          </button>

          {inviteOpen && (
            <div
              className="absolute top-full right-0 mt-1.5 w-52 rounded-xl z-50"
              style={{ background: mode === "dark" ? "hsl(222,22%,11%)" : "#F5F4F2", border: "1px solid var(--panel-divider)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", opacity: 1 }}
            >
              <div className="px-4 py-4 flex flex-col items-center gap-1.5 text-center">
                <span className="text-[22px]">🚀</span>
                <div className="text-[13px] font-semibold text-foreground">{t("navbar.comingSoon")}</div>
                <div className="text-[12px] text-muted-foreground">{t("navbar.inviteDesc")}</div>
              </div>
            </div>
          )}
        </div>

        {/* Publish */}
        <div className="relative ml-1" ref={publishRef}>
          <button
            className="flex items-center gap-1.5 h-[26px] px-2.5 rounded-[5px] text-[11px] text-white font-medium transition-colors shrink-0"
            style={{ background: "hsl(var(--primary))" }}
            onClick={() => { setPublishOpen((v) => !v); setInviteOpen(false); }}
          >
            <span className="w-[5px] h-[5px] rounded-full bg-white/70 shrink-0" />
            {t("navbar.publish")}
          </button>

          {publishOpen && (
            <div
              className="absolute top-full right-0 mt-1.5 w-52 rounded-xl z-50"
              style={{ background: mode === "dark" ? "hsl(222,22%,11%)" : "#F5F4F2", border: "1px solid var(--panel-divider)", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", opacity: 1 }}
            >
              <div className="px-4 py-4 flex flex-col items-center gap-1.5 text-center">
                <span className="text-[22px]">🚀</span>
                <div className="text-[13px] font-semibold text-foreground">{t("navbar.comingSoon")}</div>
                <div className="text-[12px] text-muted-foreground">{t("navbar.publishDesc")}</div>
              </div>
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
  );
}
