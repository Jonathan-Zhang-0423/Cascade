import { useState } from "react";
import { useIDEStore, type FileNode } from "@/stores/ide-store";
import { useTheme } from "@/components/theme-provider";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, ChevronLeft, Loader2 } from "lucide-react";
import { THEME_LIST, type ThemeId } from "@/lib/themes";
import { getProjectEmoji } from "@/lib/project-emoji";
import { LangToggle } from "@/components/lang-toggle";
import { useT } from "@/lib/i18n";

interface NavbarProps {
  projectName: string;
}

function findFileContent(nodes: FileNode[], targetPath: string): string | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node.content ?? "";
    if (node.children) {
      const found = findFileContent(node.children, targetPath);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const NON_RUNNABLE_EXTENSIONS = new Set([
  "html", "css", "scss", "sass", "less", "svg",
  "json", "yaml", "yml", "toml", "ini", "cfg",
  "xml", "md", "markdown", "sql", "graphql", "proto",
  "dockerfile", "vue", "svelte",
  "h", "hpp", "hxx",
]);

export function Navbar({ projectName }: NavbarProps) {
  const {
    activeFile,
    setPreviewFile,
    files,
    saveProject,
    addConsoleEntry,
    clearConsole,
    isConsoleOpen,
    toggleConsole,
  } = useIDEStore();
  const { themeId, setThemeId } = useTheme();
  const [, navigate] = useLocation();
  const t = useT();
  const [isRunning, setIsRunning] = useState(false);

  const handleThemeChange = (v: string) => {
    setThemeId(v as ThemeId);
  };

  const handleBack = () => {
    saveProject();
    navigate("/");
  };

  const handleRun = async () => {
    if (isRunning) return;

    if (!activeFile) return;

    const ext = activeFile.split(".").pop()?.toLowerCase() ?? "";

    // HTML → open in preview as before
    if (ext === "html") {
      setPreviewFile(activeFile);
      return;
    }

    // Non-runnable file types → show message
    if (NON_RUNNABLE_EXTENSIONS.has(ext)) {
      if (!isConsoleOpen) toggleConsole();
      clearConsole();
      const hint =
        ["css", "scss", "sass", "less"].includes(ext)
          ? "Stylesheet files are used by HTML pages — open the HTML file to see the result."
          : ["json", "yaml", "yml", "toml", "ini", "cfg"].includes(ext)
          ? "This is a data or configuration file and cannot be run directly."
          : "This file type cannot be executed.";
      addConsoleEntry({ level: "warn", message: `Cannot run .${ext} files. ${hint}` });
      return;
    }

    // Get file content from the tree
    const content = findFileContent(files, activeFile);
    if (content === undefined) return;

    setIsRunning(true);
    if (!isConsoleOpen) toggleConsole();
    clearConsole();
    addConsoleEntry({ level: "info", message: `Running ${activeFile}…` });

    try {
      const resp = await fetch("/api/run-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, extension: ext }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        addConsoleEntry({ level: "error", message: `Server error ${resp.status}: ${err.error ?? "Unknown error"}` });
        return;
      }

      const data = await resp.json();

      if (data.cannotRun) {
        addConsoleEntry({ level: "warn", message: `.${ext} files cannot be run directly.` });
        return;
      }

      // Stdout lines
      const stdoutLines = (data.stdout ?? "").split("\n");
      for (const line of stdoutLines) {
        if (line !== "") addConsoleEntry({ level: "log", message: line });
      }

      // Stderr lines
      const stderrLines = (data.stderr ?? "").split("\n");
      for (const line of stderrLines) {
        if (line !== "") addConsoleEntry({ level: "error", message: line });
      }

      // Final status
      if (data.timedOut) {
        addConsoleEntry({ level: "warn", message: "Process timed out after the allowed limit and was stopped." });
      } else {
        addConsoleEntry({
          level: data.exitCode === 0 ? "info" : "warn",
          message: `Exited with code ${data.exitCode}`,
        });
      }
    } catch (err: any) {
      addConsoleEntry({ level: "error", message: `Failed to run: ${err.message}` });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <header
      className="flex items-center justify-between gap-2 px-3 h-10 border-b border-border/50 bg-sidebar shrink-0"
      data-testid="navbar"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 h-7 px-2 shrink-0"
          onClick={handleBack}
          data-testid="button-back"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-sm leading-none select-none bg-[#2a2a2b00]" data-testid="emoji-project">
            {getProjectEmoji(projectName)}
          </div>
          <span className="text-sm font-semibold truncate" data-testid="text-project-name">
            {projectName}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select value={themeId} onValueChange={handleThemeChange}>
          <SelectTrigger className="w-[150px] h-7 text-xs" data-testid="select-theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_LIST.map((th) => (
              <SelectItem key={th.id} value={th.id}>
                {th.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <LangToggle />
        <Button
          size="sm"
          className="gap-1.5 h-7 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
          data-testid="button-run"
          disabled={isRunning}
          onClick={handleRun}
        >
          {isRunning
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <Play className="w-3 h-3 fill-current" />
          }
          {t("navbar.run")}
        </Button>
      </div>
    </header>
  );
}
