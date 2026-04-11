import { cn } from "@/lib/utils";
import { useIDEStore, findFileContent, flattenFiles, type FileNode } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, Rotate3D, Moon, Sun, QrCode, Copy, Check, ExternalLink, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { QRCodeSVG } from "qrcode.react";
import { DeviceSimulator } from "./device-simulator";
import { DEVICE_LIST, getDeviceSpec, getFirstDeviceForPlatform, makeCustomSpec } from "@/lib/device-specs";
import { getPreviewMode, getFrameworkLabel, getFrameworkColor, getMainEntryFile } from "@/lib/preview-adapters";
import { CodePreview } from "./code-preview";
import { WasmPreview } from "./wasm-preview";
import { RnWebPreview } from "./rn-web-preview";
import { FlutterWebPreview } from "./flutter-web-preview";

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

export function PreviewPanel() {
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
        type: '__codestart_console__',
        level: level,
        message: message
      }, '*');
      origConsole[level].apply(console, arguments);
    };
  });

  window.onerror = function(message, source, lineno, colno, error) {
    window.parent.postMessage({
      type: '__codestart_console__',
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
        e.data.type === "__codestart_console__" &&
        iframeRef.current &&
        e.source === iframeRef.current.contentWindow
      ) {
        const level = e.data.level;
        if (["log", "warn", "error", "info"].includes(level)) {
          addConsoleEntry({
            level,
            message: String(e.data.message || ""),
          });
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [addConsoleEntry]);

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

  return (
    <div className="h-full flex flex-col" data-testid="preview-panel">
      <div className="flex items-center gap-1.5 px-2 h-[38px] border-b border-[rgba(255,255,255,0.07)] bg-[#101018] shrink-0 flex-wrap">
        <span
          className={`text-[11px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${getFrameworkColor(framework)}`}
          data-testid="badge-framework"
        >
          {getFrameworkLabel(framework)}
        </span>

        <div className="flex items-center bg-[#14141e] border border-[rgba(255,255,255,0.07)] rounded-lg p-[3px] gap-[1px]">
          <button
            className={cn(
              "flex items-center justify-center px-2 h-[20px] text-xs rounded-md transition-colors",
              devicePlatform === "ios"
                ? "bg-[rgba(255,255,255,0.08)] text-[#eeeef6]"
                : "text-[#484860] hover:text-[#8888a8]"
            )}
            onClick={() => handlePlatformChange("ios")}
            data-testid="button-platform-ios"
          >
            iOS
          </button>
          <button
            className={cn(
              "flex items-center justify-center px-2 h-[20px] text-xs rounded-md transition-colors",
              devicePlatform === "android"
                ? "bg-[rgba(255,255,255,0.08)] text-[#eeeef6]"
                : "text-[#484860] hover:text-[#8888a8]"
            )}
            onClick={() => handlePlatformChange("android")}
            data-testid="button-platform-android"
          >
            Android
          </button>
        </div>

        <Select value={selectedDevice} onValueChange={setSelectedDevice}>
          <SelectTrigger className="w-[140px] h-6 text-xs rounded-md" data-testid="select-device">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {filteredDevices.map((device) => (
              <SelectItem key={device.id} value={device.id} className="text-xs">
                {device.name}
              </SelectItem>
            ))}
            <SelectItem value="custom" className="text-xs">
              Custom
            </SelectItem>
          </SelectContent>
        </Select>

        {isCustom && (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={100}
              max={2000}
              value={customDeviceWidth || 390}
              onChange={(e) =>
                setCustomDeviceDimensions(
                  parseInt(e.target.value) || 390,
                  customDeviceHeight || 844
                )
              }
              className="w-14 h-6 text-xs px-1 text-center"
              data-testid="input-custom-width"
            />
            <span className="text-xs text-[#8888a8]">x</span>
            <Input
              type="number"
              min={100}
              max={2000}
              value={customDeviceHeight || 844}
              onChange={(e) =>
                setCustomDeviceDimensions(
                  customDeviceWidth || 390,
                  parseInt(e.target.value) || 844
                )
              }
              className="w-14 h-6 text-xs px-1 text-center"
              data-testid="input-custom-height"
            />
          </div>
        )}

        <button
          className="h-[26px] w-7 rounded-md bg-[#14141e] border border-[rgba(255,255,255,0.07)] hover:bg-[#1a1a26] hover:text-[#8888a8] transition-colors shrink-0 flex items-center justify-center text-[#484860]"
          onClick={() =>
            setDeviceOrientation(
              deviceOrientation === "portrait" ? "landscape" : "portrait"
            )
          }
          aria-label="Toggle orientation"
          data-testid="button-toggle-orientation"
        >
          <Rotate3D className="w-3 h-3" />
        </button>

        <button
          className="h-[26px] w-7 rounded-md bg-[#14141e] border border-[rgba(255,255,255,0.07)] hover:bg-[#1a1a26] hover:text-[#8888a8] transition-colors shrink-0 flex items-center justify-center text-[#484860]"
          onClick={() =>
            setDeviceFrameStyle(deviceFrameStyle === "dark" ? "light" : "dark")
          }
          aria-label="Toggle frame style"
          data-testid="button-toggle-frame-style"
        >
          {deviceFrameStyle === "dark" ? (
            <Moon className="w-3 h-3" />
          ) : (
            <Sun className="w-3 h-3" />
          )}
        </button>

        <div className="flex-1" />

        <Popover>
          <PopoverTrigger asChild>
            <button
              className="h-[26px] w-7 rounded-md bg-[#14141e] border border-[rgba(255,255,255,0.07)] hover:bg-[#1a1a26] hover:text-[#8888a8] transition-colors shrink-0 flex items-center justify-center text-[#484860]"
              onClick={handleQrOpen}
              aria-label="QR Preview"
              data-testid="button-qr-preview"
            >
              <QrCode className="w-3 h-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-64 p-4"
            align="end"
            data-testid="popover-qr-preview"
          >
            <div className="flex flex-col items-center gap-3">
              <p className="text-xs font-medium text-foreground">Scan to preview on phone</p>
              {qrLoading ? (
                <div className="w-[180px] h-[180px] flex items-center justify-center bg-[rgba(255,255,255,0.04)] rounded-md">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#8888a8]" />
                </div>
              ) : previewUrl ? (
                <div className="bg-white p-3 rounded-lg" data-testid="qr-code-container">
                  <QRCodeSVG
                    value={previewUrl}
                    size={156}
                    level="M"
                    includeMargin={false}
                  />
                </div>
              ) : (
                <div className="w-[180px] h-[180px] flex items-center justify-center bg-[rgba(255,255,255,0.04)] rounded-md">
                  <p className="text-xs text-[#8888a8] text-center px-4">
                    Click to generate preview URL
                  </p>
                </div>
              )}
              {previewUrl && (
                <div className="w-full flex flex-col gap-2">
                  <div className="flex items-center gap-1 w-full">
                    <div className="flex-1 text-[10px] font-mono text-[#8888a8] truncate bg-[rgba(255,255,255,0.04)] rounded px-2 py-1" data-testid="text-preview-url">
                      {previewUrl}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={handleCopyUrl}
                      data-testid="button-copy-preview-url"
                    >
                      {copied ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={() => window.open(previewUrl, "_blank")}
                      data-testid="button-open-preview-url"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  </div>
                  <p className="text-[10px] text-[#8888a8] text-center">
                    Live reload enabled — changes sync automatically
                  </p>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <button
          className="h-[26px] w-7 rounded-md bg-[#14141e] border border-[rgba(255,255,255,0.07)] hover:bg-[#1a1a26] hover:text-[#8888a8] transition-colors shrink-0 flex items-center justify-center text-[#484860]"
          onClick={handleRefresh}
          aria-label={t("preview.refresh")}
          data-testid="button-refresh-preview"
        >
          <RefreshCw className="w-3 h-3" />
        </button>

        <button
          className={cn(
            "h-[26px] w-7 rounded-md border transition-colors shrink-0 flex items-center justify-center",
            isConsoleOpen
              ? "bg-[rgba(79,130,255,0.10)] border-[rgba(79,130,255,0.20)] text-[#4f82ff]"
              : "bg-[#14141e] border-[rgba(255,255,255,0.07)] hover:bg-[#1a1a26] text-[#484860] hover:text-[#8888a8]"
          )}
          onClick={toggleConsole}
          title={isConsoleOpen ? "Hide terminal" : "Show terminal"}
          data-testid="button-toggle-console"
        >
          <Terminal className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <DeviceSimulator
          deviceSpec={deviceSpec}
          orientation={deviceOrientation}
          frameStyle={deviceFrameStyle}
          platformOverride={devicePlatform}
        >
          {previewMode === "kotlin-wasm" || previewMode === "swift-wasm" ? (
            <WasmPreview
              files={files}
              framework={framework}
              projectId={projectId}
              refreshKey={effectiveRefresh}
            />
          ) : previewMode === "code-preview" ? (
            <CodePreview
              files={files}
              framework={framework}
              projectId={projectId}
              mainEntryFile={getMainEntryFile(framework)}
            />
          ) : previewMode === "rn-web" ? (
            <RnWebPreview
              files={files}
              framework={framework}
              projectId={projectId}
              refreshKey={effectiveRefresh}
              projectName={currentProject?.name}
            />
          ) : previewMode === "flutter-web" ? (
            <FlutterWebPreview
              files={files}
              framework={framework}
              projectId={projectId}
              refreshKey={effectiveRefresh}
            />
          ) : (
            <>
              {!previewOverrideHtml && !previewFile && previewMode === "iframe-preview" ? (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#080810]"
                  style={{ animation: "fade-up 150ms ease" }}
                >
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-[#484860]">
                    <rect x="4" y="4" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M11 10l7 4-7 4V10z" fill="currentColor" />
                  </svg>
                  <p className="text-[12px] text-[#484860]">Run your project to see the preview</p>
                </div>
              ) : (
                <iframe
                  ref={iframeRef}
                  key={effectiveRefresh}
                  srcDoc={previewOverrideHtml ?? injectedHtml}
                  className="w-full h-full border-0"
                  style={{ cursor: "pointer" }}
                  title={t("preview.title")}
                  sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups"
                  data-testid="preview-iframe"
                />
              )}
            </>
          )}
        </DeviceSimulator>
      </div>
    </div>
  );
}
