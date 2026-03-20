import { useIDEStore } from "@/stores/ide-store";
import { FolderClosed, Sparkles, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

function DockButton({
  icon,
  label,
  isActive,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      className={cn(
        "relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors",
        isActive
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
    >
      {isActive && (
        <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-primary" />
      )}
      {icon}
    </button>
  );
}

export function ToolsDock() {
  const { activeTool, setActiveTool, isConsoleOpen, toggleConsole } = useIDEStore();
  const t = useT();

  return (
    <div
      className="flex flex-col items-center justify-between w-11 py-2 bg-sidebar border-r border-sidebar-border shrink-0"
      data-testid="tools-dock"
    >
      <div className="flex flex-col items-center gap-1">
        <DockButton
          icon={<FolderClosed className="w-[18px] h-[18px]" />}
          label={t("dock.files")}
          isActive={activeTool === "files"}
          onClick={() => setActiveTool("files")}
          testId="dock-files"
        />
        <DockButton
          icon={<Sparkles className="w-[18px] h-[18px]" />}
          label={t("dock.chat")}
          isActive={activeTool === "chat"}
          onClick={() => setActiveTool("chat")}
          testId="dock-chat"
        />
        <DockButton
          icon={<Terminal className="w-[18px] h-[18px]" />}
          label={t("dock.console")}
          isActive={isConsoleOpen}
          onClick={toggleConsole}
          testId="dock-console"
        />
      </div>

      <div className="flex flex-col items-center gap-1">
      </div>
    </div>
  );
}
