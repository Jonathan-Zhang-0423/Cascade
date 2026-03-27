import { useIDEStore, findFileContent, type FileNode } from "@/stores/ide-store";
import { useMemo, useState, useEffect, useRef } from "react";
import { RefreshCw, Smartphone, Rotate3D, Moon, Sun } from "lucide-react";
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
            <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
              <path d="M8.4 6.3c0-1.5 1.2-2.2 1.3-2.3-.7-1-1.8-1.2-2.2-1.2-1-.1-1.9.6-2.4.6s-1.2-.5-2-.5C1.8 2.9.5 4.1.5 6.4c0 1.4.5 2.8 1.2 3.8.7 1 1.5 2 2.5 2 1 0 1.4-.7 2.6-.7s1.6.7 2.6.6c1.1 0 1.8-.9 2.4-1.9C12.5 9 12.8 7.8 12.8 7.7 12.8 7.7 10.9 7 8.4 6.3zM7.5 2.5c.6-.7 1-1.7.9-2.5-.9 0-2 .6-2.6 1.3-.5.6-1 1.6-.9 2.5C5.9 3.8 6.9 3.2 7.5 2.5z" transform="scale(0.77) translate(-0.5, 0)" />
            </svg>
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48C13.85 1.23 12.95 1 12 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31C6.97 3.26 6 5.01 6 7h12c0-1.99-.97-3.75-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z" transform="scale(0.5) translate(0, 0)" />
            </svg>
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
