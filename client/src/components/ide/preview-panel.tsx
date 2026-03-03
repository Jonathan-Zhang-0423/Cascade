import { useIDEStore, findFileContent } from "@/stores/ide-store";
import { useMemo, useState, useEffect, useRef } from "react";
import { Globe, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PreviewPanel() {
  const { files, addConsoleEntry, clearConsole } = useIDEStore();
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const htmlContent = useMemo(() => {
    return findFileContent(files, "/project/index.html") || "";
  }, [files, refreshKey]);

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

    if (htmlContent.includes('<head>')) {
      return htmlContent.replace('<head>', '<head>' + consoleInterceptor);
    }
    return consoleInterceptor + htmlContent;
  }, [htmlContent]);

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
    <div className="h-full flex flex-col bg-background" data-testid="preview-panel">
      <div className="flex items-center justify-between gap-2 px-3 h-10 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Preview
          </span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleRefresh}
          aria-label="Refresh preview"
          data-testid="button-refresh-preview"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 bg-white">
        <iframe
          ref={iframeRef}
          key={refreshKey}
          srcDoc={injectedHtml}
          className="w-full h-full border-0"
          title="Preview"
          sandbox="allow-scripts allow-modals"
          data-testid="preview-iframe"
        />
      </div>
    </div>
  );
}
