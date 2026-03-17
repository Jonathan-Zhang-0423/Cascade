import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useIDEStore, computeFilesHash } from "@/stores/ide-store";
import type { FileNode, NotebookContent, NotebookFeature } from "@/stores/ide-store";
import { MindMap } from "./mind-map";
import { Button } from "@/components/ui/button";
import { RefreshCw, BookOpen, ChevronDown, ChevronRight, Lightbulb, FileCode, Link2, AlertTriangle, Sparkles, Loader2, Code2, Copy, Check, Wand2 } from "lucide-react";
import { prism } from "@/lib/prism";
import "prismjs/themes/prism-tomorrow.css";

function normalizeLang(lang: string | undefined | null): string {
  if (!lang || typeof lang !== "string") return "javascript";
  const map: Record<string, string> = {
    js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx",
    html: "markup", xml: "markup", svg: "markup", css: "css", json: "json",
    javascript: "javascript", typescript: "typescript", markup: "markup",

    python: "python", py: "python",
    java: "java",
    c: "c",
    cpp: "cpp", "c++": "cpp", cc: "cpp", cxx: "cpp",
    csharp: "csharp", "c#": "csharp", cs: "csharp",
    go: "go", golang: "go",
    rust: "rust", rs: "rust",
    ruby: "ruby", rb: "ruby",
    php: "php",
    swift: "swift",
    kotlin: "kotlin", kt: "kotlin",
    r: "r",
    lua: "lua",
    perl: "perl", pl: "perl",
    bash: "bash", shell: "bash", sh: "bash", zsh: "bash",
    sql: "sql",
    yaml: "yaml", yml: "yaml",
    dart: "dart",
    scala: "scala",
    elixir: "elixir", ex: "elixir",
    graphql: "graphql", gql: "graphql",
    docker: "docker", dockerfile: "docker",
    protobuf: "protobuf", proto: "protobuf",
    scss: "scss", sass: "scss",
    less: "less",
    ini: "ini", cfg: "ini",
    toml: "toml",
    markdown: "markdown", md: "markdown",
  };
  return map[lang.toLowerCase()] || "javascript";
}

