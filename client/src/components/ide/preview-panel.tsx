import { useIDEStore, findFileContent, type FileNode } from "@/stores/ide-store";
import { useMemo, useState, useEffect, useRef } from "react";
import { Globe, RefreshCw, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

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
  const { files, addConsoleEntry, clearConsole, previewFile, previewRefreshKey } = useIDEStore();
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const t = useT();

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
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border/50 shrink-0">
        <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <div className="flex-1 flex items-center gap-1.5 h-6 px-2.5 rounded-md bg-muted/40 border border-border/30 text-[11px] text-muted-foreground truncate">
          <Lock className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">localhost:3000/{previewFile.replace("/project/", "")}</span>
        </div>
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
      <div className="flex-1 min-h-0 bg-white">
        <iframe
          ref={iframeRef}
          key={effectiveRefresh}
          srcDoc={injectedHtml}
          className="w-full h-full border-0"
          title={t("preview.title")}
          sandbox="allow-scripts allow-modals allow-same-origin"
          data-testid="preview-iframe"
        />
      </div>
    </div>
  );
}
