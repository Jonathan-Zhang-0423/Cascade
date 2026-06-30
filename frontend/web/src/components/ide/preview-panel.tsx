import { cn } from "@/lib/utils";
import { useIDEStore, findFileContent, flattenFiles, type FileNode } from "@/stores/ide-store";
import { inlineExternalFiles } from "@/lib/inline-preview-assets";
import { useProjectStore } from "@/stores/project-store";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, ExternalLink, Terminal, Monitor, Plus, X, Search, ChevronRight, Globe, Database, Lock, Shield, Key, Zap, BarChart2, Settings, Users, CheckSquare, GitBranch, Code, Cpu, Workflow, FileText, FilePlus, ChevronDown } from "lucide-react";
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
import { CheckpointPanel } from "./CheckpointPanel";

// Preview iframe capability policy. Kept in one place so the iOS/Android
// iframes stay in sync. 3D/WebGL games need more than the old token set:
//   - allow-pointer-lock  → FPS / orbit mouse-capture controls
//   - allow-popups-to-escape-sandbox → opened windows aren't crippled
// The `allow` attribute (Permissions Policy) grants the powerful features
// browsers gate separately from sandbox: fullscreen, gamepad, WebXR/VR,
// device motion/orientation (mobile tilt controls), and autoplay audio.
const PREVIEW_SANDBOX =
  "allow-scripts allow-modals allow-same-origin allow-forms allow-popups allow-pointer-lock allow-popups-to-escape-sandbox";
const PREVIEW_ALLOW =
  "fullscreen; autoplay; gamepad; xr-spatial-tracking; accelerometer; gyroscope; magnetometer";

// 常用文件类型列表
const FILE_TYPES = [
  { ext: "tsx",  label: "TypeScript React (.tsx)" },
  { ext: "ts",   label: "TypeScript (.ts)" },
  { ext: "jsx",  label: "JavaScript React (.jsx)" },
  { ext: "js",   label: "JavaScript (.js)" },
  { ext: "html", label: "HTML (.html)" },
  { ext: "css",  label: "CSS (.css)" },
  { ext: "json", label: "JSON (.json)" },
  { ext: "md",   label: "Markdown (.md)" },
  { ext: "txt",  label: "Text (.txt)" },
  { ext: "py",   label: "Python (.py)" },
  { ext: "sh",   label: "Shell (.sh)" },
];

