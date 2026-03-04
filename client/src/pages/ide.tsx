import { useEffect } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { Navbar } from "@/components/ide/navbar";
import { ToolsDock } from "@/components/ide/tools-dock";
import { FileTree } from "@/components/ide/file-tree";
import { CodeEditor } from "@/components/ide/code-editor";
import { ChatPanel } from "@/components/ide/chat-panel";
import { PreviewPanel } from "@/components/ide/preview-panel";
import { ConsolePanel } from "@/components/ide/console-panel";
import { CommandPalette } from "@/components/ide/command-palette";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useToast } from "@/hooks/use-toast";

export default function IDEPage() {
  const { activeTool, isConsoleOpen, toggleSidebar, toggleConsole, activeFile } =
    useIDEStore();
  const { toast } = useToast();

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

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background" data-testid="ide-page">
      <Navbar />
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
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </div>
  );
}
