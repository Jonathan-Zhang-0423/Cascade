import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AlertTriangle, Wand2, FileCode, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type FileNode, flattenFiles, useIDEStore } from "@/stores/ide-store";
import { CodePreview } from "./code-preview";
import { getMainEntryFile } from "@/lib/preview-adapters";

interface FlutterWebPreviewProps {
  files: FileNode[];
  framework: string;
  projectId: string | null;
  refreshKey: number;
}

interface CompileState {
  status: "idle" | "compiling" | "success" | "error" | "unavailable";
  buildId?: string;
  errors?: string[];
  elapsedMs?: number;
}

function getSourceFiles(files: FileNode[]): Array<{ path: string; content: string }> {
  return flattenFiles(files)
    .filter((f) => f.content !== undefined && f.path.startsWith("/project/"))
    .map((f) => ({ path: f.path, content: f.content || "" }));
}

function hashFiles(files: Array<{ path: string; content: string }>): string {
  let h = "";
  for (const f of files.sort((a, b) => a.path.localeCompare(b.path))) {
    h += f.path + "|" + f.content + "\n";
  }
  return h;
}

export function FlutterWebPreview({ files, framework, projectId, refreshKey }: FlutterWebPreviewProps) {
  const [compileState, setCompileState] = useState<CompileState>({ status: "idle" });
  const [showFallback, setShowFallback] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHashRef = useRef<string>("");
  const compileVersionRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setPendingPrompt = useIDEStore((s) => s.setPendingPrompt);

  const sourceFiles = useMemo(() => getSourceFiles(files), [files]);
  const currentHash = useMemo(() => hashFiles(sourceFiles), [sourceFiles]);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
  }, []);

  const triggerCompile = useCallback(async () => {
    if (sourceFiles.length === 0) {
      setCompileState({ status: "idle" });
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    const thisVersion = ++compileVersionRef.current;

    startTimeRef.current = Date.now();
    setCompileState({ status: "compiling", elapsedMs: 0 });

    stopElapsedTimer();
    elapsedIntervalRef.current = setInterval(() => {
      setCompileState((prev) =>
        prev.status === "compiling"
          ? { ...prev, elapsedMs: Date.now() - startTimeRef.current }
          : prev
      );
    }, 1000);

    try {
      const res = await fetch("/api/compile/flutter-web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: sourceFiles }),
        signal: abortController.signal,
      });

      if (thisVersion !== compileVersionRef.current) return;
      stopElapsedTimer();

      const data = await res.json();
      if (thisVersion !== compileVersionRef.current) return;

      if (!res.ok) {
        if (res.status === 503) {
          setCompileState({ status: "unavailable" });
        } else {
          setCompileState({ status: "error", errors: data.errors || [data.error || "Compilation failed"] });
        }
        return;
      }

      if (data.success) {
        setCompileState({ status: "success", buildId: data.buildId });
        setShowFallback(false);
      } else {
        setCompileState({ status: "error", errors: data.errors || ["Unknown error"] });
      }
    } catch (err: any) {
      stopElapsedTimer();
      if (err?.name === "AbortError") return;
      if (thisVersion !== compileVersionRef.current) return;
      setCompileState({ status: "error", errors: [err?.message || "Network error"] });
    }
  }, [sourceFiles, stopElapsedTimer]);

  // Debounced recompile — 3s debounce since Flutter builds are slow
  useEffect(() => {
    if (currentHash === lastHashRef.current && compileState.status === "success") return;
    lastHashRef.current = currentHash;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { triggerCompile(); }, 3000);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [currentHash, triggerCompile]);

  // Manual refresh
  useEffect(() => {
    if (refreshKey > 0) {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      lastHashRef.current = "";
      triggerCompile();
    }
  }, [refreshKey]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      stopElapsedTimer();
    };
  }, [stopElapsedTimer]);

  const handleAskAiFix = useCallback(() => {
    if (!compileState.errors?.length) return;
    const prompt = `The Flutter code has errors. Please fix:\n\n${compileState.errors.join("\n")}`;
    setPendingPrompt(prompt);
  }, [compileState.errors, setPendingPrompt]);

  const formatElapsed = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  if (showFallback || compileState.status === "unavailable") {
    return (
      <div className="flex flex-col h-full" data-testid="flutter-preview-fallback">
        {compileState.status === "unavailable" && (
          <div className="px-3 py-2 bg-yellow-500/10 border-b border-yellow-500/30 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
            <span className="text-xs text-yellow-400">
              Flutter compiler not available. Showing code preview.
            </span>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <CodePreview files={files} framework={framework} projectId={projectId} mainEntryFile={getMainEntryFile(framework)} />
        </div>
      </div>
    );
  }

  if (compileState.status === "error") {
    return (
      <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-200" data-testid="flutter-preview-error">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#333] bg-[#252526]">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-xs text-red-400 font-medium">Build Failed</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5 border-blue-500/50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300"
            onClick={handleAskAiFix}
            data-testid="button-ask-ai-fix-flutter"
          >
            <Wand2 className="w-3 h-3" />
            Ask AI to Fix
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-gray-400 hover:text-gray-200"
            onClick={() => setShowFallback(true)}
          >
            <FileCode className="w-3 h-3 mr-1" />
            View Code
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4" data-testid="flutter-compile-errors">
          <div className="space-y-2">
            {compileState.errors?.map((error, i) => (
              <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <ChevronRight className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                <pre className="text-xs text-red-300 whitespace-pre-wrap break-words font-mono leading-relaxed">{error}</pre>
              </div>
            ))}
          </div>
        </div>
        <div className="px-3 py-2 border-t border-[#333] bg-[#252526]">
          <p className="text-[10px] text-gray-500 text-center">
            Flutter web requires the Flutter SDK to be installed on the server.
          </p>
        </div>
      </div>
    );
  }

  if (compileState.status === "success" && compileState.buildId) {
    return (
      <div className="flex flex-col h-full" data-testid="flutter-preview-live">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#333] bg-[#252526]">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-[10px] text-blue-400 font-medium">Live Flutter Preview</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] text-gray-400 hover:text-gray-200"
            onClick={() => setShowFallback(true)}
          >
            <FileCode className="w-3 h-3 mr-1" />
            Code
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <iframe
            key={`flutter-${compileState.buildId}`}
            src={`/api/compile/artifacts/${compileState.buildId}/index.html`}
            className="w-full h-full border-0"
            title="Flutter Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            data-testid="preview-flutter-iframe"
          />
        </div>
      </div>
    );
  }

  // idle or compiling
  const elapsed = compileState.elapsedMs || 0;
  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] items-center justify-center" data-testid="flutter-preview-idle">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center">
          <span className="text-lg">🐦</span>
        </div>
        <p className="text-sm text-gray-300 font-medium">
          {compileState.status === "compiling" ? "Building Flutter Preview..." : "Preparing Flutter Preview"}
        </p>
        <p className="text-xs text-gray-500 max-w-[260px]">
          {compileState.status === "compiling"
            ? `Running flutter build web... ${elapsed > 0 ? `(${formatElapsed(elapsed)})` : ""}`
            : "Waiting for Dart source files..."}
        </p>
        {compileState.status === "compiling" && (
          <div className="w-32 h-1 bg-[#333] rounded-full overflow-hidden mt-2">
            <div className="h-full bg-blue-500 rounded-full animate-pulse w-2/3" />
          </div>
        )}
        {compileState.status === "compiling" && elapsed > 30_000 && (
          <p className="text-[10px] text-gray-600 max-w-[240px]">
            First build downloads packages — subsequent builds are faster.
          </p>
        )}
      </div>
    </div>
  );
}
