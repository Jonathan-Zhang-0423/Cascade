import { useIDEStore } from "@/stores/ide-store";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Terminal,
  Play,
  Code2,
  Sun,
  Moon,
} from "lucide-react";

export function Navbar() {
  const {
    isSidebarOpen,
    toggleSidebar,
    isChatOpen,
    toggleChat,
    isConsoleOpen,
    toggleConsole,
    theme: editorTheme,
    setTheme: setEditorTheme,
  } = useIDEStore();
  const { theme: appTheme, toggleTheme } = useTheme();

  const handleEditorThemeChange = (v: string) => {
    setEditorTheme(v as "vs-dark" | "vs-light" | "hc-black");
  };

  return (
    <header
      className="flex items-center justify-between gap-2 px-3 h-12 border-b border-border/50 bg-background/80 backdrop-blur-sm shrink-0"
      data-testid="navbar"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="icon"
          variant="ghost"
          onClick={toggleSidebar}
          aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
          data-testid="button-toggle-sidebar"
        >
          {isSidebarOpen ? (
            <PanelLeftClose className="w-4 h-4" />
          ) : (
            <PanelLeftOpen className="w-4 h-4" />
          )}
        </Button>

        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <Code2 className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm tracking-tight" data-testid="text-logo">
            CodeStart
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={editorTheme} onValueChange={handleEditorThemeChange}>
          <SelectTrigger className="w-[130px]" data-testid="select-theme">
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
          onClick={toggleTheme}
          aria-label={appTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          data-testid="button-toggle-theme"
        >
          {appTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>

        <Button size="sm" className="gap-1.5" data-testid="button-run">
          <Play className="w-3.5 h-3.5" />
          Run
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={toggleConsole}
          aria-label={isConsoleOpen ? "Hide console" : "Show console"}
          data-testid="button-toggle-console"
        >
          <Terminal className="w-4 h-4" />
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={toggleChat}
          aria-label={isChatOpen ? "Close chat" : "Open chat"}
          data-testid="button-toggle-chat"
        >
          <MessageSquare className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
