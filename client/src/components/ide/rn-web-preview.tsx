import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AlertTriangle, Wand2, FileCode, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type FileNode, flattenFiles, useIDEStore } from "@/stores/ide-store";
import { CodePreview } from "./code-preview";
import { getMainEntryFile } from "@/lib/preview-adapters";

interface RnWebPreviewProps {
  files: FileNode[];
  framework: string;
  projectId: string | null;
  refreshKey: number;
  projectName?: string;
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
        /\.(tsx?|jsx?)$/.test(f.path)
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

export function RnWebPreview({ files, framework, projectId, refreshKey, projectName }: RnWebPreviewProps) {
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
      const res = await fetch("/api/compile/rn-web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: sourceFiles, name: projectName }),
        signal: abortController.signal,
      });

      if (thisVersion !== compileVersionRef.current) return;

      const text = await res.text();
      if (thisVersion !== compileVersionRef.current) return;

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setCompileState({ status: "error", errors: [`Server error (${res.status}): unexpected response — check server logs`] });
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
  }, [sourceFiles, projectName]);

  // Debounced recompile on file change (500ms — Babel is fast)
  useEffect(() => {
    if (currentHash === lastHashRef.current && compileState.status === "success") return;
    lastHashRef.current = currentHash;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { triggerCompile(); }, 500);

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
    };
  }, []);

  // Listen for runtime errors postMessaged from the preview iframe
  useEffect(() => {
    if (compileState.status !== "success") return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "__rn_runtime_error__") {
        setCompileState({ status: "error", errors: [e.data.message || "Runtime error"] });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [compileState.status]);

  // On mount, always recompile once — server restarts clear the artifact cache
  // but lastHashRef persists in React state, causing a stale artifact to be shown.
  useEffect(() => {
    lastHashRef.current = "";
  }, []);

  const handleAskAiFix = useCallback(() => {
    if (!compileState.errors?.length) return;
    const prompt = `The React Native code has errors. Please fix:\n\n${compileState.errors.join("\n")}`;
    setPendingPrompt(prompt);
  }, [compileState.errors, setPendingPrompt]);

  if (showFallback) {
    return (
      <div className="flex flex-col h-full" data-testid="rn-preview-fallback">
        <div className="flex-1 min-h-0">
          <CodePreview files={files} framework={framework} projectId={projectId} mainEntryFile={getMainEntryFile(framework)} />
        </div>
      </div>
    );
  }

  if (compileState.status === "error") {
    return (
      <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-200" data-testid="rn-preview-error">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#333] bg-[#252526]">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-xs text-red-400 font-medium">Build Failed</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5 border-cyan-500/50 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300"
            onClick={handleAskAiFix}
            data-testid="button-ask-ai-fix-rn"
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
        <div className="flex-1 overflow-auto p-4" data-testid="rn-compile-errors">
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
            Note: react-native-web supports core RN APIs. Native-only modules may not be available.
          </p>
        </div>
      </div>
    );
  }

  if (compileState.status === "success" && compileState.buildId) {
    return (
      <div className="flex flex-col h-full" data-testid="rn-preview-live">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#333] bg-[#252526]">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[10px] text-green-400 font-medium">Live React Native Preview</span>
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
            key={`rn-${compileState.buildId}`}
            src={`/api/compile/artifacts/${compileState.buildId}/index.html`}
            className="w-full h-full border-0"
            title="React Native Preview"
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            data-testid="preview-rn-iframe"
          />
        </div>
      </div>
    );
  }

  // idle or compiling
  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] items-center justify-center" data-testid="rn-preview-idle">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center">
          <span className="text-lg">📱</span>
        </div>
        <p className="text-sm text-gray-300 font-medium">
          {compileState.status === "compiling" ? "Building Preview..." : "Preparing React Native Preview"}
        </p>
        <p className="text-xs text-gray-500 max-w-[240px]">
          {compileState.status === "compiling"
            ? "Transforming React Native code for browser..."
            : "Waiting for .tsx / .js source files..."}
        </p>
        {compileState.status === "compiling" && (
          <div className="w-32 h-1 bg-[#333] rounded-full overflow-hidden mt-2">
            <div className="h-full bg-cyan-500 rounded-full animate-pulse w-2/3" />
          </div>
        )}
      </div>
    </div>
  );
}
