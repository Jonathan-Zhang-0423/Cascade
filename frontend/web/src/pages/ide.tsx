import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileIDE } from "@/components/mobile/MobileIDE";
import { Navbar } from "@/components/ide/navbar";
import { ToolsDock } from "@/components/ide/tools-dock";
import { FileTree } from "@/components/ide/file-tree";
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

  // ── 预览 Tab 状态提升到 ide.tsx，传给 Navbar(③) 和 PreviewPanel(⑥) ──
  type PreviewTab = { id: string; label: string; closable: boolean };
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([
    { id: "preview", label: "Preview", closable: false },
  ]);
  const [activePreviewTab, setActivePreviewTab] = useState("preview");
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false);

  const addPreviewTab = () => {
    const id = `tab-${Date.now()}`;
    setPreviewTabs((prev) => [...prev, { id, label: "New tab", closable: true }]);
    setActivePreviewTab(id);
    setToolsPanelOpen(true);
  };
  const closePreviewTab = (id: string) => {
    setPreviewTabs((prev) => prev.filter((t) => t.id !== id));
    if (activePreviewTab === id) setActivePreviewTab("preview");
  };

  // ── 两竖线拖拽：贯穿全高（含 Navbar） ──
  const [leftWidth, setLeftWidth] = useState(220);
  const [midWidth, setMidWidth] = useState(400);
  const leftDragging = useRef(false);
  const rightDragging = useRef(false);
  const dragStart = useRef({ x: 0, leftW: 0, midW: 0 });
  const [leftActive, setLeftActive] = useState(false);
  const [rightActive, setRightActive] = useState(false);

  const onLeftDragStart = useCallback((e: React.MouseEvent) => {
    leftDragging.current = true;
    dragStart.current = { x: e.clientX, leftW: leftWidth, midW: midWidth };
    setLeftActive(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [leftWidth, midWidth]);

  const onRightDragStart = useCallback((e: React.MouseEvent) => {
    rightDragging.current = true;
    dragStart.current = { x: e.clientX, leftW: leftWidth, midW: midWidth };
    setRightActive(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [leftWidth, midWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x;
      if (leftDragging.current) {
        setLeftWidth(Math.max(140, Math.min(360, dragStart.current.leftW + dx)));
      }
      if (rightDragging.current) {
        setMidWidth(Math.max(280, Math.min(700, dragStart.current.midW + dx)));
      }
    };
    const onUp = () => {
      if (leftDragging.current) { leftDragging.current = false; setLeftActive(false); }
      if (rightDragging.current) { rightDragging.current = false; setRightActive(false); }
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
    <div className="h-screen w-screen flex flex-col overflow-hidden relative" style={{ background: "var(--panel-mid-bg)" }} data-testid="ide-page">

      {/* ── 一横：顶部导航栏 ── */}
      <Navbar
        projectName={project.name}
        leftWidth={leftWidth}
        midWidth={midWidth}
        previewTabs={previewTabs}
        activePreviewTab={activePreviewTab}
        toolsPanelOpen={toolsPanelOpen}
        onTabClick={(id) => { setActivePreviewTab(id); setToolsPanelOpen(false); }}
        onTabClose={closePreviewTab}
        onAddTab={addPreviewTab}
        onToggleTools={() => setToolsPanelOpen((v) => !v)}
      />
      <CommandPalette />

      {/* ── 两竖线：绝对定位，贯穿 Navbar + 内容区全高，一体化 ── */}
      {/* 第一竖线 */}
      <div
        className="absolute top-0 bottom-0 cursor-col-resize select-none z-20"
        style={{
          left: leftWidth,
          width: 4,
          background: leftActive ? "hsl(var(--primary))" : "var(--panel-divider)",
          transition: leftActive ? "none" : "background 0.15s",
        }}
        onMouseDown={onLeftDragStart}
        onMouseEnter={(e) => { if (!leftDragging.current) (e.currentTarget as HTMLElement).style.background = "hsl(var(--primary))"; }}
        onMouseLeave={(e) => { if (!leftDragging.current) (e.currentTarget as HTMLElement).style.background = "var(--panel-divider)"; }}
      />
      {/* 第二竖线 */}
      <div
        className="absolute top-0 bottom-0 cursor-col-resize select-none z-20"
        style={{
          left: leftWidth + 4 + midWidth,
          width: 4,
          background: rightActive ? "hsl(var(--primary))" : "var(--panel-divider)",
          transition: rightActive ? "none" : "background 0.15s",
        }}
        onMouseDown={onRightDragStart}
        onMouseEnter={(e) => { if (!rightDragging.current) (e.currentTarget as HTMLElement).style.background = "hsl(var(--primary))"; }}
        onMouseLeave={(e) => { if (!rightDragging.current) (e.currentTarget as HTMLElement).style.background = "var(--panel-divider)"; }}
      />

      {/* ── 下方三列（竖线已用绝对定位，这里不再放竖线元素） ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ④ 左内容区 */}
        <div className="flex-shrink-0 h-full overflow-hidden" style={{ width: leftWidth, background: "var(--panel-left-bg)" }}>
          <ToolsDock />
        </div>

        {/* 竖线占位（4px，透明，让布局宽度对齐） */}
        <div className="flex-shrink-0" style={{ width: 4 }} />

        {/* ⑤ 中内容区 */}
        <div className="flex-shrink-0 h-full overflow-hidden" style={{ width: midWidth, background: "var(--panel-mid-bg)" }}>
          {activeTool && (
            <div className="h-full overflow-hidden">
              {activeTool === "files" && <FileTree />}
              {activeTool === "chat" && <ChatErrorBoundary><ChatPanel /></ChatErrorBoundary>}
              {activeTool === "history" && <CheckpointPanel />}
              {activeTool === "skills" && (
                <SkillsPanel onEdit={(skill, scope) => setSkillsModal({ skill, scope })} refreshKey={skillsRefreshKey} />
              )}
            </div>
          )}
        </div>

        {/* 竖线占位 */}
        <div className="flex-shrink-0" style={{ width: 4 }} />

        {/* ⑥ 右内容区 */}
        <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col" style={{ background: "var(--panel-right-bg)" }}>
          <ResizablePanelGroup direction="vertical" style={{ gap: 0 }}>
            <ResizablePanel defaultSize={isConsoleOpen ? 75 : 100} minSize={30} id="preview-area" order={1}>
              <div className="h-full overflow-hidden" style={{ background: "var(--panel-right-bg)" }}>
                <PreviewPanel
                  activePreviewTab={activePreviewTab}
                  toolsPanelOpen={toolsPanelOpen}
                  setToolsPanelOpen={setToolsPanelOpen}
                />
              </div>
            </ResizablePanel>
            {isConsoleOpen && (
              <>
                <ResizableHandle className="h-[4px] flex-shrink-0 cursor-row-resize" style={{ background: "var(--panel-divider)" }} />
                <ResizablePanel defaultSize={25} minSize={10} maxSize={60} id="console-pane" order={2}>
                  <div className="h-full overflow-hidden" style={{ background: "var(--panel-mid-bg)" }}>
                    <ConsolePanel />
                  </div>
                </ResizablePanel>
              </>
            )}
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