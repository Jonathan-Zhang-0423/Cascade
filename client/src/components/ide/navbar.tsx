import { useIDEStore } from "@/stores/ide-store";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Code2 } from "lucide-react";

export function Navbar() {
  const {
    theme: editorTheme,
    setTheme: setEditorTheme,
  } = useIDEStore();

  const handleEditorThemeChange = (v: string) => {
    setEditorTheme(v as "vs-dark" | "vs-light" | "hc-black");
  };

  return (
    <header
      className="flex items-center justify-between gap-2 px-3 h-10 border-b border-border/50 bg-sidebar shrink-0"
      data-testid="navbar"
    >
      <div className="flex items-center gap-2.5">
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
          My First App
        </span>
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

        <Button size="sm" className="gap-1.5 h-7 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="button-run">
          <Play className="w-3 h-3 fill-current" />
          Run
        </Button>
      </div>
    </header>
  );
}
