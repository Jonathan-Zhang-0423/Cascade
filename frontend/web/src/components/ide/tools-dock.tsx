import { useState } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useLLMMonitorStore } from "@/stores/llm-monitor-store";
import { Sparkles, SquarePen, Radio, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { getProjectEmoji } from "@/lib/project-emoji";

// 图1设计：左侧可折叠、可拖拽宽度的边栏
// 顶部：折叠/展开箭头
// 内容：Main version 条目（带圆形选中框）+ 项目名副标题
// 底部：+ New task 按钮 + 橙色 + Core 标签

export function ToolsDock() {
  const { activeTool, setActiveTool, clearConversation, projectId } = useIDEStore();
  const { projects } = useProjectStore();
  const isMonitorOpen = useIDEStore((s) => s.isLLMMonitorOpen);
  const toggleMonitor = useIDEStore((s) => s.toggleLLMMonitor);
  const monitorEventCount = useLLMMonitorStore((s) => s.eventCount);
  const t = useT();

  const currentProject = projects.find((p) => p.id === projectId);

  const handleNewSession = () => {
    clearConversation();
    setActiveTool("chat");
  };

  return (
    <aside
      className="flex flex-col h-full bg-white border-r border-[#E5E7EB] shrink-0 overflow-hidden"
      style={{ width: "var(--sidebar-width, 220px)" }}
      data-testid="tools-dock"
    >
      {/* 折叠按钮行 */}
      <div className="flex items-center justify-end px-2 pt-2 pb-1 shrink-0">
        <button
          className="flex items-center justify-center w-6 h-6 rounded-md text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#6B7280] transition-colors"
          onClick={() => setActiveTool(activeTool === "chat" ? null : "chat")}
          aria-label="Toggle sidebar"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main version 条目 */}
      <div className="px-2 pb-1 shrink-0">
        <div
          className={cn(
            "flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg cursor-pointer transition-colors",
            activeTool === "chat"
              ? "bg-[#F3F4F6]"
              : "hover:bg-[#F9FAFB]"
          )}
          onClick={() => setActiveTool("chat")}
          data-testid="sidebar-main-version"
        >
          {/* 圆形选中框 */}
          <div className={cn(
            "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
            activeTool === "chat"
              ? "border-[#111827]"
              : "border-[#D1D5DB]"
          )}>
            {activeTool === "chat" && (
              <div className="w-2 h-2 rounded-full bg-[#111827]" />
            )}
          </div>

          {/* 文字 */}
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-[#111827] leading-tight">
              Main version
            </div>
            {currentProject && (
              <div className="text-[11px] text-[#9CA3AF] mt-0.5 truncate leading-tight">
                {getProjectEmoji(currentProject.name)} {currentProject.name}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 分割线 */}
      <div className="mx-3 border-t border-[#F3F4F6] mb-1" />

      {/* 其他工具按钮 */}
      <div className="px-2 flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto">
        <SidebarItem
          icon={<SquarePen className="w-[15px] h-[15px]" />}
          label="New Session"
          onClick={handleNewSession}
          testId="button-new-session"
        />
        <SidebarItem
          icon={<Radio className="w-[15px] h-[15px]" />}
          label="Monitor"
          isActive={isMonitorOpen}
          badge={monitorEventCount > 0 ? String(monitorEventCount) : undefined}
          onClick={toggleMonitor}
          testId="button-monitor"
        />
      </div>

      {/* 底部：+ New task + Core */}
      <div className="px-2 pb-3 pt-2 border-t border-[#F3F4F6] shrink-0">
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 flex-1 px-2.5 py-2 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] transition-colors text-[12px] text-[#6B7280] font-medium"
            data-testid="button-new-task"
          >
            <Plus className="w-3.5 h-3.5" />
            New task
          </button>
          {/* 橙色 + Core 标签 */}
          <button
            className="flex items-center gap-1 px-2 py-2 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors text-[11px] font-semibold text-[#EA580C] shrink-0"
            data-testid="button-upgrade-core"
          >
            <Plus className="w-3 h-3" />
            Core
          </button>
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({
  icon,
  label,
  isActive,
  badge,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  badge?: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-[13px] transition-colors text-left",
        isActive
          ? "bg-[#EEF2FF] text-[#0066FF]"
          : "text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]"
      )}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badge && (
        <span className="text-[10px] font-semibold bg-[#0066FF] text-white rounded-full px-1.5 py-0.5 shrink-0">
          {badge}
        </span>
      )}
    </button>
  );
}
