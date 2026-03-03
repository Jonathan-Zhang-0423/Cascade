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
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Terminal,
  Sun,
  Moon,
  FileText,
  Palette,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const {
    toggleSidebar,
    toggleChat,
    toggleConsole,
    isSidebarOpen,
    isChatOpen,
    isConsoleOpen,
    files,
    setActiveFile,
    theme,
    setTheme,
  } = useIDEStore();
  const { theme: appTheme, toggleTheme } = useTheme();

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
            onSelect={() => runCommand(toggleSidebar)}
            data-testid="cmd-toggle-sidebar"
          >
            {isSidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
            <span>{isSidebarOpen ? "Hide" : "Show"} Sidebar</span>
            <CommandShortcut>Ctrl+B</CommandShortcut>
          </CommandItem>

          <CommandItem
            onSelect={() => runCommand(toggleChat)}
            data-testid="cmd-toggle-chat"
          >
            <MessageSquare className="w-4 h-4" />
            <span>{isChatOpen ? "Hide" : "Show"} Chat Panel</span>
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
          <CommandItem
            onSelect={() => runCommand(toggleTheme)}
            data-testid="cmd-toggle-theme"
          >
            {appTheme === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
            <span>Toggle {appTheme === "dark" ? "Light" : "Dark"} Mode</span>
          </CommandItem>

          <CommandItem
            onSelect={() => runCommand(() => setTheme("vs-dark"))}
            data-testid="cmd-theme-dark"
          >
            <Palette className="w-4 h-4" />
            <span>Editor Theme: Dark+</span>
            {theme === "vs-dark" && <CommandShortcut>Active</CommandShortcut>}
          </CommandItem>

          <CommandItem
            onSelect={() => runCommand(() => setTheme("vs-light"))}
            data-testid="cmd-theme-light"
          >
            <Palette className="w-4 h-4" />
            <span>Editor Theme: Light+</span>
            {theme === "vs-light" && <CommandShortcut>Active</CommandShortcut>}
          </CommandItem>

          <CommandItem
            onSelect={() => runCommand(() => setTheme("hc-black"))}
            data-testid="cmd-theme-hc"
          >
            <Palette className="w-4 h-4" />
            <span>Editor Theme: High Contrast</span>
            {theme === "hc-black" && <CommandShortcut>Active</CommandShortcut>}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
