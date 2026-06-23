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
import { useT } from "@/lib/i18n";
import { useLanguageStore } from "@/stores/language-store";
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

export default function IDEPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const { activeTool, isConsoleOpen, toggleSidebar, toggleConsole, activeFile, loadProject, projectId, layoutMode, codeVisible, historyTabRequest } =
    useIDEStore();
  const userId = useIDEStore((s) => s.projectId ?? "");
  const { projects } = useProjectStore();
  const { toast } = useToast();
  const t = useT();
  const { lang } = useLanguageStore();
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [skillsModal, setSkillsModal] = useState<{ skill: Skill | null; scope: "user" | "project" } | null>(null);
  const [skillsRefreshKey, setSkillsRefreshKey] = useState(0);

  // 全屏仅针对右内容区预览
  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      previewAreaRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsPreviewFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ── 预览 Tab 状态提升到 ide.tsx，传给 Navbar(③) 和 PreviewPanel(⑥) ──
  type PreviewTab = { id: string; label: string; closable: boolean };
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([
    { id: "preview", label: t("navbar.previewTab"), closable: false },
  ]);
  const [activePreviewTab, setActivePreviewTab] = useState("preview");
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false);

  // 语言切换时同步更新 Preview tab 标签
  useEffect(() => {
    setPreviewTabs((prev) => prev.map((tab) =>
      tab.id === "preview" ? { ...tab, label: t("navbar.previewTab") } : tab
    ));
  }, [lang]);

  // 监听 historyTabRequest，打开右侧历史版本 tab
  useEffect(() => {
    if (historyTabRequest > 0) openHistoryTab();
  }, [historyTabRequest]);

  // 监听 plan-preview-open 事件，点击计划卡"查看"时在右侧新建/切换到计划详情 Tab
  const PLAN_PREVIEW_TAB_ID = "plan-preview";
  useEffect(() => {
    const handler = () => {
      setPreviewTabs((prev) => {
        if (prev.some((tab) => tab.id === PLAN_PREVIEW_TAB_ID)) return prev;
        return [...prev, { id: PLAN_PREVIEW_TAB_ID, label: t("navbar.planPreviewTab") ?? "任务计划", closable: true }];
      });
      setActivePreviewTab(PLAN_PREVIEW_TAB_ID);
      setToolsPanelOpen(false);
    };
    window.addEventListener("plan-preview-open", handler);
    return () => window.removeEventListener("plan-preview-open", handler);
  }, [t]);

  const addPreviewTab = () => {
    const id = `tab-${Date.now()}`;
    setPreviewTabs((prev) => [...prev, { id, label: t("navbar.newTab"), closable: true }]);
    setActivePreviewTab(id);
    setToolsPanelOpen(true);
  };

  const openHistoryTab = useCallback(() => {
    const HISTORY_TAB_ID = "history";
    setPreviewTabs((prev) => {
      if (prev.some((tab) => tab.id === HISTORY_TAB_ID)) return prev;
      return [...prev, { id: HISTORY_TAB_ID, label: t("checkpoint.title"), closable: true }];
    });
    setActivePreviewTab(HISTORY_TAB_ID);
    setToolsPanelOpen(false);
  }, [t]);
  const closePreviewTab = (id: string) => {
    setPreviewTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== id);
      // 如果关闭后只剩固定的 preview tab，关闭 tools 面板并切回 preview
      if (next.every((t) => !t.closable)) {
        setToolsPanelOpen(false);
        setActivePreviewTab("preview");
      } else if (activePreviewTab === id) {
        setActivePreviewTab("preview");
      }
      return next;
    });
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
        const newLeft = Math.max(140, Math.min(360, dragStart.current.leftW + dx));
        setLeftWidth(newLeft);
      }
      if (rightDragging.current) {
        // 右内容区最小宽度：375px（手机预览宽度）+ 20px 边距 = 395px
        const minRightWidth = 395;
        const totalWidth = window.innerWidth;
        const maxMid = totalWidth - dragStart.current.leftW - 10 - minRightWidth;
        setMidWidth(Math.max(280, Math.min(maxMid, dragStart.current.midW + dx)));
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

  // Track IDE page mount state for stream-registry guard
  useEffect(() => {
    useIDEStore.getState().setIdePageMounted(true);
    return () => { useIDEStore.getState().setIdePageMounted(false); };
  }, []);

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
        isFullscreen={isPreviewFullscreen}
        onTabClick={(id) => { setActivePreviewTab(id); setToolsPanelOpen(false); }}
        onTabClose={closePreviewTab}
        onAddTab={addPreviewTab}
        onToggleTools={() => { addPreviewTab(); }}
        onFullscreen={handleFullscreen}
      />
      <CommandPalette />

      {/* ── 两竖线：绝对定位，贯穿全高（含 Navbar），1px 视觉线 + 4px 拖拽热区 ── */}
      {/* 第一竖线 */}
      <div
        className="absolute top-0 bottom-0 z-20 flex items-stretch"
        style={{ left: leftWidth, width: 5, cursor: "col-resize" }}
        onMouseDown={onLeftDragStart}
      >
        <div style={{ width: 2, flexShrink: 0 }} />
        <div
          style={{
            width: 1,
            flexShrink: 0,
            background: leftActive ? "hsl(var(--primary))" : "var(--panel-divider)",
            transition: leftActive ? "none" : "background 0.15s",
          }}
          onMouseEnter={(e) => { if (!leftDragging.current) (e.currentTarget as HTMLElement).style.background = "hsl(var(--primary))"; }}
          onMouseLeave={(e) => { if (!leftDragging.current) (e.currentTarget as HTMLElement).style.background = "var(--panel-divider)"; }}
        />
        <div style={{ width: 2, flexShrink: 0 }} />
      </div>
      {/* 第二竖线 */}
      <div
        className="absolute top-0 bottom-0 z-20 flex items-stretch"
        style={{ left: leftWidth + 5 + midWidth, width: 5, cursor: "col-resize" }}
        onMouseDown={onRightDragStart}
      >
        <div style={{ width: 2, flexShrink: 0 }} />
        <div
          style={{
            width: 1,
            flexShrink: 0,
            background: rightActive ? "hsl(var(--primary))" : "var(--panel-divider)",
            transition: rightActive ? "none" : "background 0.15s",
          }}
          onMouseEnter={(e) => { if (!rightDragging.current) (e.currentTarget as HTMLElement).style.background = "hsl(var(--primary))"; }}
          onMouseLeave={(e) => { if (!rightDragging.current) (e.currentTarget as HTMLElement).style.background = "var(--panel-divider)"; }}
        />
        <div style={{ width: 2, flexShrink: 0 }} />
      </div>

      {/* ── 下方三列 ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ④ 左内容区 */}
        <div className="flex-shrink-0 h-full overflow-hidden" style={{ width: leftWidth, background: "var(--panel-left-bg)" }}>
          <ToolsDock />
        </div>

        {/* 竖线占位 5px，与绝对定位竖线宽度一致 */}
        <div className="flex-shrink-0" style={{ width: 5 }} />

        {/* ⑤ 中内容区 */}
        <div className="flex-shrink-0 h-full overflow-hidden" style={{ width: midWidth, background: "var(--panel-mid-bg)" }}>
          {activeTool && (
            <div className="h-full overflow-hidden">
              {activeTool === "files" && <FileTree />}
              <div style={{ display: activeTool === "chat" ? "flex" : "none", flexDirection: "column", height: "100%" }}>
                <ChatErrorBoundary><ChatPanel /></ChatErrorBoundary>
              </div>
              {activeTool === "history" && <CheckpointPanel />}
              {activeTool === "skills" && (
                <SkillsPanel onEdit={(skill, scope) => setSkillsModal({ skill, scope })} refreshKey={skillsRefreshKey} />
              )}
            </div>
          )}
        </div>

        {/* 竖线占位 5px */}
        <div className="flex-shrink-0" style={{ width: 5 }} />

        {/* ⑥ 右内容区 */}
        <div ref={previewAreaRef} className="flex-1 min-w-0 h-full overflow-hidden flex flex-col" style={{ background: "var(--panel-right-bg)" }}>
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