import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { SquarePen } from "lucide-react";
import { cn } from "@/lib/utils";
import { getProjectEmoji } from "@/lib/project-emoji";

export function ToolsDock() {
  const { activeTool, setActiveTool, clearConversation, projectId } = useIDEStore();
  const { projects } = useProjectStore();
  const currentProject = projects.find((p) => p.id === projectId);

  return (
    <aside className="flex flex-col h-full overflow-hidden" style={{ background: "var(--panel-left-bg)" }} data-testid="tools-dock">

      {/* Main session 条目 */}
      <div className="px-2 pt-3 pb-1 shrink-0">
        <div
          className={cn(
            "flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg cursor-pointer transition-colors",
            activeTool === "chat"
              ? "bg-[var(--panel-mid-bg)] shadow-sm"
              : "hover:bg-[var(--panel-mid-bg)]/60"
          )}
          onClick={() => setActiveTool("chat")}
          data-testid="sidebar-main-session"
        >
          <div className={cn(
            "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
            activeTool === "chat" ? "border-foreground" : "border-muted-foreground/40"
          )}>
            {activeTool === "chat" && <div className="w-2 h-2 rounded-full bg-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground leading-tight">Main session</div>
            {currentProject && (
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate leading-tight">
                {getProjectEmoji(currentProject.name)} {currentProject.name}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-3 border-t my-1" style={{ borderColor: "var(--panel-divider)" }} />

      {/* New Session */}
      <div className="px-2">
        <button
          className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground hover:bg-[var(--panel-mid-bg)]/60 hover:text-foreground transition-colors text-left"
          onClick={() => { clearConversation(); setActiveTool("chat"); }}
          data-testid="button-new-session"
        >
          <SquarePen className="w-[15px] h-[15px] shrink-0" />
          <span className="truncate">New Session</span>
        </button>
      </div>
    </aside>
  );
}
