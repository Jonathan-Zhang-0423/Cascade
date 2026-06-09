import { useState, useRef, useEffect } from "react";
import { useIDEStore, type FileNode } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useTheme } from "@/components/theme-provider";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, Home, Clock, Sun, Moon, HelpCircle, LogOut, ChevronDown } from "lucide-react";
import { THEME_LIST, type ThemeId } from "@/lib/themes";
import { getProjectEmoji } from "@/lib/project-emoji";
import { getMainEntryFile } from "@/lib/preview-adapters";
import { LangToggle } from "@/components/lang-toggle";
import { useT } from "@/lib/i18n";
import { useLanguageStore } from "@/stores/language-store";

interface NavbarProps {
  projectName: string;
  leftWidth: number;
  midWidth: number;
  previewTabs: { id: string; label: string; closable: boolean }[];
  activePreviewTab: string;
  toolsPanelOpen: boolean;
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
  onAddTab: () => void;
  onToggleTools: () => void;
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
  // Detect default export name: `export default function Foo` / `export default class Foo`
  const match = source.match(/export\s+default\s+(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
  const componentName = match?.[1] ?? "App";

  // Strip import statements — Babel standalone handles JSX but not ES module imports
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

const NON_RUNNABLE_EXTENSIONS = new Set([
  "html", "css", "scss", "sass", "less", "svg",
  "json", "yaml", "yml", "toml", "ini", "cfg",
  "xml", "md", "markdown", "sql", "graphql", "proto",
  "dockerfile", "vue", "svelte",
  "h", "hpp", "hxx",
]);

export function Navbar({
  projectName,
  leftWidth,
  midWidth,
  previewTabs,
  activePreviewTab,
  toolsPanelOpen,
  onTabClick,
  onTabClose,
  onAddTab,
  onToggleTools,
}: NavbarProps) {
  const {
    activeFile, setPreviewFile, setPreviewOverrideHtml, refreshPreview,
    files, saveProject, addConsoleEntry, clearConsole,
    isConsoleOpen, toggleConsole, projectId,
  } = useIDEStore();
  const { projects } = useProjectStore();
  const { themeId, setThemeId, mode } = useTheme();
  const { lang } = useLanguageStore();
  const [, navigate] = useLocation();
  const t = useT();
  const [isRunning, setIsRunning] = useState(false);
  const [logoMenuOpen, setLogoMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setLogoMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentProject = projects.find((p) => p.id === projectId);
  const frameworkLabel = currentProject?.framework
    ? currentProject.framework === "rn-expo" ? "React Native"
    : currentProject.framework === "flutter" ? "Flutter"
    : currentProject.framework === "kotlin" ? "Kotlin"
    : currentProject.framework === "swiftui" ? "SwiftUI"
    : currentProject.framework === "wechat" ? "WeChat"
    : currentProject.framework === "web" ? "Web"
    : currentProject.framework
    : "";

  const handleThemeChange = (id: ThemeId) => { setThemeId(id); };
  const handleBack = () => { saveProject(); navigate("/app"); };

  const handleRun = async () => {
    if (isRunning) return;
    if (!activeFile) return;
    const cp = projects.find((p) => p.id === projectId);
    const framework = cp?.framework || "web";
    if (framework === "web") { setPreviewOverrideHtml(null); setPreviewFile(getMainEntryFile("web")); return; }
    if (["rn-expo","flutter","kotlin","swiftui","wechat"].includes(framework)) { refreshPreview(); return; }
    const ext = activeFile.split(".").pop()?.toLowerCase() ?? "";
    if (["html","htm"].includes(ext)) {
      const content = findFileContent(files, activeFile);
      if (!content) return;
      setPreviewOverrideHtml(content); return;
    }
    if (["jsx","tsx"].includes(ext)) {
      const content = findFileContent(files, activeFile);
      if (!content) return;
      setPreviewOverrideHtml(buildReactPreviewHtml(content)); return;
    }
    addConsoleEntry({ level: "warn", message: t("navbar.noRunHint") });
  };

  // 深/浅色主题各选一个代表 ID
  const lightThemeId: ThemeId = "vs-light";
  const darkThemeId: ThemeId = "vs-dark";

  const menuItems = [
    { icon: <Home className="w-3.5 h-3.5" />, label: t("navbar.home"), action: () => { handleBack(); setLogoMenuOpen(false); } },
    { icon: <Clock className="w-3.5 h-3.5" />, label: t("navbar.recentProjects"), action: () => { navigate("/app"); setLogoMenuOpen(false); } },
    null, // divider
    {
      icon: mode === "light" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />,
      label: mode === "light" ? t("navbar.darkMode") : t("navbar.lightMode"),
      action: () => { setThemeId(mode === "light" ? darkThemeId : lightThemeId); setLogoMenuOpen(false); }
    },
    null, // divider
    { icon: <HelpCircle className="w-3.5 h-3.5" />, label: t("navbar.help"), action: () => setLogoMenuOpen(false) },
    { icon: <LogOut className="w-3.5 h-3.5" />, label: t("navbar.logout"), action: () => { navigate("/login"); setLogoMenuOpen(false); } },
  ];

  return (
    <header
      className="flex items-stretch shrink-0"
      style={{ height: 40, background: "var(--panel-nav-bg)", borderBottom: "1px solid var(--panel-divider)" }}
      data-testid="navbar"
    >
      {/* ① 左导航区 — 宽度 = leftWidth，与 ④ 左内容区对齐 */}
      <div
        className="flex items-center px-3 shrink-0"
        style={{ width: leftWidth, borderRight: "1px solid var(--panel-divider)" }}
      >
        <div className="relative" ref={menuRef}>
          <button
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-accent/20 transition-colors"
            onClick={() => setLogoMenuOpen((v) => !v)}
          >
            <div className="flex items-center gap-[3px] h-[16px]">
              {[16, 16, 16].map((h, i) => (
                <span key={i} className="block w-[3px] rounded-[2px] bg-foreground" style={{ height: h }} />
              ))}
            </div>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>

          {logoMenuOpen && (
            <div
              className="absolute top-full left-0 mt-1 w-48 rounded-lg py-1 z-50"
              style={{ background: "var(--panel-nav-bg)", border: "1px solid var(--panel-divider)", boxShadow: "var(--shadow-md)" }}
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

      {/* ② 中导航区 — 宽度 = midWidth，与 ⑤ 中内容区对齐，只显示项目名 */}
      <div
        className="flex items-center justify-center px-3 shrink-0 min-w-0"
        style={{ width: midWidth, borderRight: "1px solid var(--panel-divider)" }}
      >
        <span className="text-[13px] font-medium text-foreground truncate" data-testid="text-project-name">
          {projectName}
        </span>
      </div>

      {/* ③ 右导航区 — flex:1 撑满剩余，与 ⑥ 右内容区对齐，放预览 Tab 栏 */}
      <div className="flex-1 flex items-center min-w-0 overflow-hidden">
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

        {/* Tools & files — 紧跟在 Preview tab 右侧 */}
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
          Tools &amp; files
        </button>

        {/* + 新增 tab */}
        <button
          className="flex items-center justify-center w-7 h-full text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-1"
          onClick={onAddTab}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>

        <div className="flex-1" />

        {/* Invite */}
        <button
          className="flex items-center h-[26px] px-2.5 rounded-[5px] text-[11px] font-medium transition-colors shrink-0 border"
          style={{ background: "var(--panel-nav-bg)", borderColor: "var(--panel-divider)", color: "var(--foreground)" }}
        >
          Invite
        </button>

        {/* Publish */}
        <button
          className="flex items-center gap-1.5 h-[26px] px-2.5 rounded-[5px] text-[11px] text-white font-medium transition-colors shrink-0 ml-1"
          style={{ background: "hsl(var(--primary))" }}
        >
          <span className="w-[5px] h-[5px] rounded-full bg-white/70 shrink-0" />
          Publish
        </button>

        {/* ⊞ 展开 */}
        <button className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:bg-accent/20 transition-colors shrink-0 ml-0.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
      </div>
    </header>
  );
}