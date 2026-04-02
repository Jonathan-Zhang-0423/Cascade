import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AlertTriangle, Wand2, FileCode, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type FileNode, flattenFiles, useIDEStore } from "@/stores/ide-store";
import { CodePreview } from "./code-preview";
import { getMainEntryFile } from "@/lib/preview-adapters";

interface WasmPreviewProps {
  files: FileNode[];
  framework: string;
  projectId: string | null;
  refreshKey: number;
}

interface CompileState {
  status: "idle" | "compiling" | "success" | "error" | "unavailable";
  buildId?: string;
  errors?: string[];
}

type CompileTarget = "kotlin" | "swift";

function getCompileTarget(framework: string): CompileTarget {
  if (framework === "swiftui") return "swift";
  return "kotlin";
}

function getCompileEndpoint(target: CompileTarget): string {
  if (target === "swift") return "/api/compile/swift-wasm";
  return "/api/compile/kotlin-wasm";
}

function getFileExtension(target: CompileTarget): string {
  if (target === "swift") return ".swift";
  return ".kt";
}

function getLanguageLabel(target: CompileTarget): string {
  if (target === "swift") return "SwiftUI";
  return "Compose";
}

function getProjectSourceFiles(
  files: FileNode[],
  target: CompileTarget
): Array<{ path: string; content: string }> {
  const ext = getFileExtension(target);
  return flattenFiles(files)
    .filter(
      (f) =>
        f.content !== undefined &&
        f.path.startsWith("/project/") &&
        f.path.endsWith(ext)
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

const accentStyles = {
  kotlin: {
    buttonClass: "border-purple-500/50 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300",
    iconBgClass: "bg-purple-500/15",
    progressClass: "bg-purple-500",
    emoji: "🔨",
  },
  swift: {
    buttonClass: "border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20 text-orange-300",
    iconBgClass: "bg-orange-500/15",
    progressClass: "bg-orange-500",
    emoji: "🍎",
  },
} as const;

export function WasmPreview({
  files,
  framework,
  projectId,
  refreshKey,
}: WasmPreviewProps) {
  const [compileState, setCompileState] = useState<CompileState>({
    status: "idle",
  });
  const [showFallback, setShowFallback] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHashRef = useRef<string>("");
  const compileVersionRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const setPendingPrompt = useIDEStore((s) => s.setPendingPrompt);

  const compileTarget = useMemo(() => getCompileTarget(framework), [framework]);
  const sourceFiles = useMemo(() => getProjectSourceFiles(files, compileTarget), [files, compileTarget]);
  const currentHash = useMemo(() => hashFiles(sourceFiles), [sourceFiles]);
  const langLabel = getLanguageLabel(compileTarget);
  const styles = accentStyles[compileTarget];

  const triggerCompile = useCallback(async () => {
    if (sourceFiles.length === 0) {
      setCompileState({ status: "idle" });
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const abortController = new AbortController();
    abortRef.current = abortController;
    const thisVersion = ++compileVersionRef.current;

    setCompileState({ status: "compiling" });

    try {
      const endpoint = getCompileEndpoint(compileTarget);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: sourceFiles }),
        signal: abortController.signal,
      });

      if (thisVersion !== compileVersionRef.current) return;

      const data = await res.json();

      if (thisVersion !== compileVersionRef.current) return;

      if (!res.ok) {
        if (res.status === 503) {
          setCompileState({ status: "unavailable" });
        } else {
          setCompileState({
            status: "error",
            errors: data.errors || [data.error || "Compilation failed"],
          });
        }
        return;
      }

      if (data.success) {
        setCompileState({ status: "success", buildId: data.buildId });
        setShowFallback(false);
      } else {
        setCompileState({
          status: "error",
          buildId: data.buildId,
          errors: data.errors || ["Unknown compilation error"],
        });
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      if (thisVersion !== compileVersionRef.current) return;
      setCompileState({
        status: "error",
        errors: [err?.message || "Network error during compilation"],
      });
    }
  }, [sourceFiles, compileTarget]);

  useEffect(() => {
    if (currentHash === lastHashRef.current && compileState.status === "success") {
      return;
    }
    lastHashRef.current = currentHash;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      triggerCompile();
    }, 1500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [currentHash, triggerCompile]);

  useEffect(() => {
    if (refreshKey > 0) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
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

  const handleAskAiFix = useCallback(() => {
    if (!compileState.errors || compileState.errors.length === 0) return;
    const errorText = compileState.errors.join("\n");
    const langName = compileTarget === "swift" ? "SwiftUI" : "Kotlin/Compose";
    const prompt = `The ${langName} code has compilation errors. Please fix these errors:\n\n${errorText}`;
    setPendingPrompt(prompt);
  }, [compileState.errors, setPendingPrompt, compileTarget]);

  if (showFallback || compileState.status === "unavailable") {
    return (
      <div className="flex flex-col h-full" data-testid="wasm-preview-fallback">
        {compileState.status === "unavailable" && (
          <div className="px-3 py-2 bg-yellow-500/10 border-b border-yellow-500/30 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
            <span className="text-xs text-yellow-400">
              {langLabel} Wasm compiler not available. Showing code preview.
            </span>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <CodePreview
            files={files}
            framework={framework}
            projectId={projectId}
            mainEntryFile={getMainEntryFile(framework)}
          />
        </div>
      </div>
    );
  }

  if (compileState.status === "error") {
    return (
      <div
        className="flex flex-col h-full bg-[#1e1e1e] text-gray-200"
        data-testid="wasm-preview-error"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#333] bg-[#252526]">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-xs text-red-400 font-medium">
            Compilation Failed
          </span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            className={`h-7 text-xs gap-1.5 ${styles.buttonClass}`}
            onClick={handleAskAiFix}
            data-testid="button-ask-ai-fix"
          >
            <Wand2 className="w-3 h-3" />
            Ask AI to Fix
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-gray-400 hover:text-gray-200"
            onClick={() => setShowFallback(true)}
            data-testid="button-show-code-fallback"
          >
            <FileCode className="w-3 h-3 mr-1" />
            View Code
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4" data-testid="compile-errors">
          <div className="space-y-2">
            {compileState.errors?.map((error, i) => (
              <div
                key={i}
                className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20"
              >
                <ChevronRight className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                <pre className="text-xs text-red-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
                  {error}
                </pre>
              </div>
            ))}
          </div>
        </div>

        <div className="px-3 py-2 border-t border-[#333] bg-[#252526]">
          <p className="text-[10px] text-gray-500 text-center">
            Click "Ask AI to Fix" to let the AI agent debug these errors
            automatically
          </p>
        </div>
      </div>
    );
  }

  if (compileState.status === "success" && compileState.buildId) {
    const iframeSrc = `/api/compile/artifacts/${compileState.buildId}/index.html`;
    return (
      <div className="flex flex-col h-full" data-testid="wasm-preview-live">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#333] bg-[#252526]">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[10px] text-green-400 font-medium">
            Live {langLabel} Preview
          </span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] text-gray-400 hover:text-gray-200"
            onClick={() => setShowFallback(true)}
            data-testid="button-switch-to-code"
          >
            <FileCode className="w-3 h-3 mr-1" />
            Code
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <iframe
            key={`wasm-${compileState.buildId}`}
            src={iframeSrc}
            className="w-full h-full border-0"
            title={`${langLabel} WASM Preview`}
            sandbox="allow-scripts allow-same-origin"
            data-testid="preview-wasm-iframe"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full bg-[#1e1e1e] items-center justify-center"
      data-testid="wasm-preview-idle"
    >
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <div className={`w-10 h-10 rounded-xl ${styles.iconBgClass} flex items-center justify-center`}>
          <span className="text-lg">{styles.emoji}</span>
        </div>
        <p className="text-sm text-gray-300 font-medium">
          Preparing {langLabel} Preview
        </p>
        <p className="text-xs text-gray-500 max-w-[240px]">
          {compileState.status === "compiling"
            ? `Compiling ${langLabel} to WebAssembly...`
            : `Waiting for ${getFileExtension(compileTarget)} source files...`}
        </p>
        {compileState.status === "compiling" && (
          <div className="w-32 h-1 bg-[#333] rounded-full overflow-hidden mt-2">
            <div className={`h-full ${styles.progressClass} rounded-full animate-pulse w-2/3`} />
          </div>
        )}
      </div>
    </div>
  );
}
