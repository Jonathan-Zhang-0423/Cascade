import { useEffect, useState } from "react";
import { useIDEStore, flattenFiles } from "@/stores/ide-store";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";
import {
  FolderClosed,
  Sparkles,
  Terminal,
  FileText,
  Palette,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { THEME_LIST, type ThemeId } from "@/lib/themes";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const {
    setActiveTool,
    toggleConsole,
    activeTool,
    isConsoleOpen,
    files,
    setActiveFile,
  } = useIDEStore();
  const { themeId, setThemeId } = useTheme();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "p" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const allFiles = flattenFiles(files);

  const runCommand = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const handleSetTheme = (id: ThemeId) => {
    setThemeId(id);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." data-testid="input-command-palette" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Files">
          {allFiles.map((file) => (
            <CommandItem
              key={file.path}
              onSelect={() => runCommand(() => setActiveFile(file.path))}
              data-testid={`cmd-file-${file.name}`}
            >
              <FileText className="w-4 h-4" />
              <span>{file.name}</span>
              <CommandShortcut>{file.path}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="View">
          <CommandItem
            onSelect={() => runCommand(() => setActiveTool("files"))}
            data-testid="cmd-toggle-sidebar"
          >
            <FolderClosed className="w-4 h-4" />
            <span>{activeTool === "files" ? "Hide" : "Show"} Files Panel</span>
            <CommandShortcut>Ctrl+B</CommandShortcut>
          </CommandItem>

          <CommandItem
            onSelect={() => runCommand(() => setActiveTool("chat"))}
            data-testid="cmd-toggle-chat"
          >
            <Sparkles className="w-4 h-4" />
            <span>{activeTool === "chat" ? "Hide" : "Show"} AI Chat</span>
          </CommandItem>

          <CommandItem
            onSelect={() => runCommand(toggleConsole)}
            data-testid="cmd-toggle-console"
          >
            <Terminal className="w-4 h-4" />
            <span>{isConsoleOpen ? "Hide" : "Show"} Console</span>
            <CommandShortcut>Ctrl+J</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Theme">
          {THEME_LIST.map((t) => (
            <CommandItem
              key={t.id}
              onSelect={() => runCommand(() => handleSetTheme(t.id))}
              data-testid={`cmd-theme-${t.id}`}
            >
              <Palette className="w-4 h-4" />
              <span>{t.label}</span>
              {themeId === t.id && <CommandShortcut>Active</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
