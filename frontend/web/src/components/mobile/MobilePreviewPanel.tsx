import { useRef, useMemo, useEffect } from "react";
import { useIDEStore, findFileContent, flattenFiles } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { getPreviewMode, getMainEntryFile } from "@/lib/preview-adapters";
import { RnWebPreview } from "@/components/ide/rn-web-preview";
import { WasmPreview } from "@/components/ide/wasm-preview";
import { FlutterWebPreview } from "@/components/ide/flutter-web-preview";
import { WeChatPreview } from "@/components/ide/wechat-preview";
import { CodePreview } from "@/components/ide/code-preview";

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
    if (part === ".." && normalized.length > 1) normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function isExternalUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//");
}

function inlineExternalFiles(html: string, files: ReturnType<typeof flattenFiles>, entryPath = "/project/index.html"): string {
  let result = html;
  result = result.replace(
    /<link\s+([^>]*?)(?:rel=["']stylesheet["'][^>]*?href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*?rel=["']stylesheet["'])[^>]*\/?>/gi,
    (match, _attrs, href1, href2) => {
      const href = href1 || href2;
      if (!href || isExternalUrl(href)) return match;
      const filePath = resolveFilePath(href, entryPath);
      const content = findFileContent(files as Parameters<typeof findFileContent>[0], filePath);
      if (content !== undefined) return `<style>/* ${href} */\n${content}\n</style>`;
      return match;
    }
  );
  result = result.replace(
    /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (match, src) => {
      if (isExternalUrl(src)) return match;
      const filePath = resolveFilePath(src, entryPath);
      const content = findFileContent(files as Parameters<typeof findFileContent>[0], filePath);
      if (content !== undefined) return `<script>/* ${src} */\n${content}\n</script>`;
      return match;
    }
  );
  return result;
}

export function MobilePreviewPanel() {
  const {
    files,
    previewFile,
    previewRefreshKey,
    previewOverrideHtml,
    projectFramework,
    projectId,
    addConsoleEntry,
  } = useIDEStore();
  const { projects } = useProjectStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const currentProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId]
  );
  const framework = projectFramework || currentProject?.framework || "web";
  const previewMode = getPreviewMode(framework);

  const htmlContent = useMemo(
    () => findFileContent(files, previewFile) || "",
    [files, previewFile, previewRefreshKey]
  );

  const injectedHtml = useMemo(() => {
    const consoleInterceptor = `<script>
(function() {
  const orig = {};
  ['log','warn','error','info'].forEach(function(l) {
    orig[l] = console[l];
    console[l] = function() {
      var msg = Array.prototype.slice.call(arguments).map(function(a) {
        if (typeof a === 'object') { try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); } }
        return String(a);
      }).join(' ');
      window.parent.postMessage({ type: '__cascade_console__', level: l, message: msg }, '*');
      orig[l].apply(console, arguments);
    };
  });
  window.onerror = function(msg, _s, line) {
    window.parent.postMessage({ type: '__cascade_console__', level: 'error', message: msg + (line ? ' (line ' + line + ')' : '') }, '*');
  };
})();
</script>`;
    const flat = flattenFiles(files);
    const resolved = inlineExternalFiles(htmlContent, flat, previewFile);
    if (resolved.includes('<head>')) return resolved.replace('<head>', '<head>' + consoleInterceptor);
    return consoleInterceptor + resolved;
  }, [htmlContent, files, previewFile]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (
        e.data?.type === "__cascade_console__" &&
        iframeRef.current &&
        e.source === iframeRef.current.contentWindow
      ) {
        const level = e.data.level as string;
        const message = String(e.data.message || "");
        if (["log", "warn", "error", "info"].includes(level)) {
          addConsoleEntry({ level: level as "log" | "warn" | "error" | "info", message });
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [addConsoleEntry]);

  const isEmpty = !previewOverrideHtml && !previewFile && previewMode === "iframe-preview";

  return (
    <div className="w-full h-full overflow-hidden relative bg-black">
      {previewMode === "kotlin-wasm" || previewMode === "swift-wasm" ? (
        <WasmPreview files={files} framework={framework} projectId={projectId} refreshKey={previewRefreshKey} />
      ) : previewMode === "code-preview" ? (
        <CodePreview files={files} framework={framework} projectId={projectId} mainEntryFile={getMainEntryFile(framework)} />
      ) : previewMode === "rn-web" ? (
        <RnWebPreview files={files} framework={framework} projectId={projectId} refreshKey={previewRefreshKey} projectName={currentProject?.name} />
      ) : previewMode === "flutter-web" ? (
        <FlutterWebPreview files={files} framework={framework} projectId={projectId} refreshKey={previewRefreshKey} />
      ) : previewMode === "wechat-preview" ? (
        <WeChatPreview files={files} refreshKey={previewRefreshKey} projectId={projectId} />
      ) : isEmpty ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-slate-500">
            <rect x="4" y="4" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 10l7 4-7 4V10z" fill="currentColor" />
          </svg>
          <p className="text-[12px] text-slate-500">Run the app to see a preview</p>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          key={previewRefreshKey}
          srcDoc={previewOverrideHtml ?? injectedHtml}
          className="w-full h-full border-0"
          title="Preview"
          sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups"
          data-testid="preview-iframe"
        />
      )}
    </div>
  );
}
