import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { Navbar } from "@/components/ide/navbar";
import { ToolsDock } from "@/components/ide/tools-dock";
import { FileTree } from "@/components/ide/file-tree";
import { CodeEditor } from "@/components/ide/code-editor";
import { ChatPanel } from "@/components/ide/chat-panel";
import { PreviewPanel } from "@/components/ide/preview-panel";
import { ConsolePanel } from "@/components/ide/console-panel";
import { CommandPalette } from "@/components/ide/command-palette";
import { NotebookPanel } from "@/components/ide/notebook-panel";
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
  const { activeTool, isConsoleOpen, toggleSidebar, toggleConsole, activeFile, loadProject, projectId, activeSpace } =
    useIDEStore();
  const { projects } = useProjectStore();
  const { toast } = useToast();

  const project = projects.find((p) => p.id === id);

  useEffect(() => {
    if (!project) {
      navigate("/", { replace: true });
      return;
    }
    if (projectId !== id) {
      loadProject(id!);
    }

    return () => {
      const current = useIDEStore.getState();
      if (current.projectId) {
        current.saveProject();
      }
    };
  }, [id, project, projectId, loadProject, navigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        toast({
          title: "File saved",
          description: activeFile ? activeFile.split("/").pop() : "All files saved",
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
  }, [activeFile, toggleSidebar, toggleConsole, toast]);

  if (!project || projectId !== id) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading project...</div>
      </div>
    );
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
                  className="bg-background rounded-lg border border-border/50 overflow-hidden"
                >
                  {activeTool === "files" && <FileTree />}
                  {activeTool === "chat" && <ChatPanel />}
                </ResizablePanel>
                <ResizableHandle className="w-0 bg-transparent" />
              </>
            )}

            <ResizablePanel defaultSize={activeTool ? 80 : 100} minSize={30} id="workspace" order={2}>
              <div className={activeSpace === "learner" ? "h-full bg-background rounded-lg border border-border/50 overflow-hidden" : "hidden"}>
                <NotebookPanel />
              </div>

              {activeSpace !== "learner" && (
                <ResizablePanelGroup direction="vertical" className="gap-1.5">
                  <ResizablePanel defaultSize={isConsoleOpen ? 75 : 100} minSize={30} id="editor-preview-area" order={1}>
                    <ResizablePanelGroup direction="horizontal" className="gap-1.5">
                      <ResizablePanel
                        defaultSize={50}
                        minSize={20}
                        id="editor-pane"
                        order={1}
                        className="bg-background rounded-lg border border-border/50 overflow-hidden"
                      >
                        <CodeEditor />
                      </ResizablePanel>
                      <ResizableHandle className="w-0 bg-transparent" />
                      <ResizablePanel
                        defaultSize={50}
                        minSize={20}
                        id="preview-pane"
                        order={2}
                        className="bg-background rounded-lg border border-border/50 overflow-hidden"
                      >
                        <PreviewPanel />
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  </ResizablePanel>

                  {isConsoleOpen && (
                    <>
                      <ResizableHandle className="h-0 bg-transparent" />
                      <ResizablePanel
                        defaultSize={25}
                        minSize={10}
                        maxSize={60}
                        id="console-pane"
                        order={2}
                        className="bg-background rounded-lg border border-border/50 overflow-hidden"
                      >
                        <ConsolePanel />
                      </ResizablePanel>
                    </>
                  )}
                </ResizablePanelGroup>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
      <LLMMonitor />
    </div>
  );
}
