import { cn } from "@/lib/utils";
import { useIDEStore, findFileContent, flattenFiles, type FileNode } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, ExternalLink, Terminal, Monitor, Plus, X, Search, ChevronRight, Globe, Database, Lock, Shield, Key, Zap, BarChart2, Settings, Users, CheckSquare, GitBranch, Code, Cpu, Workflow, FileText, FilePlus } from "lucide-react";
import { useT } from "@/lib/i18n";
import { DeviceSimulator } from "./device-simulator";
import { DEVICE_LIST, getDeviceSpec, getFirstDeviceForPlatform, makeCustomSpec } from "@/lib/device-specs";
import { getPreviewMode, getFrameworkLabel, getFrameworkColor, getMainEntryFile } from "@/lib/preview-adapters";
import { CodePreview } from "./code-preview";
import { WasmPreview } from "./wasm-preview";
import { RnWebPreview } from "./rn-web-preview";
import { FlutterWebPreview } from "./flutter-web-preview";
import { WeChatPreview } from "./wechat-preview";
import { ConsolePanel } from "./console-panel";
import { FileTree } from "./file-tree";

function resolveFilePath(src: string, basePath: string): string {
  if (src.startsWith("/project/")) return src;

  let resolved: string;
  if (src.startsWith("/")) {
    resolved = `/project${src}`;
  } else {
    const baseDir = basePath.substring(0, basePath.lastIndexOf("/"));
    resolved = `${baseDir}/${src}`;
  }

  const parts = resolved.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === "" && normalized.length > 0) continue;
    if (part === ".") continue;
    if (part === ".." && normalized.length > 1) {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join("/");
}

function isExternalUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//");
}

