import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileIDE } from "@/components/mobile/MobileIDE";
import { Navbar } from "@/components/ide/navbar";
import { ToolsDock } from "@/components/ide/tools-dock";
import { FileTree } from "@/components/ide/file-tree";
import { CodeEditor } from "@/components/ide/code-editor";
import { ChatPanel } from "@/components/ide/chat-panel";
import { ChatErrorBoundary } from "@/components/ide/chat/error-boundary";
import { PreviewPanel } from "@/components/ide/preview-panel";
import { ConsolePanel } from "@/components/ide/console-panel";
import { CheckpointPanel } from "@/components/ide/CheckpointPanel";
import { SkillsPanel } from "@/components/ide/skills-panel";
import { SkillsModal } from "@/components/ide/skills-modal";
import type { Skill } from "@/components/ide/skill-types";
import { CommandPalette } from "@/components/ide/command-palette";
import { LLMMonitor } from "@/components/ide/llm-monitor";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/lib/i18n";

export default function IDEPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const { activeTool, isConsoleOpen, toggleSidebar, toggleConsole, activeFile, loadProject, projectId, layoutMode, codeVisible } =
    useIDEStore();
  const userId = useIDEStore((s) => s.projectId ?? "");
  const { projects } = useProjectStore();
  const { toast } = useToast();
  const t = useT();
  const [skillsModal, setSkillsModal] = useState<{ skill: Skill | null; scope: "user" | "project" } | null>(null);
  const [skillsRefreshKey, setSkillsRefreshKey] = useState(0);

  // 左侧边栏可拖拽宽度 — 纯 CSS/DOM 实现，不依赖 ResizablePanelGroup
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWRef.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const next = Math.max(160, Math.min(360, startWRef.current + delta));
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const project = projects.find((p) => p.id === id);

  useEffect(() => {
    if (!id) return;
    if (!project) {
      navigate("/app");
      return;
    }
    if (projectId !== id) {
      loadProject(id!, project?.framework);
    }

    return () => {
      const current = useIDEStore.getState();
      if (current.projectId) {
        current.saveProject();
      }
    };
  }, [id, project, projectId, loadProject, navigate]);

  useEffect(() => {
    if (isMobile) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        toast({
          title: t("ide.fileSaved"),
          description: activeFile ? activeFile.split("/").pop() : t("ide.allFilesSaved"),
          duration: 1500,
        });
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        toggleConsole();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeFile, toggleSidebar, toggleConsole, toast, isMobile]);

  if (!project || projectId !== id) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">{t("ide.loading")}</div>
      </div>
    );
  }

  if (isMobile) {
    return <MobileIDE projectId={id!} />;
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background" data-testid="ide-page">
      <Navbar projectName={project.name} />
      <CommandPalette />

      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* 左侧边栏 — 固定宽度由 state 控制，右侧有拖拽手柄 */}
        <div
          className="flex-shrink-0 h-full overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <ToolsDock />
        </div>

        {/* 拖拽手柄 */}
        <div
          className="w-[4px] h-full cursor-col-resize flex-shrink-0 bg-transparent hover:bg-[#0A66C2]/20 transition-colors group relative"
          onMouseDown={onDragStart}
        >
          <div className="absolute inset-y-0 left-[1px] w-[2px] bg-[#EBEBEB] group-hover:bg-[#0A66C2]/40 transition-colors" />
        </div>

        {/* 主区域 */}
        <div className="flex-1 min-w-0 p-1.5 bg-[#F5F5F5]">
          <ResizablePanelGroup direction="horizontal" className="h-full gap-1.5">
            {activeTool && (
              <>
                <ResizablePanel
                  defaultSize={20}
                  minSize={15}
                  maxSize={40}
                  id="tool-panel"
                  order={1}
                  className="bg-background rounded-lg border border-border/60 overflow-hidden"
                >
                  {activeTool === "files" && <FileTree />}
                  {activeTool === "chat" && <ChatErrorBoundary><ChatPanel /></ChatErrorBoundary>}
                  {activeTool === "history" && <CheckpointPanel />}
                  {activeTool === "skills" && (
                    <SkillsPanel
                      onEdit={(skill, scope) => setSkillsModal({ skill, scope })}
                      refreshKey={skillsRefreshKey}
                    />
                  )}
                </ResizablePanel>
                <ResizableHandle className="w-[3px] bg-transparent hover:bg-primary/10 [transition:var(--transition-fast)]" />
              </>
            )}

            <ResizablePanel defaultSize={activeTool ? 80 : 100} minSize={30} id="workspace" order={2}>
              <ResizablePanelGroup direction="vertical" className="gap-1.5">
                <ResizablePanel defaultSize={isConsoleOpen ? 75 : 100} minSize={30} id="editor-preview-area" order={1}>
                  {/* 代码编辑器面板已移除，只保留预览区 */}
                  <div className="h-full bg-background rounded-lg border border-border/60 overflow-hidden">
                    <PreviewPanel />
                  </div>
                </ResizablePanel>

                {isConsoleOpen && (
                  <>
                    <ResizableHandle className="h-[3px] bg-transparent hover:bg-primary/10 [transition:var(--transition-fast)]" />
                    <ResizablePanel
                      defaultSize={25}
                      minSize={10}
                      maxSize={60}
                      id="console-pane"
                      order={2}
                      className="bg-background rounded-lg border border-border/60 overflow-hidden"
                    >
                      <ConsolePanel />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </ResizablePanel>

          </ResizablePanelGroup>
        </div>

      </div>

      <LLMMonitor />
      {skillsModal && (
        <SkillsModal
          skill={skillsModal.skill}
          scope={skillsModal.scope}
          userId={userId}
          onClose={() => setSkillsModal(null)}
          onSaved={() => { setSkillsModal(null); setSkillsRefreshKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}