function NewFilePanel({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { addFile } = useIDEStore();
  const t = useT();
  const [fileName, setFileName] = useState("");
  const [selectedExt, setSelectedExt] = useState("tsx");
  const [dropOpen, setDropOpen] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleCreate = () => {
    const raw = fileName.trim();
    if (!raw) { setError("请输入文件名"); return; }
    // 如果用户已经带了扩展名就不重复加
    const hasExt = raw.includes(".");
    const finalName = hasExt ? raw : `${raw}.${selectedExt}`;
    addFile("", finalName, "file");
    onCreated();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: "var(--panel-right-bg)" }}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 h-[38px] shrink-0 border-b" style={{ borderColor: "var(--panel-divider)" }}>
        <span className="text-[12px] font-medium text-foreground">{t("tools.newFile")}</span>
        <button
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-accent/20 text-muted-foreground transition-colors"
          onClick={onCancel}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 表单 */}
      <div className="px-4 pt-5 flex flex-col gap-4">
        {/* 文件名 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            文件名
          </label>
          <input
            ref={inputRef}
            className="h-9 px-3 rounded-lg text-[13px] outline-none border"
            style={{
              background: "var(--panel-nav-bg)",
              borderColor: error ? "#ef4444" : "var(--panel-divider)",
              color: "var(--foreground)",
            }}
            placeholder="例如：MyComponent"
            value={fileName}
            onChange={(e) => { setFileName(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onCancel(); }}
          />
          {error && <span className="text-[11px] text-red-500">{error}</span>}
        </div>

        {/* 文件类型下拉 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            文件类型
          </label>
          <div className="relative">
            <button
              className="flex items-center justify-between w-full h-9 px-3 rounded-lg text-[13px] border"
              style={{ background: "var(--panel-nav-bg)", borderColor: "var(--panel-divider)", color: "var(--foreground)" }}
              onClick={() => setDropOpen((v) => !v)}
            >
              <span>{FILE_TYPES.find((f) => f.ext === selectedExt)?.label ?? selectedExt}</span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </button>
            {dropOpen && (
              <div
                className="absolute top-full left-0 right-0 mt-1 rounded-lg z-50 py-1 max-h-48 overflow-y-auto"
                style={{ background: "var(--panel-nav-bg)", border: "1px solid var(--panel-divider)", boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}
              >
                {FILE_TYPES.map((ft) => (
                  <button
                    key={ft.ext}
                    className="flex items-center w-full px-3 py-2 text-[12px] text-left hover:bg-accent/20 transition-colors"
                    style={{ color: ft.ext === selectedExt ? "hsl(var(--primary))" : "var(--foreground)" }}
                    onClick={() => { setSelectedExt(ft.ext); setDropOpen(false); }}
                  >
                    {ft.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 预览文件名 */}
        {fileName.trim() && (
          <div className="text-[11px] text-muted-foreground">
            将创建：<span className="font-medium text-foreground">
              {fileName.trim().includes(".") ? fileName.trim() : `${fileName.trim()}.${selectedExt}`}
            </span>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 pt-1">
          <button
            className="flex-1 h-8 rounded-lg text-[12px] font-medium transition-colors text-white"
            style={{ background: "hsl(var(--primary))" }}
            onClick={handleCreate}
          >
            创建文件
          </button>
          <button
            className="flex-1 h-8 rounded-lg text-[12px] font-medium transition-colors border"
            style={{ background: "var(--panel-nav-bg)", borderColor: "var(--panel-divider)", color: "var(--foreground)" }}
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export function PreviewPanel({
  fullscreen = false,
  activePreviewTab,
  toolsPanelOpen,
  setToolsPanelOpen,
}: {
  fullscreen?: boolean;
  activePreviewTab?: string;
  toolsPanelOpen?: boolean;
  setToolsPanelOpen?: (v: boolean | ((prev: boolean) => boolean)) => void;
}) {
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
    planPreviewOpen,
    planPreviewData,
    setPlanPreview,
  } = useIDEStore();
  const { projects } = useProjectStore();
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const t = useT();

  // Right-panel tab state: "preview" | "terminal" | "files" | "newfile"
  type RightTab = "preview" | "terminal" | "files" | "newfile";
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

  // Tools & files 展开面板状态（toolsPanelOpenState/setToolsPanelOpenState 由 props 传入）
  const toolsPanelOpenState = toolsPanelOpen ?? false;
  const setToolsPanelOpenState = setToolsPanelOpen ?? (() => {});
  const [toolsSearch, setToolsSearch] = useState("");
  const toolsSearchRef = useRef<HTMLInputElement>(null);

  // activePreviewTabState 由 props 传入
  const activePreviewTabState = activePreviewTab ?? "preview";

  // 切回 Preview tab 时重置 activeTab
  useEffect(() => {
    if (activePreviewTabState === "preview") {
      setActiveTab("preview");
    }
  }, [activePreviewTabState]);

  useEffect(() => {
    if (toolsPanelOpenState) setTimeout(() => toolsSearchRef.current?.focus(), 50);
    else setToolsSearch("");
  }, [toolsPanelOpenState]);

  type ToolItem = { icon: React.ReactNode; label: string; desc?: string; action?: () => void };
  type ToolSection = { title: string; items: ToolItem[] };

  const { setActiveTool } = useIDEStore();

  // Tools & files 面板：只保留 Preview / Files / New file，接入真实功能
  const TOOLS_SECTIONS: ToolSection[] = [
    {
      title: t("tools.sectionViews"),
      items: [
        {
          icon: <Monitor className="w-4 h-4" />,
          label: t("tools.preview"),
          desc: t("tools.previewDesc"),
          action: () => { setActiveTab("preview"); setToolsPanelOpenState(false); },
        },
        {
          icon: <FileText className="w-4 h-4" />,
          label: t("tools.files"),
          desc: t("tools.filesDesc"),
          action: () => { setActiveTab("files"); setToolsPanelOpenState(false); },
        },
        {
          icon: <FilePlus className="w-4 h-4" />,
          label: t("tools.newFile"),
          desc: t("tools.newFileDesc"),
          action: () => { setActiveTab("newfile"); setToolsPanelOpenState(false); },
        },
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

      {/* ── Tools & files 展开面板（完整复刻图2/3/4） ── */}
      {toolsPanelOpenState && (
        <div className="absolute top-[38px] left-0 right-0 bottom-0 z-40 flex flex-col overflow-hidden" style={{ background: "var(--panel-right-bg, #fff)" }}>
          {/* 搜索框 */}
          <div className="px-4 pt-2 pb-2 border-b border-[#F5F5F5] shrink-0">
            <div className="flex items-center gap-2 h-9 px-3 bg-[#F5F5F5] rounded-lg border border-transparent focus-within:border-[#BFD9F2] focus-within:bg-white transition-colors">
              <Search className="w-3.5 h-3.5 text-[#999999] shrink-0" />
              <input
                ref={toolsSearchRef}
                className="flex-1 bg-transparent text-[13px] text-[#1A1A1A] placeholder-[#999999] outline-none"
                placeholder={t("tools.searchPlaceholder")}
                value={toolsSearch}
                onChange={(e) => setToolsSearch(e.target.value)}
              />
              {toolsSearch && (
                <button onClick={() => setToolsSearch("")} className="text-[#999999] hover:text-[#666666]">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 工具列表 */}
          <div className="flex-1 overflow-y-auto pb-2 scrollbar-auto">
            {filteredSections.map((section) => (
              <div key={section.title}>
                <div className="px-4 pt-4 pb-1.5 text-[11px] font-semibold text-[#999999] uppercase tracking-wider">
                  {section.title}
                </div>
                {section.items.map((item) => (
                  <button
                    key={`${item.label}-${item.desc}`}
                    className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-[#FAFAFA] transition-colors group text-left"
                    onClick={() => { item.action?.(); }}
                  >
                    <div className="w-8 h-8 rounded-lg bg-[#F5F5F5] group-hover:bg-[#ECEEF0] flex items-center justify-center shrink-0 transition-colors text-[#666666]">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-[#1A1A1A] leading-tight">{item.label}</div>
                      {item.desc && (
                        <div className="text-[11px] text-[#999999] mt-0.5 truncate">{item.desc}</div>
                      )}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-[#CCCCCC] group-hover:text-[#999999] shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            ))}
            {filteredSections.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Search className="w-6 h-6 text-[#CCCCCC]" />
                <p className="text-[13px] text-[#999999]">No results for "{toolsSearch}"</p>
              </div>
            )}
          </div>

          {/* 底部关闭 */}
          <div className="border-t border-[#F5F5F5] px-4 py-2.5 shrink-0 flex items-center justify-between">
            <span className="text-[11px] text-[#999999]">{TOOLS_SECTIONS.reduce((n, s) => n + s.items.length, 0)} tools available</span>
            <button
              className="flex items-center gap-1.5 text-[12px] text-[#999999] hover:text-[#666666] transition-colors"
              onClick={() => setToolsPanelOpenState(false)}
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── History 视图（右内容区版本历史） ── */}
      {activePreviewTabState === "history" && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: "var(--panel-right-bg)" }}>
          <CheckpointPanel />
        </div>
      )}

      {/* ── Plan Preview 视图（任务计划详情全页展示） ── */}
      {activePreviewTabState === "plan-preview" && planPreviewData && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: "var(--panel-right-bg)" }}>
          {/* 标题栏 */}
          <div className="px-5 py-3 border-b shrink-0 flex items-center gap-2" style={{ borderColor: "var(--panel-divider)" }}>
            <span className="font-mono text-[13px] font-semibold text-foreground flex-1 min-w-0 truncate">
              {planPreviewData.summary ?? t("navbar.planPreviewTab") ?? "任务计划"}
            </span>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              onClick={() => setPlanPreview(false)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-[13px] text-foreground/80 leading-relaxed">
            {planPreviewData.overview && (
              <div>
                <p className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5">Overview</p>
                <p className="leading-relaxed">{planPreviewData.overview}</p>
              </div>
            )}
            {planPreviewData.steps.length > 0 && (
              <div>
                <p className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">Steps</p>
                <div className="space-y-3">
                  {planPreviewData.steps.map((step, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="font-mono text-[11px] text-muted-foreground/50 shrink-0 mt-0.5 w-5 text-right">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        {step.title && (
                          <p className="font-medium text-foreground/90 mb-0.5">{step.title}</p>
                        )}
                        {step.description && (
                          <p className="text-[12px] text-muted-foreground/70 leading-relaxed">{step.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Files 视图（右内容区文件树） ── */}
      {activeTab === "files" && activePreviewTabState !== "history" && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: "var(--panel-right-bg)" }}>
          <div className="flex items-center justify-between px-3 h-[38px] shrink-0 border-b" style={{ borderColor: "var(--panel-divider)" }}>
            <span className="text-[12px] font-medium text-foreground">{t("tools.files")}</span>
            <button
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-accent/20 text-muted-foreground transition-colors"
              onClick={() => setActiveTab("preview")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <FileTree />
          </div>
        </div>
      )}

      {/* ── New File 视图（右内容区新建文件） ── */}
      {activeTab === "newfile" && activePreviewTabState !== "history" && (
        <NewFilePanel
          onCreated={() => setActiveTab("files")}
          onCancel={() => setActiveTab("preview")}
        />
      )}

      {/* ── Canvas 预览内容 ── */}
      {/* Kept in DOM to avoid iframe reload on tab switch; hidden via display:none */}
      <div
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
        style={{ display: (!toolsPanelOpenState && activeTab !== "files" && activeTab !== "newfile" && activePreviewTabState === "preview") ? "flex" : "none" }}
      >
          {/* 预览内容区 — 左侧可选 View 面板 + 右侧预览 */}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {/* 预览主区 */}
            <div className={cn("flex-1 min-w-0 min-h-0 overflow-hidden", devicePlatform === "ios" ? "flex items-center justify-center" : "flex items-stretch")} style={{ background: "var(--panel-right-bg)" }}>
              {devicePlatform === "ios" ? (
                <div className="relative overflow-hidden flex-shrink-0" style={{ width: 375, maxWidth: "100%", aspectRatio: "375 / 812", maxHeight: "100%", borderRadius: 12, background: "#ffffff", boxShadow: "0 0 0 1px rgba(0,0,0,0.1), 0 8px 32px rgba(0,0,0,0.12)" }}>
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
                        <iframe ref={iframeRef} key={effectiveRefresh} srcDoc={previewOverrideHtml ?? injectedHtml} className="w-full h-full border-0" style={{ cursor: "pointer" }} title={t("preview.title")} sandbox={PREVIEW_SANDBOX} allow={PREVIEW_ALLOW} data-testid="preview-iframe" />
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="w-full h-full relative" style={{ background: "#ffffff" }}>
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
                        <iframe ref={iframeRef} key={effectiveRefresh} srcDoc={previewOverrideHtml ?? injectedHtml} className="w-full h-full border-0" style={{ cursor: "pointer" }} title={t("preview.title")} sandbox={PREVIEW_SANDBOX} allow={PREVIEW_ALLOW} data-testid="preview-iframe" />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
      </div>
    </div>
  );
}
