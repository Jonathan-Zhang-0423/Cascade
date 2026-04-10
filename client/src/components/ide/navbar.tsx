import { useState } from "react";
import { useIDEStore, type FileNode } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
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
import { RefreshCw, ChevronLeft, Loader2, Monitor, Code2, EyeOff, Eye } from "lucide-react";
import { THEME_LIST, type ThemeId } from "@/lib/themes";
import { getProjectEmoji } from "@/lib/project-emoji";
import { getMainEntryFile } from "@/lib/preview-adapters";
import { LangToggle } from "@/components/lang-toggle";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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

function buildReactPreviewHtml(source: string): string {
  // Detect default export name: `export default function Foo` / `export default class Foo`
  const match = source.match(/export\s+default\s+(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
  const componentName = match?.[1] ?? "App";

  // Strip import statements — Babel standalone handles JSX but not ES module imports
  const stripped = source
    .replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, "")
    .replace(/^import\s+['"][^'"]+['"]\s*;?\s*$/gm, "");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <style>body { margin: 0; font-family: -apple-system, system-ui, sans-serif; }</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
${stripped}
const __root = ReactDOM.createRoot(document.getElementById('root'));
__root.render(React.createElement(${componentName}));
  </script>
</body>
</html>`;
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
    setPreviewOverrideHtml,
    refreshPreview,
    files,
    saveProject,
    addConsoleEntry,
    clearConsole,
    isConsoleOpen,
    toggleConsole,
    projectId,
    layoutMode,
    setLayoutMode,
    codeVisible,
    toggleCodeVisible,
  } = useIDEStore();
  const { projects } = useProjectStore();
  const { themeId, setThemeId } = useTheme();
  const [, navigate] = useLocation();
  const t = useT();
  const [isRunning, setIsRunning] = useState(false);

  const currentProject = projects.find((p) => p.id === projectId);
  const frameworkLabel = currentProject?.framework
    ? currentProject.framework === "rn-expo" ? "React Native"
    : currentProject.framework === "flutter" ? "Flutter"
    : currentProject.framework === "kotlin" ? "Kotlin"
    : currentProject.framework === "swiftui" ? "SwiftUI"
    : currentProject.framework === "web" ? "Web"
    : currentProject.framework
    : "";

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

    const currentProject = projects.find((p) => p.id === projectId);
    const framework = currentProject?.framework || "web";

    // Web projects: always run the HTML entry point in the preview
    if (framework === "web") {
      setPreviewOverrideHtml(null);
      setPreviewFile(getMainEntryFile("web"));
      return;
    }

    // Mobile/other frameworks: refresh the preview (Expo Snack, DartPad, Wasm)
    if (framework === "rn-expo" || framework === "flutter" || framework === "kotlin" || framework === "swiftui") {
      refreshPreview();
      return;
    }

    const ext = activeFile.split(".").pop()?.toLowerCase() ?? "";

    // HTML → open in preview as before
    if (ext === "html") {
      setPreviewFile(activeFile);
      return;
    }

    // JSX/TSX → render in preview iframe using Babel standalone + React CDN
    if (ext === "tsx" || ext === "jsx") {
      const content = findFileContent(files, activeFile);
      if (content === undefined) return;
      const html = buildReactPreviewHtml(content);
      setPreviewOverrideHtml(html);
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
      className="flex items-center justify-between gap-2 px-3 h-11 border-b border-border bg-[#111114] dark:bg-[#111114] shrink-0"
      data-testid="navbar"
    >
      {/* Left */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          className="flex items-center justify-center w-7 h-7 rounded-md bg-muted border border-border text-muted-foreground hover:text-foreground [transition:var(--transition-fast)] shrink-0"
          onClick={handleBack}
          data-testid="button-back"
          aria-label="Back"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-[22px] h-[22px] rounded-md flex items-center justify-center shrink-0 text-sm leading-none select-none bg-muted border border-border" data-testid="emoji-project">
            {getProjectEmoji(projectName)}
          </div>
          <span className="text-sm font-semibold truncate" data-testid="text-project-name">
            {projectName}
          </span>
          {frameworkLabel && (
            <>
              <span className="text-muted-foreground/40 shrink-0">·</span>
              <span className="text-[11px] text-muted-foreground/60 shrink-0">{frameworkLabel}</span>
            </>
          )}
        </div>
      </div>

      {/* Center — layout toggle */}
      <div className="flex items-center rounded-lg border border-border bg-muted p-[3px] gap-[2px]">
        <button
          className={cn(
            "flex items-center gap-1 px-2.5 h-[22px] text-xs rounded-md [transition:var(--transition-fast)]",
            layoutMode === "code"
              ? "bg-muted-foreground/20 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setLayoutMode("code")}
          title="Code layout"
          data-testid="button-layout-code"
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>
        <button
          className={cn(
            "flex items-center gap-1 px-2.5 h-[22px] text-xs rounded-md [transition:var(--transition-fast)]",
            layoutMode === "preview"
              ? "bg-muted-foreground/20 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setLayoutMode("preview")}
          title="Preview layout"
          data-testid="button-layout-preview"
        >
          <Monitor className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2 flex-1 justify-end">
        <button
          className={cn(
            "flex items-center justify-center w-7 h-7 rounded-md border border-border [transition:var(--transition-fast)]",
            !codeVisible
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
          onClick={toggleCodeVisible}
          title={codeVisible ? "Hide code" : "Show code"}
          data-testid="button-toggle-code-visible"
        >
          {codeVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        <Select value={themeId} onValueChange={handleThemeChange}>
          <SelectTrigger className="w-auto h-7 text-xs px-2 min-w-[80px]" data-testid="select-theme">
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
          className="gap-1.5 h-[30px] bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white disabled:opacity-60 shadow-[0_1px_3px_rgba(37,99,235,0.4)]"
          data-testid="button-run"
          disabled={isRunning}
          onClick={handleRun}
        >
          {isRunning
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <RefreshCw className="w-3 h-3" />
          }
          {t("navbar.refresh")}
        </Button>
      </div>
    </header>
  );
}
