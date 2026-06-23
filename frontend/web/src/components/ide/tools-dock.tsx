import { useEffect, useState } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { SquarePen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export function ToolsDock() {
  const {
    activeTool, setActiveTool,
    projectId,
    currentSessionId, sessions, sessionsLoaded,
    loadSessions, createSession, switchSession, deleteSession,
  } = useIDEStore();
  const { projects } = useProjectStore();
  const currentProject = projects.find((p) => p.id === projectId);
  const t = useT();
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    if (projectId && !sessionsLoaded) loadSessions();
  }, [projectId, sessionsLoaded, loadSessions]);

  const handleNewSession = async () => {
    await createSession();
  };

  const handleSwitchSession = async (sid: string) => {
    await switchSession(sid);
  };

  const isMainActive = activeTool === "chat" && currentSessionId === "main";

  return (
    <aside className="flex flex-col h-full overflow-hidden" style={{ background: "var(--panel-left-bg)" }} data-testid="tools-dock">

      {/* 整个列表区域可滚动 */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 pt-3 pb-1">
        {/* 主会话 */}
        <div
          className={cn(
            "flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg cursor-pointer transition-colors",
            isMainActive ? "bg-[var(--panel-mid-bg)] shadow-sm" : "hover:bg-[var(--panel-mid-bg)]/60"
          )}
          onClick={() => handleSwitchSession("main")}
          data-testid="sidebar-main-session"
        >
          <div className={cn(
            "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
            isMainActive ? "border-foreground" : "border-muted-foreground/40"
          )}>
            {isMainActive && <div className="w-2 h-2 rounded-full bg-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground leading-tight">{t("dock.mainSession")}</div>
            {currentProject && (
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate leading-tight">
                {currentProject.name}
              </div>
            )}
          </div>
        </div>

        {/* 历史 session 列表 — 紧跟主会话下方 */}
        {sessions.map((session) => {
          const isActive = activeTool === "chat" && currentSessionId === session.id;
          return (
            <div
              key={session.id}
              className={cn(
                "group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors mt-0.5",
                isActive ? "bg-[var(--panel-mid-bg)] shadow-sm" : "hover:bg-[var(--panel-mid-bg)]/60"
              )}
              onClick={() => handleSwitchSession(session.id)}
              onMouseEnter={() => setHovered(session.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className={cn(
                "w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors",
                isActive ? "border-foreground" : "border-muted-foreground/30"
              )}>
                {isActive && <div className="w-1.5 h-1.5 rounded-full bg-foreground" />}
              </div>
              <span className={cn(
                "flex-1 text-[12px] truncate leading-tight transition-colors",
                isActive ? "text-foreground font-medium" : "text-muted-foreground"
              )}>
                {session.name}
              </span>
              {hovered === session.id && (
                <button
                  className="shrink-0 p-0.5 rounded hover:bg-destructive/10 transition-colors"
                  onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                  title="删除会话"
                >
                  <X className="w-3 h-3 text-muted-foreground/60 hover:text-destructive" />
                </button>
              )}
            </div>
          );
        })}

        {/* 新建会话 — 紧跟所有 session 下方 */}
        <button
          className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground hover:bg-[var(--panel-mid-bg)]/60 hover:text-foreground transition-colors text-left mt-0.5"
          onClick={handleNewSession}
          data-testid="button-new-session"
        >
          <SquarePen className="w-[15px] h-[15px] shrink-0" />
          <span className="truncate">{t("dock.newSession")}</span>
        </button>
      </div>
    </aside>
  );
}
