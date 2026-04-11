import { useIDEStore } from "@/stores/ide-store";
import { useLLMMonitorStore } from "@/stores/llm-monitor-store";
import { FolderClosed, Sparkles, Radio, History } from "lucide-react";
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
        "relative flex items-center justify-center w-10 h-10 rounded-lg",
        "[transition:var(--transition-fast)]",
        isActive
          ? "bg-[#141d34] ring-1 ring-[rgba(79,130,255,0.18)] opacity-100"
          : "opacity-[0.18] hover:opacity-55"
      )}
      style={isActive ? { filter: "drop-shadow(0 0 5px rgba(79,130,255,0.40))" } : undefined}
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
    >
      {icon}
    </button>
  );
}

export function ToolsDock() {
  const { activeTool, setActiveTool } = useIDEStore();
  const isMonitorOpen = useIDEStore((s) => s.isLLMMonitorOpen);
  const toggleMonitor = useIDEStore((s) => s.toggleLLMMonitor);
  const monitorEventCount = useLLMMonitorStore((s) => s.eventCount);
  const t = useT();

  return (
    <div
      className="flex flex-col items-center justify-between w-11 py-2 bg-[#080810] border-r border-[rgba(255,255,255,0.04)] shrink-0"
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
          icon={<History className="w-[18px] h-[18px]" />}
          label={t("dock.history")}
          isActive={activeTool === "history"}
          onClick={() => setActiveTool(activeTool === "history" ? null : "history")}
          testId="dock-history"
        />
      </div>

      <div className="flex flex-col items-center gap-1">
        <button
          className={cn(
            "relative flex items-center justify-center w-10 h-10 rounded-lg [transition:var(--transition-fast)]",
            isMonitorOpen
              ? "bg-[#141d34] ring-1 ring-[rgba(79,130,255,0.18)] opacity-100"
              : "opacity-[0.18] hover:opacity-55"
          )}
          style={isMonitorOpen ? { filter: "drop-shadow(0 0 5px rgba(79,130,255,0.40))" } : undefined}
          onClick={toggleMonitor}
          aria-label="LLM Monitor"
          data-testid="dock-llm-monitor"
        >
          <Radio className="w-[18px] h-[18px]" />
          {monitorEventCount > 0 && !isMonitorOpen && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-emerald-500 text-[10px] font-bold text-white flex items-center justify-center px-0.5" data-testid="llm-monitor-badge">
              {monitorEventCount > 99 ? "99+" : monitorEventCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
