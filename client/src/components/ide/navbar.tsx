import { useMemo } from "react";
import { useIDEStore, computeFilesHash } from "@/stores/ide-store";
import type { ActiveSpace } from "@/stores/ide-store";
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
import { Play, Code2, Sun, Moon, ChevronLeft, BookOpen, Wrench } from "lucide-react";

interface NavbarProps {
  projectName: string;
}

export function Navbar({ projectName }: NavbarProps) {
  const {
    theme: editorTheme,
    setTheme: setEditorTheme,
    activeFile,
    setPreviewFile,
    refreshPreview,
    saveProject,
    activeSpace,
    setActiveSpace,
    files,
    notebookContent,
  } = useIDEStore();
  const { theme, toggleTheme } = useTheme();
  const [, navigate] = useLocation();

  const currentHash = useMemo(() => computeFilesHash(files), [files]);
  const isNotebookStale = notebookContent != null && notebookContent.sourceHash !== currentHash;

  const handleEditorThemeChange = (v: string) => {
    setEditorTheme(v as "vs-dark" | "vs-light" | "hc-black");
  };

  const handleBack = () => {
    saveProject();
    navigate("/");
  };

  return (
    <header
      className="flex items-center justify-between gap-2 px-3 h-10 border-b border-border/50 bg-sidebar shrink-0"
      data-testid="navbar"
    >
      <div className="flex items-center gap-2.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={handleBack}
          aria-label="Back to dashboard"
          data-testid="button-back-dashboard"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
            <Code2 className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-foreground" data-testid="text-logo">
            CodeStart
          </span>
        </div>
        <span className="text-muted-foreground/40 text-sm">/</span>
        <span className="text-sm text-muted-foreground" data-testid="text-project-name">
          {projectName}
        </span>
      </div>

      <div className="flex items-center bg-muted rounded-lg p-0.5" data-testid="space-toggle">
        <button
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            activeSpace === "workspace"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveSpace("workspace")}
          data-testid="button-workspace"
        >
          <Wrench className="w-3 h-3" />
          Workspace
        </button>
        <button
          className={`relative flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            activeSpace === "learner"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveSpace("learner")}
          data-testid="button-learner-space"
        >
          <BookOpen className="w-3 h-3" />
          My Coding Notebook
          {isNotebookStale && activeSpace !== "learner" && (
            <span
              className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500"
              data-testid="notebook-stale-dot"
              title="Notebook is outdated"
            />
          )}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Select value={editorTheme} onValueChange={handleEditorThemeChange}>
          <SelectTrigger className="w-[110px] h-7 text-xs" data-testid="select-theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vs-dark">Dark+</SelectItem>
            <SelectItem value="vs-light">Light+</SelectItem>
            <SelectItem value="hc-black">High Contrast</SelectItem>
          </SelectContent>
        </Select>

        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          data-testid="navbar-theme-toggle"
        >
          {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </Button>

        <Button
          size="sm"
          className="gap-1.5 h-7 bg-emerald-600 hover:bg-emerald-700 text-white"
          data-testid="button-run"
          onClick={() => {
            if (activeFile && activeFile.endsWith(".html")) {
              setPreviewFile(activeFile);
            } else {
              refreshPreview();
            }
          }}
        >
          <Play className="w-3 h-3 fill-current" />
          Run
        </Button>
      </div>
    </header>
  );
}
