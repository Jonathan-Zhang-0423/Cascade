import { useIDEStore, getFileLanguage } from "@/stores/ide-store";
import { GitBranch, AlertTriangle, XCircle, Check, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatusBar() {
  const { activeFile, consoleEntries, isConsoleOpen, toggleConsole } = useIDEStore();

  const language = activeFile ? getFileLanguage(activeFile) : "";
  const fileName = activeFile ? activeFile.split("/").pop() : "";

  const errorCount = consoleEntries.filter((e) => e.level === "error").length;
  const warnCount = consoleEntries.filter((e) => e.level === "warn").length;

  const languageLabel: Record<string, string> = {
    html: "HTML",
    css: "CSS",
    javascript: "JavaScript",
    typescript: "TypeScript",
    json: "JSON",
    markdown: "Markdown",
    python: "Python",
    plaintext: "Plain Text",
  };

  return (
    <div
      className="flex items-center justify-between gap-4 px-3 h-6 bg-primary text-primary-foreground text-[11px] shrink-0 select-none"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1" data-testid="status-branch">
          <GitBranch className="w-3 h-3" />
          <span>main</span>
        </div>

        <div className="flex items-center gap-2">
          {errorCount > 0 ? (
            <span className="flex items-center gap-1" data-testid="status-errors">
              <XCircle className="w-3 h-3" />
              {errorCount}
            </span>
          ) : null}
          {warnCount > 0 ? (
            <span className="flex items-center gap-1" data-testid="status-warnings">
              <AlertTriangle className="w-3 h-3" />
              {warnCount}
            </span>
          ) : null}
          {errorCount === 0 && warnCount === 0 && (
            <span className="flex items-center gap-1" data-testid="status-no-issues">
              <Check className="w-3 h-3" />
              No issues
            </span>
          )}
        </div>

        <button
          className={cn(
            "flex items-center gap-1 cursor-pointer rounded px-1.5 py-0.5 -my-0.5 transition-colors",
            isConsoleOpen
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10"
          )}
          onClick={toggleConsole}
          aria-label="Toggle console"
          data-testid="button-status-toggle-console"
        >
          <Terminal className="w-3 h-3" />
          <span>Console</span>
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {activeFile && (
          <>
            <span data-testid="status-encoding">UTF-8</span>
            <span data-testid="status-indent">Spaces: 2</span>
            <span data-testid="status-language">
              {languageLabel[language] || language}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
