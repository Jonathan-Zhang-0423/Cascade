import { useEffect, useState } from "react";
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

  const project = projects.find((p) => p.id === id);

  useEffect(() => {
    if (!project) {
      navigate("/", { replace: true });
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

      <div className="flex-1 min-h-0 flex">
        <ToolsDock />

        <div className="flex-1 min-w-0 p-1.5 bg-sidebar">
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
                    <ResizablePanelGroup direction="horizontal" className="gap-1.5">
                      {codeVisible && (
                        <>
                          <ResizablePanel
                            defaultSize={layoutMode === "preview" ? 35 : 50}
                            minSize={20}
                            id="editor-pane"
                            order={1}
                            className="bg-background rounded-lg border border-border/60 overflow-hidden [transition:var(--transition-slow)]"
                          >
                            <CodeEditor />
                          </ResizablePanel>
                          <ResizableHandle className="w-[3px] bg-transparent hover:bg-primary/10 [transition:var(--transition-fast)]" />
                        </>
                      )}
                      <ResizablePanel
                        defaultSize={codeVisible ? (layoutMode === "preview" ? 65 : 50) : 100}
                        minSize={20}
                        id="preview-pane"
                        order={2}
                        className="bg-background rounded-lg border border-border/60 overflow-hidden"
                      >
                        <PreviewPanel />
                      </ResizablePanel>
                    </ResizablePanelGroup>
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
