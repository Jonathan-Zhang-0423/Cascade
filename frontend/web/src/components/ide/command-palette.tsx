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
import { useT } from "@/lib/i18n";

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
  const t = useT();

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
      <CommandInput placeholder={t("cmd.placeholder")} data-testid="input-command-palette" />
      <CommandList>
        <CommandEmpty>{t("cmd.noResults")}</CommandEmpty>

        <CommandGroup heading={t("cmd.groupFiles")}>
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

        <CommandGroup heading={t("cmd.groupView")}>
          <CommandItem
            onSelect={() => runCommand(() => setActiveTool("files"))}
            data-testid="cmd-toggle-sidebar"
          >
            <FolderClosed className="w-4 h-4" />
            <span>{activeTool === "files" ? t("cmd.hideFiles") : t("cmd.showFiles")}</span>
            <CommandShortcut>Ctrl+B</CommandShortcut>
          </CommandItem>

          <CommandItem
            onSelect={() => runCommand(() => setActiveTool("chat"))}
            data-testid="cmd-toggle-chat"
          >
            <Sparkles className="w-4 h-4" />
            <span>{activeTool === "chat" ? t("cmd.hideChat") : t("cmd.showChat")}</span>
          </CommandItem>

          <CommandItem
            onSelect={() => runCommand(toggleConsole)}
            data-testid="cmd-toggle-console"
          >
            <Terminal className="w-4 h-4" />
            <span>{isConsoleOpen ? t("cmd.hideConsole") : t("cmd.showConsole")}</span>
            <CommandShortcut>Ctrl+J</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("cmd.groupTheme")}>
          {THEME_LIST.map((th) => (
            <CommandItem
              key={th.id}
              onSelect={() => runCommand(() => handleSetTheme(th.id))}
              data-testid={`cmd-theme-${th.id}`}
            >
              <Palette className="w-4 h-4" />
              <span>{th.label}</span>
              {themeId === th.id && <CommandShortcut>{t("cmd.activeTheme")}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
