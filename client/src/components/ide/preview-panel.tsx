import { useIDEStore, findFileContent, type FileNode } from "@/stores/ide-store";
import { useMemo, useState, useEffect, useRef } from "react";
import { RefreshCw, Smartphone, Rotate3D, Moon, Sun } from "lucide-react";
import androidLogoPath from "@assets/android-logo-android-icon-free-free-vector_1775015520620.jpg";
import appleLogoPath from "@assets/logo-apple-3_1775015525544.png";
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
import { DeviceSimulator } from "./device-simulator";
import { DEVICE_LIST, getDeviceSpec, makeCustomSpec } from "@/lib/device-specs";

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
  } = useIDEStore();
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const t = useT();

  const isCustom = selectedDevice === "custom";
  const deviceSpec = isCustom
    ? makeCustomSpec(customDeviceWidth || 390, customDeviceHeight || 844, devicePlatform)
    : getDeviceSpec(selectedDevice);

  const effectiveRefresh = refreshKey + previewRefreshKey;

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

  return (
    <div className="h-full flex flex-col" data-testid="preview-panel">
      <div className="flex items-center gap-1.5 px-2 h-9 border-b border-border/50 shrink-0 flex-wrap">
        <Smartphone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

        <Select value={selectedDevice} onValueChange={setSelectedDevice}>
          <SelectTrigger className="w-[120px] h-6 text-xs rounded-md" data-testid="select-device">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {DEVICE_LIST.map((device) => (
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
            <span className="text-xs text-muted-foreground">x</span>
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

        <div className="flex items-center border rounded-md overflow-hidden h-6 shrink-0">
          <button
            className={`px-1.5 h-full flex items-center justify-center text-xs transition-colors ${
              devicePlatform === "ios"
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setDevicePlatform("ios")}
            data-testid="button-platform-ios"
          >
            <img src={appleLogoPath} alt="iOS" className="w-3 h-3" />
          </button>
          <div className="w-px h-4 bg-border" />
          <button
            className={`px-1.5 h-full flex items-center justify-center text-xs transition-colors ${
              devicePlatform === "android"
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setDevicePlatform("android")}
            data-testid="button-platform-android"
          >
            <img src={androidLogoPath} alt="Android" className="w-3 h-3" />
          </button>
        </div>

        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={() =>
            setDeviceOrientation(
              deviceOrientation === "portrait" ? "landscape" : "portrait"
            )
          }
          aria-label="Toggle orientation"
          data-testid="button-toggle-orientation"
        >
          <Rotate3D className="w-3 h-3" />
        </Button>

        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
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
        </Button>

        <div className="flex-1" />

        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          onClick={handleRefresh}
          aria-label={t("preview.refresh")}
          data-testid="button-refresh-preview"
        >
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        <DeviceSimulator
          deviceSpec={deviceSpec}
          orientation={deviceOrientation}
          frameStyle={deviceFrameStyle}
          platformOverride={devicePlatform}
        >
          <iframe
            ref={iframeRef}
            key={effectiveRefresh}
            srcDoc={injectedHtml}
            className="w-full h-full border-0"
            style={{ cursor: "pointer" }}
            title={t("preview.title")}
            sandbox="allow-scripts allow-modals allow-same-origin"
            data-testid="preview-iframe"
          />
        </DeviceSimulator>
      </div>
    </div>
  );
}
