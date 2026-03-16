import { useState, useEffect, useCallback, useMemo } from "react";
import { useIDEStore, computeFilesHash } from "@/stores/ide-store";
import type { FileNode, NotebookContent } from "@/stores/ide-store";
import { MindMap } from "./mind-map";
import { Button } from "@/components/ui/button";
import { RefreshCw, BookOpen, ChevronDown, ChevronRight, Lightbulb, FileCode, Link2, Loader2, AlertTriangle } from "lucide-react";

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

export function NotebookPanel() {
  const {
    files,
    notebookContent,
    isNotebookLoading,
    notebookError,
    setNotebookContent,
    setNotebookLoading,
    setNotebookError,
  } = useIDEStore();

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const currentHash = useMemo(() => computeFilesHash(files), [files]);
  const isStale = notebookContent != null && notebookContent.sourceHash !== currentHash;

  const generateNotebook = useCallback(async () => {
    const flatFiles = flattenFiles(files);
    const nonEmpty = flatFiles.filter((f) => f.content.trim().length > 0);
    if (nonEmpty.length === 0) {
      setNotebookError("Your project doesn't have any code yet! Build something first, then come back to learn about it.");
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
      };
      setNotebookContent(notebook);
    } catch (err: any) {
      setNotebookError(err.message || "Something went wrong while analyzing your project.");
    } finally {
      setNotebookLoading(false);
    }
  }, [files, setNotebookContent, setNotebookLoading, setNotebookError]);

  useEffect(() => {
    if (!notebookContent && !isNotebookLoading && !notebookError) {
      generateNotebook();
    }
  }, [notebookContent, isNotebookLoading, notebookError, generateNotebook]);

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
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8" data-testid="notebook-loading">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
        <div className="text-center">
          <h3 className="text-lg font-semibold text-foreground">Your mentor is reading your code...</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Preparing your personalized Coding Notebook
          </p>
        </div>
      </div>
    );
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground" data-testid="text-notebook-title">
                My Coding Notebook
              </h1>
              <p className="text-xs text-muted-foreground">
                {notebookContent.generatedAt
                  ? `Updated ${new Date(notebookContent.generatedAt).toLocaleString()}`
                  : "Your learning companion"}
              </p>
            </div>
          </div>
          <Button
            onClick={generateNotebook}
            variant="outline"
            size="sm"
            disabled={isNotebookLoading}
            data-testid="button-refresh-notebook"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isNotebookLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {isStale && (
          <div
            className="flex items-center gap-3 p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20"
            data-testid="notebook-stale-banner"
          >
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-300 flex-1">
              Your code has changed since this notebook was generated.
            </p>
            <Button
              onClick={generateNotebook}
              variant="outline"
              size="sm"
              disabled={isNotebookLoading}
              className="border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              data-testid="button-refresh-stale-notebook"
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isNotebookLoading ? "animate-spin" : ""}`} />
              Update
            </Button>
          </div>
        )}

        <section
          className="rounded-xl border border-border bg-card p-5"
          data-testid="notebook-summary"
        >
          <h2 className="text-base font-semibold text-foreground mb-2">Project Overview</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {notebookContent.project_summary}
          </p>
        </section>

        {notebookContent.mind_map && notebookContent.mind_map.branches?.length > 0 && (
          <section
            className="rounded-xl border border-border bg-card p-5"
            data-testid="notebook-mindmap"
          >
            <h2 className="text-base font-semibold text-foreground mb-4">Project Mind Map</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Click on any concept node to see its explanation
            </p>
            <MindMap data={notebookContent.mind_map} />
          </section>
        )}

        {notebookContent.file_breakdowns?.length > 0 && (
          <section data-testid="notebook-file-breakdowns">
            <h2 className="text-base font-semibold text-foreground mb-3">File Breakdowns</h2>
            <div className="space-y-3">
              {notebookContent.file_breakdowns.map((fb) => {
                const isExpanded = expandedFiles.has(fb.file);
                const fileName = fb.file.split("/").pop() || fb.file;
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
                    key={fb.file}
                    className="rounded-lg border border-border bg-card overflow-hidden"
                    data-testid={`file-breakdown-${fileName}`}
                  >
                    <button
                      className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => toggleFileExpand(fb.file)}
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
                            {fb.what_it_does}
                          </p>
                        </div>

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
