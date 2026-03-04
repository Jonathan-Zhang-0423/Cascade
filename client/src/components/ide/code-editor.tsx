import Editor from "@monaco-editor/react";
import { useIDEStore, findFileContent, getFileLanguage } from "@/stores/ide-store";
import { X, FileCode, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function CodeEditor() {
  const { activeFile, openFiles, files, theme, setActiveFile, closeFile, updateFileContent } =
    useIDEStore();

  const openCommandPalette = () => {
    const event = new KeyboardEvent("keydown", {
      key: "p",
      metaKey: true,
      ctrlKey: true,
      shiftKey: true,
    });
    document.dispatchEvent(event);
  };

  const content = activeFile ? findFileContent(files, activeFile) : "";
  const language = activeFile ? getFileLanguage(activeFile) : "plaintext";

  const getFileName = (path: string) => path.split("/").pop() || path;

  return (
    <div className="h-full flex flex-col bg-background" data-testid="code-editor">
      {openFiles.length > 0 ? (
        <>
          <div
            className="flex items-center border-b border-border/50 bg-card/30 shrink-0 overflow-x-auto"
            role="tablist"
            aria-label="Open files"
          >
            {openFiles.map((filePath) => (
              <div
                key={filePath}
                role="tab"
                aria-selected={filePath === activeFile}
                tabIndex={filePath === activeFile ? 0 : -1}
                className={cn(
                  "group flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer border-r border-border/30 transition-colors min-w-fit",
                  filePath === activeFile
                    ? "bg-background text-foreground border-b-2 border-b-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                )}
                onClick={() => setActiveFile(filePath)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setActiveFile(filePath);
                  }
                }}
                data-testid={`tab-${getFileName(filePath)}`}
              >
                <FileCode className="w-3.5 h-3.5 shrink-0" />
                <span>{getFileName(filePath)}</span>
                <button
                  className="ml-1 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-muted p-0.5 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeFile(filePath);
                  }}
                  aria-label={`Close ${getFileName(filePath)}`}
                  data-testid={`button-close-tab-${getFileName(filePath)}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <div className="flex items-center px-1 border-l border-border/30">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={openCommandPalette}
                aria-label="Open file"
                data-testid="button-open-file-palette"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <Editor
              height="100%"
              language={language}
              value={content || ""}
              theme={theme}
              onChange={(value) => {
                if (activeFile && value !== undefined) {
                  updateFileContent(activeFile, value);
                }
              }}
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontLigatures: true,
                minimap: { enabled: true, scale: 1 },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: "smooth",
                cursorSmoothCaretAnimation: "on",
                renderLineHighlight: "all",
                bracketPairColorization: { enabled: true },
                padding: { top: 12 },
                lineNumbers: "on",
                wordWrap: "on",
                tabSize: 2,
                automaticLayout: true,
              }}
            />
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center" data-testid="editor-empty">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto">
              <FileCode className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">No file open</p>
              <p className="text-xs text-muted-foreground/60">
                Select a file from the explorer to start editing
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