function inlineExternalFiles(html: string, files: FileNode[], entryPath = "/project/index.html"): string {
  let result = html;

  result = result.replace(
    /<link\s+([^>]*?)(?:rel=["']stylesheet["'][^>]*?href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*?rel=["']stylesheet["'])[^>]*\/?>/gi,
    (match, _attrs, href1, href2) => {
      const href = href1 || href2;
      if (!href || isExternalUrl(href)) return match;
      const filePath = resolveFilePath(href, entryPath);
      const content = findFileContent(files, filePath);
      if (content !== undefined) {
        return `<style>/* ${href} */\n${content}\n</style>`;
      }
      return match;
    }
  );

  result = result.replace(
    /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (match, src) => {
      if (isExternalUrl(src)) return match;
      const filePath = resolveFilePath(src, entryPath);
      const content = findFileContent(files, filePath);
      if (content !== undefined) {
        return `<script>/* ${src} */\n${content}\n</script>`;
      }
      return match;
    }
  );

  return result;
}

export function PreviewPanel({ fullscreen = false }: { fullscreen?: boolean }) {
  const {
    files,
    addConsoleEntry,
    clearConsole,
    previewFile,
    previewRefreshKey,
    previewOverrideHtml,
    projectFramework,
    selectedDevice,
    setSelectedDevice,
    deviceOrientation,
    setDeviceOrientation,
    devicePlatform,
    setDevicePlatform,
    deviceFrameStyle,
    setDeviceFrameStyle,
    customDeviceWidth,
    customDeviceHeight,
    setCustomDeviceDimensions,
    projectId,
    isConsoleOpen,
    toggleConsole,
  } = useIDEStore();
  const { projects } = useProjectStore();
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const t = useT();

  // Right-panel tab state: "preview" | "terminal" | "files"
  type RightTab = "preview" | "terminal" | "files";
  const [activeTab, setActiveTab] = useState<RightTab>("preview");

  const currentProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId]
  );
  const framework = projectFramework || currentProject?.framework || "web";
  const previewMode = getPreviewMode(framework);

  useEffect(() => {
    if (framework === "swiftui" && devicePlatform !== "ios") {
      setDevicePlatform("ios");
      setSelectedDevice(getFirstDeviceForPlatform("ios"));
    } else if (framework === "kotlin" && devicePlatform !== "android") {
      setDevicePlatform("android");
      setSelectedDevice(getFirstDeviceForPlatform("android"));
    }
  }, [framework]);

  const filteredDevices = useMemo(
    () => DEVICE_LIST.filter((d) => d.platform === devicePlatform),
    [devicePlatform]
  );

  useEffect(() => {
    if (selectedDevice !== "custom") {
      const spec = getDeviceSpec(selectedDevice);
      if (spec.platform !== devicePlatform) {
        setSelectedDevice(getFirstDeviceForPlatform(devicePlatform));
      }
    }
  }, [selectedDevice, devicePlatform, setSelectedDevice]);

  const isCustom = selectedDevice === "custom";
  const deviceSpec = isCustom
    ? makeCustomSpec(customDeviceWidth || 390, customDeviceHeight || 844, devicePlatform)
    : getDeviceSpec(selectedDevice);

  const effectiveRefresh = refreshKey + previewRefreshKey;

  const handlePlatformChange = (platform: "ios" | "android") => {
    setDevicePlatform(platform);
    const currentSpec = getDeviceSpec(selectedDevice);
    if (selectedDevice === "custom" || currentSpec.platform !== platform) {
      setSelectedDevice(getFirstDeviceForPlatform(platform));
    }
  };

  const htmlContent = useMemo(() => {
    return findFileContent(files, previewFile) || "";
  }, [files, previewFile, effectiveRefresh]);

  const injectedHtml = useMemo(() => {
    const consoleInterceptor = `
<script>
(function() {
  const origConsole = {};
  ['log', 'warn', 'error', 'info'].forEach(function(level) {
    origConsole[level] = console[level];
    console[level] = function() {
      var args = Array.prototype.slice.call(arguments);
      var message = args.map(function(arg) {
        if (typeof arg === 'object') {
          try { return JSON.stringify(arg, null, 2); } catch(e) { return String(arg); }
        }
        return String(arg);
      }).join(' ');
      window.parent.postMessage({
        type: '__cascade_console__',
        level: level,
        message: message
      }, '*');
      origConsole[level].apply(console, arguments);
    };
  });

  window.onerror = function(message, source, lineno, colno, error) {
    window.parent.postMessage({
      type: '__cascade_console__',
      level: 'error',
      message: message + (lineno ? ' (line ' + lineno + ')' : '')
    }, '*');
  };
})();
</script>`;

    const resolved = inlineExternalFiles(htmlContent, files, previewFile);

    if (resolved.includes('<head>')) {
      return resolved.replace('<head>', '<head>' + consoleInterceptor);
    }
    return consoleInterceptor + resolved;
  }, [htmlContent, files, previewFile]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (
        e.data &&
        e.data.type === "__cascade_console__" &&
        iframeRef.current &&
        e.source === iframeRef.current.contentWindow
      ) {
        const level = e.data.level as string;
        const message = String(e.data.message || "");
        if (["log", "warn", "error", "info"].includes(level)) {
          addConsoleEntry({ level: level as "log" | "warn" | "error" | "info", message });
        }
        // Forward errors/warnings to the active build session so the verifier can see them
        if ((level === "error" || level === "warn") && projectId) {
          try {
            const sessionId = localStorage.getItem(`cascade-build-session-${projectId}`);
            if (sessionId) {
              fetch(`/api/build-session/${sessionId}/console-event`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ level, message }),
              }).catch(() => {});
            }
          } catch {}
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [addConsoleEntry, projectId]);

  const handleRefresh = () => {
    clearConsole();
    setRefreshKey((k) => k + 1);
  };

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const lastPushedHashRef = useRef<string>("");

  const computeFilesHash = useCallback((payload: { path: string; content: string }[]): string => {
    let hash = "";
    for (const f of payload) {
      hash += f.path + "|" + f.content + "\n";
    }
    return hash;
  }, []);

  const pushFilesToPreviewServer = useCallback(async () => {
    const flat = flattenFiles(files).filter((f) => f.content !== undefined);
    const payload = flat.map((f) => ({ path: f.path, content: f.content || "" }));

    const hashStr = computeFilesHash(payload);
    if (hashStr === lastPushedHashRef.current && previewUrl && previewToken) {
      return previewUrl;
    }

    lastPushedHashRef.current = hashStr;

    if (!previewToken) {
      const res = await fetch("/api/preview-server/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload }),
      });
      const data = await res.json();
      if (data.url && data.token) {
        const url = data.url.replace(/^http:\/\//, "https://");
        setPreviewUrl(url);
        setPreviewToken(data.token);
        return url;
      }
      return null;
    }

    await fetch("/api/preview-server/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: payload, token: previewToken }),
    });
    return previewUrl;
  }, [files, previewUrl, previewToken, computeFilesHash]);

  const handleQrOpen = useCallback(async () => {
    setQrLoading(true);
    try {
      await pushFilesToPreviewServer();
    } finally {
      setQrLoading(false);
    }
  }, [pushFilesToPreviewServer]);

  useEffect(() => {
    if (!previewUrl || !previewToken) return;
    const timer = setTimeout(() => {
      pushFilesToPreviewServer();
    }, 1000);
    return () => clearTimeout(timer);
  }, [files, previewUrl, previewToken]);

  useEffect(() => {
    if (!previewToken || previewRefreshKey === 0) return;
    fetch("/api/preview-server/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: previewToken }),
    }).catch(() => {});
  }, [previewRefreshKey, previewToken]);

  useEffect(() => {
    const token = previewToken;
    return () => {
      if (token) {
        fetch("/api/preview-server/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }).catch(() => {});
      }
    };
  }, [previewToken]);

  const handleCopyUrl = useCallback(async () => {
    if (!previewUrl) return;
    try {
      await navigator.clipboard.writeText(previewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [previewUrl]);

  // Tools & files 展开面板状态
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false);
  const [toolsSearch, setToolsSearch] = useState("");
  const toolsSearchRef = useRef<HTMLInputElement>(null);

  // 预览 tab 列表
  type PreviewTab = { id: string; label: string; closable: boolean };
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([
    { id: "preview", label: "Preview", closable: false },
  ]);
  const [activePreviewTab, setActivePreviewTab] = useState("preview");

  const addPreviewTab = () => {
    const id = `tab-${Date.now()}`;
    setPreviewTabs((prev) => [...prev, { id, label: "New tab", closable: true }]);
    setActivePreviewTab(id);
    setToolsPanelOpen(true);
  };

  const closePreviewTab = (id: string) => {
    setPreviewTabs((prev) => prev.filter((t) => t.id !== id));
    if (activePreviewTab === id) setActivePreviewTab("preview");
  };

  useEffect(() => {
    if (toolsPanelOpen) setTimeout(() => toolsSearchRef.current?.focus(), 50);
    else setToolsSearch("");
  }, [toolsPanelOpen]);

  type ToolItem = { icon: React.ReactNode; label: string; desc?: string; action?: () => void; badge?: string };
  type ToolSection = { title: string; items: ToolItem[] };

  const TOOLS_SECTIONS: ToolSection[] = [
    {
      title: "Jump to existing tab",
      items: [
        { icon: <Monitor className="w-4 h-4" />, label: "Preview", desc: "Open the live preview", action: () => { setActivePreviewTab("preview"); setToolsPanelOpen(false); } },
      ],
    },
    {
      title: "Suggested",
      items: [
        { icon: <Globe className="w-4 h-4" />,       label: "Publishing",      desc: "Deploy your app to the web" },
        { icon: <Plus className="w-4 h-4" />,         label: "Integrations",    desc: "Connect third-party services" },
        { icon: <Database className="w-4 h-4" />,     label: "Database",        desc: "Manage your PostgreSQL database" },
        { icon: <Database className="w-4 h-4" />,     label: "App Storage",     desc: "File storage for your app" },
        { icon: <Users className="w-4 h-4" />,        label: "Auth",            desc: "User authentication & sessions" },
        { icon: <Shield className="w-4 h-4" />,       label: "Security Center", desc: "Secrets, CORS, and access rules" },
        { icon: <Key className="w-4 h-4" />,          label: "Secrets",         desc: "Environment variables & secrets" },
        { icon: <Zap className="w-4 h-4" />,          label: "Agent Skills",    desc: "Extend the AI with custom skills" },
        { icon: <Cpu className="w-4 h-4" />,          label: "Automations",     desc: "Scheduled tasks and triggers" },
        { icon: <Monitor className="w-4 h-4" />,      label: "Canvas",          desc: "Visual app canvas" },
        { icon: <BarChart2 className="w-4 h-4" />,    label: "Growth",          desc: "Analytics and growth tools" },
        { icon: <BarChart2 className="w-4 h-4" />,    label: "Monitoring",      desc: "Uptime and performance monitoring" },
        { icon: <Settings className="w-4 h-4" />,     label: "User Settings",   desc: "Profile and preferences" },
        { icon: <CheckSquare className="w-4 h-4" />,  label: "Validation",      desc: "Form and data validation rules" },
        { icon: <Monitor className="w-4 h-4" />,      label: "Preview",         desc: "Live preview of your app", action: () => { setActivePreviewTab("preview"); setToolsPanelOpen(false); } },
      ],
    },
    {
      title: "Advanced",
      items: [
        { icon: <Search className="w-4 h-4" />,       label: "Code Search",     desc: "Search across all files" },
        { icon: <Terminal className="w-4 h-4" />,     label: "Console",         desc: "Browser console output" },
        { icon: <Code className="w-4 h-4" />,         label: "Developer",       desc: "Dev tools and diagnostics" },
        { icon: <GitBranch className="w-4 h-4" />,    label: "Git",             desc: "Version control" },
        { icon: <Terminal className="w-4 h-4" />,     label: "Shell",           desc: "Run shell commands" },
        { icon: <Monitor className="w-4 h-4" />,      label: "VNC",             desc: "Remote desktop view" },
        { icon: <Workflow className="w-4 h-4" />,     label: "Workflows",       desc: "Automate your build pipeline" },
      ],
    },
    {
      title: "Files",
      items: [
        { icon: <FileText className="w-4 h-4" />,  label: "Files",    desc: "Browse and edit project files" },
        { icon: <FilePlus className="w-4 h-4" />,  label: "New file", desc: "Create a new file" },
      ],
    },
  ];

  const filteredSections = toolsSearch.trim()
    ? TOOLS_SECTIONS.map((s) => ({
        ...s,
        items: s.items.filter((item) =>
          item.label.toLowerCase().includes(toolsSearch.toLowerCase()) ||
          (item.desc?.toLowerCase() ?? "").includes(toolsSearch.toLowerCase())
        ),
      })).filter((s) => s.items.length > 0)
    : TOOLS_SECTIONS;

  return (
    <div className="h-full flex flex-col relative" data-testid="preview-panel">

      {/* ── 顶部 Tab 栏 ── */}
      <div className="flex items-center h-[38px] border-b border-[#E5E7EB] bg-white shrink-0 px-1 gap-0">
        {previewTabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-full text-[12px] cursor-pointer transition-colors shrink-0 border-b-2 select-none",
              activePreviewTab === tab.id
                ? "border-[#0066FF] text-[#0066FF]"
                : "border-transparent text-[#9CA3AF] hover:text-[#6B6B6B]"
            )}
            onClick={() => { setActivePreviewTab(tab.id); setToolsPanelOpen(false); }}
          >
            {tab.id === "preview" && <Monitor className="w-3 h-3 shrink-0" />}
            <span>{tab.label}</span>
            {tab.closable && (
              <button
                className="flex items-center justify-center w-3.5 h-3.5 rounded hover:bg-[#F3F4F6] text-[#9CA3AF] hover:text-[#6B6B6B] transition-colors ml-0.5"
                onClick={(e) => { e.stopPropagation(); closePreviewTab(tab.id); }}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        ))}

        <button
          className="flex items-center justify-center w-7 h-full text-[#9CA3AF] hover:text-[#6B6B6B] transition-colors shrink-0"
          onClick={addPreviewTab}
          aria-label="New tab"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>

        <div className="flex-1" />

        {/* Tools & files 按钮 */}
        <button
          className={cn(
            "flex items-center gap-1.5 h-[26px] px-2.5 rounded-[5px] text-[11px] font-medium transition-colors shrink-0 mx-1 border",
            toolsPanelOpen
              ? "bg-[#EEF2FF] text-[#0066FF] border-[#BFDBFE]"
              : "bg-white border-[#E5E7EB] text-[#374151] hover:bg-[#F3F4F6]"
          )}
          onClick={() => setToolsPanelOpen((v) => !v)}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Tools &amp; files
        </button>

        <button className="flex items-center h-[26px] px-2.5 bg-white border border-[#E5E7EB] rounded-[5px] text-[11px] text-[#374151] hover:bg-[#F3F4F6] transition-colors shrink-0">
          Invite
        </button>
        <button className="flex items-center gap-1.5 h-[26px] px-2.5 bg-[#0066FF] rounded-[5px] text-[11px] text-white font-medium hover:bg-[#0052CC] transition-colors shrink-0 ml-1">
          <span className="w-[5px] h-[5px] rounded-full bg-white/70 shrink-0" />
          Publish
        </button>
        <button className="flex items-center justify-center w-7 h-7 rounded text-[#9CA3AF] hover:bg-[#F3F4F6] transition-colors shrink-0 ml-0.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
      </div>

      {/* ── Tools & files 展开面板（完整复刻图2/3/4） ── */}
      {toolsPanelOpen && (
        <div className="absolute top-[38px] left-0 right-0 bottom-0 z-40 bg-white flex flex-col overflow-hidden">
          {/* 搜索框 */}
          <div className="px-4 pt-4 pb-3 border-b border-[#F3F4F6] shrink-0">
            <div className="flex items-center gap-2 h-9 px-3 bg-[#F3F4F6] rounded-lg border border-transparent focus-within:border-[#BFDBFE] focus-within:bg-white transition-colors">
              <Search className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
              <input
                ref={toolsSearchRef}
                className="flex-1 bg-transparent text-[13px] text-[#111827] placeholder-[#9CA3AF] outline-none"
                placeholder="Search for tools & files..."
                value={toolsSearch}
                onChange={(e) => setToolsSearch(e.target.value)}
              />
              {toolsSearch && (
                <button onClick={() => setToolsSearch("")} className="text-[#9CA3AF] hover:text-[#6B6B6B]">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 工具列表 */}
          <div className="flex-1 overflow-y-auto pb-2">
            {filteredSections.map((section) => (
              <div key={section.title}>
                <div className="px-4 pt-4 pb-1.5 text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                  {section.title}
                </div>
                {section.items.map((item) => (
                  <button
                    key={`${item.label}-${item.desc}`}
                    className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-[#F9FAFB] transition-colors group text-left"
                    onClick={() => { item.action?.(); }}
                  >
                    <div className="w-8 h-8 rounded-lg bg-[#F3F4F6] group-hover:bg-[#ECEEF0] flex items-center justify-center shrink-0 transition-colors text-[#6B7280]">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-[#111827] leading-tight">{item.label}</div>
                      {item.desc && (
                        <div className="text-[11px] text-[#9CA3AF] mt-0.5 truncate">{item.desc}</div>
                      )}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-[#D1D5DB] group-hover:text-[#9CA3AF] shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            ))}
            {filteredSections.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Search className="w-6 h-6 text-[#D1D5DB]" />
                <p className="text-[13px] text-[#9CA3AF]">No results for "{toolsSearch}"</p>
              </div>
            )}
          </div>

          {/* 底部关闭 */}
          <div className="border-t border-[#F3F4F6] px-4 py-2.5 shrink-0 flex items-center justify-between">
            <span className="text-[11px] text-[#9CA3AF]">{TOOLS_SECTIONS.reduce((n, s) => n + s.items.length, 0)} tools available</span>
            <button
              className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF] hover:text-[#6B6B6B] transition-colors"
              onClick={() => setToolsPanelOpen(false)}
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Canvas 预览内容 ── */}
      {activePreviewTab === "preview" && (
        <>
          {/* Preview toolbar */}
          <div className="preview-toolbar flex items-center gap-1.5 px-2.5 h-[38px] border-b border-[#E5E7EB] bg-[#F9FAFB] shrink-0">
            <button className="flex items-center gap-1.5 h-[26px] px-2 bg-white border border-[#E5E7EB] rounded-[6px] text-[12px] text-[#1A1A1A] hover:bg-[#F3F4F6] transition-colors shrink-0" data-testid="button-app-select">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
              </svg>
              <span className="max-w-[80px] truncate">{currentProject?.name || "App"}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button className="flex items-center justify-center w-[26px] h-[26px] rounded-[4px] text-[#D1D5DB] hover:bg-[#F3F4F6] hover:text-[#6B6B6B] transition-colors" aria-label="Back">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button className="flex items-center justify-center w-[26px] h-[26px] rounded-[4px] text-[#D1D5DB] hover:bg-[#F3F4F6] hover:text-[#6B6B6B] transition-colors" aria-label="Forward">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <button className="flex items-center justify-center w-[26px] h-[26px] rounded-[4px] text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#6B6B6B] transition-colors" onClick={handleRefresh} aria-label={t("preview.refresh")} data-testid="button-refresh-preview">
              <RefreshCw className="w-[13px] h-[13px]" />
            </button>
            <div className="flex-1 flex items-center gap-1.5 h-[26px] px-2.5 bg-[#F3F4F6] border border-[#E5E7EB] rounded-[6px] min-w-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              <span className="text-[12px] text-[#6B6B6B] truncate">{previewUrl ? previewUrl.replace(/^https?:\/\//, "") : "localhost"}</span>
            </div>
            <div className="flex items-center bg-white border border-[#E5E7EB] rounded-[6px] p-[2px] gap-[1px] shrink-0">
              <button className={cn("flex items-center justify-center w-[26px] h-[22px] rounded-[4px] transition-colors", devicePlatform === "android" ? "bg-[#F3F4F6] text-[#1A1A1A]" : "text-[#9CA3AF] hover:text-[#6B6B6B]")} onClick={() => handlePlatformChange("android")} data-testid="button-platform-android">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              </button>
              <button className={cn("flex items-center justify-center w-[26px] h-[22px] rounded-[4px] transition-colors", devicePlatform === "ios" ? "bg-[#F3F4F6] text-[#1A1A1A]" : "text-[#9CA3AF] hover:text-[#6B6B6B]")} onClick={() => handlePlatformChange("ios")} data-testid="button-platform-ios">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2"/></svg>
              </button>
            </div>
            <button className="flex items-center justify-center w-[28px] h-[26px] bg-white border border-[#E5E7EB] rounded-[6px] text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#6B6B6B] transition-colors shrink-0">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <button className="flex items-center justify-center w-[28px] h-[26px] bg-white border border-[#E5E7EB] rounded-[6px] text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#6B6B6B] transition-colors shrink-0" onClick={() => previewUrl && window.open(previewUrl, "_blank")} data-testid="button-open-preview-url">
              <ExternalLink className="w-[13px] h-[13px]" />
            </button>
            <button
              className={cn("flex items-center justify-center w-[28px] h-[26px] border rounded-[6px] transition-colors shrink-0", isConsoleOpen ? "bg-[#EEF2FF] border-[#BFDBFE] text-[#0066FF]" : "bg-white border-[#E5E7EB] text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#6B6B6B]")}
              onClick={toggleConsole}
              data-testid="button-toggle-console"
            >
              <Terminal className="w-[13px] h-[13px]" />
            </button>
          </div>

          {/* 预览内容区 — PC全屏 / Mobile固定比例 */}
          <div className={cn("flex-1 min-h-0 overflow-hidden", devicePlatform === "ios" ? "bg-[#F0F0F0] flex items-center justify-center" : "bg-white flex items-stretch")}>
            {devicePlatform === "ios" ? (
              <div className="relative bg-white shadow-xl overflow-hidden flex-shrink-0" style={{ width: 375, maxWidth: "100%", aspectRatio: "375 / 812", maxHeight: "100%", borderRadius: 12, boxShadow: "0 0 0 1px rgba(0,0,0,0.1), 0 8px 32px rgba(0,0,0,0.12)" }}>
                {previewMode === "kotlin-wasm" || previewMode === "swift-wasm" ? (<WasmPreview files={files} framework={framework} projectId={projectId} refreshKey={effectiveRefresh} />) :
                previewMode === "code-preview" ? (<CodePreview files={files} framework={framework} projectId={projectId} mainEntryFile={getMainEntryFile(framework)} />) :
                previewMode === "rn-web" ? (<RnWebPreview files={files} framework={framework} projectId={projectId} refreshKey={effectiveRefresh} projectName={currentProject?.name} />) :
                previewMode === "flutter-web" ? (<FlutterWebPreview files={files} framework={framework} projectId={projectId} refreshKey={effectiveRefresh} />) :
                previewMode === "wechat-preview" ? (<WeChatPreview files={files} refreshKey={effectiveRefresh} projectId={projectId} />) : (
                  <>
                    {!previewOverrideHtml && !previewFile && previewMode === "iframe-preview" ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white" style={{ animation: "fade-up 150ms ease" }}>
                        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-slate-400"><rect x="4" y="4" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.5" /><path d="M11 10l7 4-7 4V10z" fill="currentColor" /></svg>
                        <p className="text-[12px] text-slate-400">{t("preview.runFirst")}</p>
                      </div>
                    ) : (
                      <iframe ref={iframeRef} key={effectiveRefresh} srcDoc={previewOverrideHtml ?? injectedHtml} className="w-full h-full border-0" style={{ cursor: "pointer" }} title={t("preview.title")} sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups" data-testid="preview-iframe" />
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="w-full h-full relative">
                {previewMode === "kotlin-wasm" || previewMode === "swift-wasm" ? (<WasmPreview files={files} framework={framework} projectId={projectId} refreshKey={effectiveRefresh} />) :
                previewMode === "code-preview" ? (<CodePreview files={files} framework={framework} projectId={projectId} mainEntryFile={getMainEntryFile(framework)} />) :
                previewMode === "rn-web" ? (<RnWebPreview files={files} framework={framework} projectId={projectId} refreshKey={effectiveRefresh} projectName={currentProject?.name} />) :
                previewMode === "flutter-web" ? (<FlutterWebPreview files={files} framework={framework} projectId={projectId} refreshKey={effectiveRefresh} />) :
                previewMode === "wechat-preview" ? (<WeChatPreview files={files} refreshKey={effectiveRefresh} projectId={projectId} />) : (
                  <>
                    {!previewOverrideHtml && !previewFile && previewMode === "iframe-preview" ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white" style={{ animation: "fade-up 150ms ease" }}>
                        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-slate-400"><rect x="4" y="4" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.5" /><path d="M11 10l7 4-7 4V10z" fill="currentColor" /></svg>
                        <p className="text-[12px] text-slate-400">{t("preview.runFirst")}</p>
                      </div>
                    ) : (
                      <iframe ref={iframeRef} key={effectiveRefresh} srcDoc={previewOverrideHtml ?? injectedHtml} className="w-full h-full border-0" style={{ cursor: "pointer" }} title={t("preview.title")} sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups" data-testid="preview-iframe" />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}