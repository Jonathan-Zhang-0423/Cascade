import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AlertTriangle, Wand2, FileCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type FileNode, flattenFiles, useIDEStore } from "@/stores/ide-store";
import { CodePreview } from "./code-preview";
import { getMainEntryFile } from "@/lib/preview-adapters";
import { useT } from "@/lib/i18n";

interface WeChatPreviewProps {
  files: FileNode[];
  refreshKey: number;
  projectId?: string | null;
}

interface CompileState {
  status: "idle" | "compiling" | "success" | "error";
  buildId?: string;
  errors?: string[];
}

function getSourceFiles(files: FileNode[]): Array<{ path: string; content: string }> {
  return flattenFiles(files)
    .filter(
      (f) =>
        f.content !== undefined &&
        f.path.startsWith("/project/") &&
        /\.(wxml|wxss|js|json)$/.test(f.path)
    )
    .map((f) => ({ path: f.path, content: f.content || "" }));
}

function hashFiles(files: Array<{ path: string; content: string }>): string {
  let h = "";
  for (const f of files.sort((a, b) => a.path.localeCompare(b.path))) {
    h += f.path + "|" + f.content + "\n";
  }
  return h;
}

export function WeChatPreview({ files, refreshKey, projectId }: WeChatPreviewProps) {
  const t = useT();
  const [compileState, setCompileState] = useState<CompileState>({ status: "idle" });
  const [showFallback, setShowFallback] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHashRef = useRef<string>("");
  const compileVersionRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const setPendingPrompt = useIDEStore((s) => s.setPendingPrompt);

  const sourceFiles = useMemo(() => getSourceFiles(files), [files]);
  const currentHash = useMemo(() => hashFiles(sourceFiles), [sourceFiles]);

  const triggerCompile = useCallback(async () => {
    if (sourceFiles.length === 0) {
      setCompileState({ status: "idle" });
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    const thisVersion = ++compileVersionRef.current;

    setCompileState({ status: "compiling" });

    try {
      const res = await fetch("/api/compile/wechat-web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: sourceFiles, projectId: projectId ?? undefined }),
        signal: abortController.signal,
      });

      if (thisVersion !== compileVersionRef.current) return;

      const text = await res.text();
      if (thisVersion !== compileVersionRef.current) return;

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setCompileState({ status: "error", errors: [`Server error (${res.status}): unexpected response`] });
        return;
      }

      const data = JSON.parse(text);

      if (!res.ok) {
        setCompileState({ status: "error", errors: data.errors || [data.error || "Compilation failed"] });
        return;
      }

      if (data.success) {
        setCompileState({ status: "success", buildId: data.buildId });
        setShowFallback(false);
      } else {
        setCompileState({ status: "error", errors: data.errors || ["Unknown error"] });
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      if (thisVersion !== compileVersionRef.current) return;
      setCompileState({ status: "error", errors: [err?.message || "Network error"] });
    }
  }, [sourceFiles]);

  // Debounced recompile on file change (800ms — esbuild is fast but WXML parse adds overhead)
  useEffect(() => {
    if (currentHash === lastHashRef.current && compileState.status === "success") return;
    lastHashRef.current = currentHash;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { triggerCompile(); }, 800);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [currentHash, triggerCompile]);

  // Manual refresh — debounced so rapid agent-driven code_applied events
  // during a build coalesce into a single compile instead of thrashing the
  // 2-slot server concurrency limit.
  useEffect(() => {
    if (refreshKey > 0) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      lastHashRef.current = "";
      debounceRef.current = setTimeout(() => { triggerCompile(); }, 800);
    }
  }, [refreshKey]);

  // Force recompile on mount — server restarts clear the artifact cache
  useEffect(() => {
    lastHashRef.current = "";
  }, []);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleAskAiFix = useCallback(() => {
    if (!compileState.errors?.length) return;
    const prompt = `The WeChat Mini Program code has errors. Please fix:\n\n${compileState.errors.join("\n")}`;
    setPendingPrompt(prompt);
  }, [compileState.errors, setPendingPrompt]);

  if (showFallback) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <CodePreview
            files={files}
            framework="wechat"
            projectId={projectId ?? null}
            mainEntryFile={getMainEntryFile("wechat")}
          />
        </div>
      </div>
    );
  }

  if (compileState.status === "error") {
    return (
      <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-200">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#333] bg-[#252526]">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-xs text-red-400 font-medium">{t("wechat.buildFailed")}</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5 border-[#07c160]/50 bg-[#07c160]/10 hover:bg-[#07c160]/20 text-[#07c160]"
            onClick={handleAskAiFix}
          >
            <Wand2 className="w-3 h-3" />
            {t("wechat.askAiFix")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-gray-400 hover:text-gray-200"
            onClick={() => setShowFallback(true)}
          >
            <FileCode className="w-3 h-3 mr-1" />
            {t("wechat.viewCode")}
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <div className="space-y-2">
            {compileState.errors?.map((error, i) => (
              <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <pre className="text-xs text-red-300 whitespace-pre-wrap break-words font-mono leading-relaxed">{error}</pre>
              </div>
            ))}
          </div>
        </div>
        <div className="px-3 py-2 border-t border-[#333] bg-[#252526]">
          <p className="text-[10px] text-gray-500 text-center">
            {t("wechat.disclaimer")}
          </p>
        </div>
      </div>
    );
  }

  if (compileState.status === "success" && compileState.buildId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#333] bg-[#252526]">
          <div className="w-2 h-2 rounded-full bg-[#07c160] animate-pulse" />
          <span className="text-[10px] text-[#07c160] font-medium">{t("wechat.livePreview")}</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] text-gray-400 hover:text-gray-200"
            onClick={() => setShowFallback(true)}
          >
            <FileCode className="w-3 h-3 mr-1" />
            {t("wechat.code")}
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <iframe
            key={`wx-${compileState.buildId}`}
            src={`/api/compile/artifacts/${compileState.buildId}/index.html`}
            className="w-full h-full border-0"
            title="WeChat Mini Program Preview"
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
          />
        </div>
      </div>
    );
  }

  // idle or compiling
  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <div className="w-10 h-10 rounded-xl bg-[#07c160]/15 flex items-center justify-center">
          <span className="text-lg">💬</span>
        </div>
        <p className="text-sm text-gray-300 font-medium">
          {compileState.status === "compiling" ? t("wechat.buildingPreview") : t("wechat.preparingPreview")}
        </p>
        <p className="text-xs text-gray-500 max-w-[240px]">
          {compileState.status === "compiling"
            ? t("wechat.compilingWxml")
            : t("wechat.waitingFiles")}
        </p>
        {compileState.status === "compiling" && (
          <div className="w-32 h-1 bg-[#333] rounded-full overflow-hidden mt-2">
            <div className="h-full bg-[#07c160] rounded-full animate-pulse w-2/3" />
          </div>
        )}
      </div>
    </div>
  );
}
