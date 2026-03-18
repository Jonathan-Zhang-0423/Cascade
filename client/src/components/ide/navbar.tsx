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
import { Play, Code2, ChevronLeft, BookOpen, Wrench } from "lucide-react";
import { THEME_LIST, type ThemeId } from "@/lib/themes";

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
  const { setThemeId } = useTheme();
  const [, navigate] = useLocation();

  const currentHash = useMemo(() => computeFilesHash(files), [files]);
  const isNotebookStale = notebookContent != null && notebookContent.sourceHash !== currentHash;

  const handleThemeChange = (v: string) => {
    const id = v as ThemeId;
    setEditorTheme(id);
    setThemeId(id);
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
          <div className="w-5 h-5 rounded bg-primary flex items-center justify-center shrink-0">
            <Code2 className="w-3 h-3 text-primary-foreground" />
          </div>
          <span className="text-sm font-semibold truncate" data-testid="text-project-name">
            {projectName}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          className={`relative inline-flex items-center gap-1.5 px-2.5 h-7 text-xs font-medium rounded-md transition-colors ${
            activeSpace === "workspace"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
          onClick={() => setActiveSpace("workspace")}
          data-testid="button-workspace"
        >
          <Wrench className="w-3 h-3" />
          Workspace
        </button>
        <button
          className={`relative inline-flex items-center gap-1.5 px-2.5 h-7 text-xs font-medium rounded-md transition-colors ${
            activeSpace === "learner"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
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
        <Select value={editorTheme} onValueChange={handleThemeChange}>
          <SelectTrigger className="w-[150px] h-7 text-xs" data-testid="select-theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_LIST.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
