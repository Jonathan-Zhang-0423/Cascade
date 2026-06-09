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
import { RefreshCw, ChevronLeft, Loader2 } from "lucide-react";
import { THEME_LIST, type ThemeId } from "@/lib/themes";
import { getProjectEmoji } from "@/lib/project-emoji";
import { getMainEntryFile } from "@/lib/preview-adapters";
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
    : currentProject.framework === "wechat" ? "WeChat Mini Program"
    : currentProject.framework === "web" ? "Web"
    : currentProject.framework
    : "";

  const handleThemeChange = (v: string) => {
    setThemeId(v as ThemeId);
  };

  const handleBack = () => {
    saveProject();
    navigate("/app");
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
    if (framework === "rn-expo" || framework === "flutter" || framework === "kotlin" || framework === "swiftui" || framework === "wechat") {
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
          ? t("navbar.cssHint")
          : ["json", "yaml", "yml", "toml", "ini", "cfg"].includes(ext)
          ? t("navbar.dataFileHint")
          : t("navbar.noRunHint");
      addConsoleEntry({ level: "warn", message: t("navbar.cannotRun", { ext, hint }) });
      return;
    }

    // Get file content from the tree
    const content = findFileContent(files, activeFile);
    if (content === undefined) return;

    setIsRunning(true);
    if (!isConsoleOpen) toggleConsole();
    clearConsole();
    addConsoleEntry({ level: "info", message: t("navbar.running", { file: activeFile }) });

    try {
      const resp = await fetch("/api/run-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, extension: ext }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        addConsoleEntry({ level: "error", message: t("navbar.serverError", { status: String(resp.status), msg: err.error ?? "Unknown error" }) });
        return;
      }

      const data = await resp.json();

      if (data.cannotRun) {
        addConsoleEntry({ level: "warn", message: t("navbar.cannotRunDirect", { ext }) });
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
        addConsoleEntry({ level: "warn", message: t("navbar.timedOut") });
      } else {
        addConsoleEntry({
          level: data.exitCode === 0 ? "info" : "warn",
          message: t("navbar.exitCode", { code: String(data.exitCode) }),
        });
      }
    } catch (err: any) {
      addConsoleEntry({ level: "error", message: t("navbar.failedToRun", { msg: err.message }) });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <header
      className="flex items-center justify-between gap-2 px-4 h-12 border-b border-[#EBEBEB] bg-white shrink-0"
      data-testid="navbar"
    >
      {/* Left — Logo + 分割线 + 项目名 */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {/* 公司 Logo：竖线组合 + "Cascade AI"，全部纯黑 */}
        <div className="flex items-center gap-2 shrink-0 cursor-pointer" onClick={handleBack}>
          <div className="flex items-end gap-[2px] h-[18px]">
            <span className="block w-[3px] rounded-[2px] bg-[#1A1A1A]" style={{ height: 9 }} />
            <span className="block w-[3px] rounded-[2px] bg-[#1A1A1A]" style={{ height: 14 }} />
            <span className="block w-[3px] rounded-[2px] bg-[#1A1A1A]" style={{ height: 18 }} />
            <span className="block w-[3px] rounded-[2px] bg-[#1A1A1A]" style={{ height: 12 }} />
            <span className="block w-[3px] rounded-[2px] bg-[#1A1A1A]" style={{ height: 7 }} />
          </div>
          <span className="text-[14px] font-bold text-[#1A1A1A] tracking-[-0.2px] leading-none">
            Cascade AI
          </span>
        </div>

        {/* 分割线 */}
        <div className="w-px h-[18px] bg-[#EBEBEB] shrink-0" />

        {/* 项目名 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-[22px] h-[22px] rounded-md flex items-center justify-center shrink-0 text-sm leading-none select-none bg-[#F5F5F5] border border-[#EBEBEB]" data-testid="emoji-project">
            {getProjectEmoji(projectName)}
          </div>
          <span className="text-[14px] font-medium text-[#1A1A1A] truncate" data-testid="text-project-name">
            {projectName}
          </span>
          {frameworkLabel && (
            <>
              <span className="text-[#CCCCCC] shrink-0">·</span>
              <span className="text-[11px] text-[#999999] shrink-0">{frameworkLabel}</span>
            </>
          )}
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2 flex-1 justify-end">
        <Select value={themeId} onValueChange={handleThemeChange}>
          <SelectTrigger className="w-auto h-[26px] text-[11px] px-2 min-w-[80px] bg-white border-[#EBEBEB] text-[#666666] rounded-md" data-testid="select-theme">
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
          className="gap-1.5 h-[27px] bg-[#22C55E] hover:bg-[#16A34A] text-white disabled:opacity-60 transition-colors font-medium"
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