function SyntaxHighlightedCode({ code, language }: { code?: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const safeCode = (typeof code === "string" ? code : "").trim();
  const lang = normalizeLang(language);
  const grammar = prism.languages[lang] || prism.languages.javascript;

  let html: string;
  try {
    html = grammar ? prism.highlight(safeCode, grammar, lang) : safeCode;
  } catch {
    html = safeCode.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  const handleCopy = useCallback(() => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(safeCode);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [safeCode]);

  return (
    <div className="relative group rounded-lg overflow-hidden border border-border/60" data-testid="syntax-block">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800 dark:bg-zinc-900 border-b border-zinc-700/50">
        <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">{language}</span>
        <button
          onClick={handleCopy}
          className="text-zinc-400 hover:text-zinc-200 transition-colors p-0.5"
          data-testid="button-copy-code"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <pre className="p-3 bg-zinc-900 dark:bg-zinc-950 overflow-x-auto text-[13px] leading-relaxed m-0">
        <code
          className={`language-${lang}`}
          dangerouslySetInnerHTML={{ __html: html }}
          style={{ fontFamily: "'Fira Code', 'JetBrains Mono', 'Cascadia Code', monospace" }}
        />
      </pre>
    </div>
  );
}

function FeatureCard({ feature, index }: { feature: NotebookFeature; index: number }) {
  const [isOpen, setIsOpen] = useState(false);

  const hasExplanation = typeof feature.explanation === "string" && feature.explanation.trim().length > 0;
  const validCodeBlocks = Array.isArray(feature.code_blocks)
    ? feature.code_blocks.filter((b) => typeof b.code === "string" && b.code.trim().length > 0)
    : [];
  const hasContent = hasExplanation || validCodeBlocks.length > 0;

  if (!hasContent) {
    return (
      <div
        className="flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-border/50 bg-muted/30"
        data-testid={`feature-card-${index}`}
      >
        <Code2 className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
        <span className="text-sm font-medium text-foreground">{feature.label || "Feature"}</span>
        <span className="text-xs text-muted-foreground italic ml-auto">Details pending</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden" data-testid={`feature-card-${index}`}>
      <button
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted/60 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
        data-testid={`button-feature-${index}`}
      >
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        <Code2 className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
        <span className="text-sm font-medium text-foreground">{feature.label || "Feature"}</span>
      </button>

      {isOpen && (
        <div className="px-3.5 pb-3.5 space-y-3 border-t border-border/30 pt-2.5">
          {hasExplanation && (
            <p className="text-sm text-muted-foreground leading-relaxed">{feature.explanation}</p>
          )}

          {validCodeBlocks.map((block, bi) => (
            <div key={bi} className="space-y-2" data-testid={`code-block-${index}-${bi}`}>
              <SyntaxHighlightedCode code={block.code} language={block.language} />
              {typeof block.walkthrough === "string" && block.walkthrough.trim().length > 0 && (
                <div className="flex gap-2 px-2 py-2 rounded-md bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/40 dark:border-amber-800/30">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">{block.walkthrough}</p>
                </div>
              )}
            </div>
          ))}

          {typeof feature.prompt_tip === "string" && feature.prompt_tip.trim().length > 0 && (
            <div
              className="flex gap-2 px-2.5 py-2.5 rounded-md bg-violet-50/60 dark:bg-violet-950/20 border border-violet-200/40 dark:border-violet-800/30"
              data-testid={`prompt-tip-${index}`}
            >
              <Wand2 className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">{feature.prompt_tip}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const LOADING_MESSAGES = [
  "Reading through your code...",
  "Identifying key concepts...",
  "Mapping connections between files...",
  "Preparing learning tips just for you...",
  "Building your mind map...",
  "Almost ready...",
];

function NotebookLoadingScreen() {
  const [msgIndex, setMsgIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const msgTimer = setInterval(() => {
      setMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 3500);
    return () => clearInterval(msgTimer);
  }, []);

  useEffect(() => {
    const step = 100 / (LOADING_MESSAGES.length * 3.5);
    const progTimer = setInterval(() => {
      setProgress((p) => Math.min(p + step, 92));
    }, 1000);
    return () => clearInterval(progTimer);
  }, []);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 p-8" data-testid="notebook-loading">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
        <BookOpen className="w-8 h-8 text-primary animate-pulse" />
      </div>
      <div className="text-center">
        <h3 className="text-lg font-semibold text-foreground mb-1">
          Generating My Coding Notebook...
        </h3>
        <p className="text-sm text-muted-foreground transition-all duration-500">
          {LOADING_MESSAGES[msgIndex]}
        </p>
      </div>
      <div className="w-64 flex flex-col gap-2">
        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-1000 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground text-center">This usually takes 10–20 seconds</p>
      </div>
    </div>
  );
}

function flattenFiles(files: FileNode[]): { path: string; content: string }[] {
  const result: { path: string; content: string }[] = [];
  for (const f of files) {
    if (f.type === "file" && f.content) {
      result.push({ path: f.path, content: f.content });
    }
    if (f.children) {
      result.push(...flattenFiles(f.children));
    }
  }
  return result;
}

function computeChangedFiles(
  oldFiles: { path: string; content: string }[],
  newFiles: { path: string; content: string }[]
): { path: string; content: string; status: "added" | "modified" | "deleted" }[] {
  const oldMap = new Map(oldFiles.map((f) => [f.path, f.content]));
  const newMap = new Map(newFiles.map((f) => [f.path, f.content]));
  const changes: { path: string; content: string; status: "added" | "modified" | "deleted" }[] = [];

  Array.from(newMap.entries()).forEach(([path, content]) => {
    if (!oldMap.has(path)) {
      changes.push({ path, content, status: "added" });
    } else if (oldMap.get(path) !== content) {
      changes.push({ path, content, status: "modified" });
    }
  });

  Array.from(oldMap.keys()).forEach((path) => {
    if (!newMap.has(path)) {
      changes.push({ path, content: "", status: "deleted" });
    }
  });

  return changes;
}

function applyPatchToNotebook(
  existing: NotebookContent,
  patch: any,
  newHash: string,
  newFiles: { path: string; content: string }[]
): NotebookContent {
  let projectSummary = existing.project_summary;
  if (patch.project_summary) {
    projectSummary = patch.project_summary;
  }

  let breakdowns = [...existing.file_breakdowns];

  if (patch.removed_files?.length) {
    breakdowns = breakdowns.filter((fb) => !patch.removed_files.includes(fb.file || fb.path || ""));
  }

  if (patch.updated_breakdowns?.length) {
    for (const updated of patch.updated_breakdowns) {
      const updatedKey = updated.file || updated.path;
      const idx = breakdowns.findIndex((fb) => (fb.file || fb.path) === updatedKey);
      if (idx >= 0) {
        breakdowns[idx] = updated;
      }
    }
  }

  if (patch.new_breakdowns?.length) {
    breakdowns.push(...patch.new_breakdowns);
  }

  let mindMap = existing.mind_map;
  if (patch.updated_mind_map) {
    const patchBranches = patch.updated_mind_map.branches || [];
    const existingBranches = [...(existing.mind_map?.branches || [])];

    if (patch.removed_files?.length) {
      const filteredBranches = existingBranches.filter(
        (b) => !patch.removed_files.includes(b.file)
      );
      existingBranches.length = 0;
      existingBranches.push(...filteredBranches);
    }

    for (const patchBranch of patchBranches) {
      const idx = existingBranches.findIndex((b) => b.file === patchBranch.file);
      if (idx >= 0) {
        existingBranches[idx] = patchBranch;
      } else {
        existingBranches.push(patchBranch);
      }
    }

    mindMap = {
      central_node: patch.updated_mind_map.central_node || existing.mind_map?.central_node || "",
      branches: existingBranches,
    };
  }

  let learningTips = existing.learning_tips;
  if (patch.learning_tips?.length) {
    learningTips = patch.learning_tips;
  }

  return {
    project_summary: projectSummary,
    file_breakdowns: breakdowns,
    mind_map: mindMap,
    learning_tips: learningTips,
    generatedAt: Date.now(),
    sourceHash: newHash,
    sourceFiles: newFiles,
  };
}

function buildNotebookOutline(notebook: NotebookContent): string {
  const fileList = notebook.file_breakdowns.map((fb) => fb.file || fb.path || fb.name || "").join(", ");
  const conceptTerms = notebook.file_breakdowns
    .flatMap((fb) => fb.key_concepts?.map((c) => c.term) || [])
    .join(", ");
  const tipCount = notebook.learning_tips?.length || 0;
  return `Files: ${fileList}\nConcept terms: ${conceptTerms}\nTip count: ${tipCount}`;
}

export function NotebookPanel() {
  const {
    files,
    notebookContent,
    isNotebookLoading,
    isNotebookOptimizing,
    notebookError,
    setNotebookContent,
    setNotebookLoading,
    setNotebookOptimizing,
    setNotebookError,
  } = useIDEStore();

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const autoPatchTriggeredRef = useRef(false);
  const autoGenerateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentHash = useMemo(() => computeFilesHash(files), [files]);
  const isStale = notebookContent != null && notebookContent.sourceHash !== currentHash;

  const generateNotebook = useCallback(async () => {
    const flatFiles = flattenFiles(files);
    const nonEmpty = flatFiles.filter((f) => f.content.trim().length > 0);
    if (nonEmpty.length === 0) {
      setNotebookError("Your project doesn't have any code yet! Build something first, then come back to learn about it.");
      return;
    }

    const totalContentLength = nonEmpty.reduce((sum, f) => sum + f.content.trim().length, 0);
    const isOnlyBoilerplate =
      nonEmpty.length === 1 &&
      nonEmpty[0].path === "/project/index.html" &&
      totalContentLength < 350;
    if (isOnlyBoilerplate) {
      return;
    }

    const hash = computeFilesHash(files);
    setNotebookLoading(true);
    setNotebookError(null);

    try {
      const res = await fetch("/api/mentor-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: nonEmpty }),
      });

      if (!res.ok) {
        throw new Error("Failed to analyze project");
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }

      const notebook: NotebookContent = {
        ...data.notebook,
        generatedAt: Date.now(),
        sourceHash: hash,
        sourceFiles: nonEmpty,
      };
      setNotebookContent(notebook);
    } catch (err: any) {
      setNotebookError(err.message || "Something went wrong while analyzing your project.");
    } finally {
      setNotebookLoading(false);
    }
  }, [files, setNotebookContent, setNotebookLoading, setNotebookError]);

  const autoPatchNotebook = useCallback(async () => {
    if (!notebookContent || isNotebookLoading || isNotebookOptimizing) return;

    const flatFiles = flattenFiles(files);
    const nonEmpty = flatFiles.filter((f) => f.content.trim().length > 0);
    if (nonEmpty.length === 0) return;

    const oldFiles = notebookContent.sourceFiles || [];

    if (oldFiles.length === 0) {
      generateNotebook();
      return;
    }

    const changedFiles = computeChangedFiles(oldFiles, nonEmpty);
    if (changedFiles.length === 0) return;

    const newHash = computeFilesHash(files);
    setNotebookOptimizing(true);

    try {
      const outline = buildNotebookOutline(notebookContent);

      const affectedSections = notebookContent.file_breakdowns.filter((fb) =>
        changedFiles.some((cf) => cf.path === fb.file || cf.path === fb.path)
      );

      const res = await fetch("/api/mentor-patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changedFiles,
          notebookOutline: outline,
          affectedSections: affectedSections.length > 0 ? affectedSections : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to patch notebook");
      }

      const data = await res.json();
      if (data.error) {
        console.error("Patch error, falling back silently:", data.error);
        setNotebookOptimizing(false);
        return;
      }

      const patched = applyPatchToNotebook(notebookContent, data.patch, newHash, nonEmpty);
      setNotebookContent(patched);
    } catch (err: any) {
      console.error("Auto-patch failed:", err.message);
    } finally {
      setNotebookOptimizing(false);
    }
  }, [files, notebookContent, isNotebookLoading, isNotebookOptimizing, generateNotebook, setNotebookContent, setNotebookOptimizing]);

  const optimizeNotebook = useCallback(async () => {
    if (!notebookContent || isNotebookLoading || isNotebookOptimizing) return;

    const flatFiles = flattenFiles(files);
    const nonEmpty = flatFiles.filter((f) => f.content.trim().length > 0);
    if (nonEmpty.length === 0) return;

    const newHash = computeFilesHash(files);
    setNotebookOptimizing(true);

    try {
      const notebookForApi = {
        project_summary: notebookContent.project_summary,
        file_breakdowns: notebookContent.file_breakdowns,
        mind_map: notebookContent.mind_map,
        learning_tips: notebookContent.learning_tips,
      };

      const res = await fetch("/api/mentor-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebook: notebookForApi,
          files: nonEmpty,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to optimize notebook");
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }

      const optimized: NotebookContent = {
        ...data.notebook,
        generatedAt: Date.now(),
        sourceHash: newHash,
        sourceFiles: nonEmpty,
      };
      setNotebookContent(optimized);
    } catch (err: any) {
      console.error("Optimize failed:", err.message);
    } finally {
      setNotebookOptimizing(false);
    }
  }, [files, notebookContent, isNotebookLoading, isNotebookOptimizing, setNotebookContent, setNotebookOptimizing]);

  useEffect(() => {
    if (isNotebookLoading || notebookContent || notebookError) return;

    if (autoGenerateDebounceRef.current) {
      clearTimeout(autoGenerateDebounceRef.current);
    }
    autoGenerateDebounceRef.current = setTimeout(() => {
      generateNotebook();
    }, 2000);

    return () => {
      if (autoGenerateDebounceRef.current) {
        clearTimeout(autoGenerateDebounceRef.current);
      }
    };
  }, [currentHash, notebookContent, isNotebookLoading, notebookError, generateNotebook]);

  useEffect(() => {
    if (isStale && notebookContent && !isNotebookLoading && !isNotebookOptimizing && !autoPatchTriggeredRef.current) {
      autoPatchTriggeredRef.current = true;
      autoPatchNotebook();
    }
    if (!isStale) {
      autoPatchTriggeredRef.current = false;
    }
  }, [isStale, notebookContent, isNotebookLoading, isNotebookOptimizing, autoPatchNotebook]);

  const toggleFileExpand = (file: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) {
        next.delete(file);
      } else {
        next.add(file);
      }
      return next;
    });
  };

  if (isNotebookLoading) {
    return <NotebookLoadingScreen />;
  }

  if (notebookError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8" data-testid="notebook-error">
        <BookOpen className="w-10 h-10 text-muted-foreground" />
        <div className="text-center max-w-md">
          <h3 className="text-lg font-semibold text-foreground">Oops!</h3>
          <p className="text-sm text-muted-foreground mt-1">{notebookError}</p>
        </div>
        <Button onClick={generateNotebook} variant="outline" size="sm" data-testid="button-retry-notebook">
          <RefreshCw className="w-4 h-4 mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  if (!notebookContent) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8" data-testid="notebook-empty">
        <BookOpen className="w-10 h-10 text-muted-foreground" />
        <div className="text-center">
          <h3 className="text-lg font-semibold text-foreground">My Coding Notebook</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Your personal guide to understanding your code
          </p>
        </div>
        <Button onClick={generateNotebook} size="sm" data-testid="button-generate-notebook">
          <BookOpen className="w-4 h-4 mr-2" />
          Generate Notebook
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="notebook-panel">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground" data-testid="text-notebook-title">
              My Coding Notebook
            </h1>
            <p className="text-xs text-muted-foreground">
              {notebookContent.generatedAt
                ? `Updated ${new Date(notebookContent.generatedAt).toLocaleString()}`
                : "Your learning companion"}
            </p>
          </div>
          <Button
            onClick={optimizeNotebook}
            variant="outline"
            size="sm"
            disabled={isNotebookOptimizing}
            className="gap-1.5"
            data-testid="button-optimize-notebook"
          >
            {isNotebookOptimizing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            优化笔记
          </Button>
        </div>

        {isNotebookOptimizing && (
          <div
            className="flex items-center gap-3 p-3 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20"
            data-testid="notebook-optimizing-banner"
          >
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin shrink-0" />
            <p className="text-sm text-blue-700 dark:text-blue-300 flex-1">
              Updating your notebook with the latest changes...
            </p>
          </div>
        )}

        {isStale && !isNotebookOptimizing && (
          <div
            className="flex items-center gap-3 p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20"
            data-testid="notebook-stale-banner"
          >
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-300 flex-1">
              Your code has changed since this notebook was generated.
            </p>
            <Button
              onClick={autoPatchNotebook}
              variant="outline"
              size="sm"
              disabled={isNotebookOptimizing}
              className="border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              data-testid="button-refresh-stale-notebook"
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              Update
            </Button>
          </div>
        )}

        <section data-testid="notebook-summary">
          <h2 className="text-base font-semibold text-foreground mb-3">项目总览</h2>
          <div className="rounded-xl bg-muted/50 p-5">
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
              {notebookContent.project_summary}
            </p>
          </div>
        </section>

        {notebookContent.mind_map && notebookContent.mind_map.branches?.length > 0 && (
          <section data-testid="notebook-mindmap">
            <h2 className="text-base font-semibold text-foreground mb-3">思维导图</h2>
            <p className="text-xs text-muted-foreground mb-3">
              悬停文件节点查看说明，点击展开功能详情，点击子节点可固定说明
            </p>
            <MindMap data={notebookContent.mind_map} />
          </section>
        )}

        {notebookContent.file_breakdowns?.length > 0 && (
          <section data-testid="notebook-file-breakdowns">
            <h2 className="text-base font-semibold text-foreground mb-3">
              {/[\u4e00-\u9fff]/.test(notebookContent.project_summary || "") ? "深度解析" : "Deep Dive"}
            </h2>
            <div className="space-y-3">
              {notebookContent.file_breakdowns.map((fb) => {
                const fbKey = fb.file || fb.path || fb.name || "";
                const isExpanded = expandedFiles.has(fbKey);
                const fileName = fbKey.split("/").pop() || fbKey;
                const ext = fileName.split(".").pop()?.toLowerCase() || "";

                const extColors: Record<string, string> = {
                  html: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
                  css: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                  js: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
                  ts: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
                  json: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
                };
                const badgeColor = extColors[ext] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";

                return (
                  <div
                    key={fbKey}
                    className="rounded-lg border border-border bg-card overflow-hidden"
                    data-testid={`file-breakdown-${fileName}`}
                  >
                    <button
                      className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => toggleFileExpand(fbKey)}
                      data-testid={`button-expand-${fileName}`}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <FileCode className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="font-medium text-sm text-foreground">{fileName}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>
                        .{ext}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-4 border-t border-border/50 pt-3">
                        <div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {fb.what_it_does || fb.description}
                          </p>
                        </div>

                        {Array.isArray(fb.features) && fb.features.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                              <Code2 className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                              Features
                            </h4>
                            <div className="space-y-2">
                              {fb.features.map((feat, fi) => (
                                <FeatureCard key={fi} feature={feat} index={fi} />
                              ))}
                            </div>
                          </div>
                        )}

                        {fb.key_concepts?.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2">
                              Key Concepts
                            </h4>
                            <div className="space-y-2">
                              {fb.key_concepts.map((concept, ci) => (
                                <div
                                  key={ci}
                                  className="flex gap-2 p-2.5 rounded-md bg-muted/50"
                                  data-testid={`concept-${concept.term}`}
                                >
                                  <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                  <div>
                                    <span className="text-sm font-medium text-foreground">
                                      {concept.term}
                                    </span>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      {concept.explanation}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {fb.connections?.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                              <Link2 className="w-3 h-3" />
                              Connected Files
                            </h4>
                            <div className="flex flex-wrap gap-1.5">
                              {fb.connections.map((conn) => (
                                <span
                                  key={conn}
                                  className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground"
                                >
                                  {conn.split("/").pop()}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {notebookContent.learning_tips?.length > 0 && (
          <section data-testid="notebook-learning-tips">
            <h2 className="text-base font-semibold text-foreground mb-3">Learning Tips</h2>
            <div className="space-y-2">
              {notebookContent.learning_tips.map((tip, i) => (
                <div
                  key={i}
                  className="flex gap-3 p-4 rounded-lg border border-border bg-card"
                  data-testid={`learning-tip-${i}`}
                >
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                    <Lightbulb className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed pt-1">{tip}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="pb-8" />
      </div>
    </div>
  );
}
