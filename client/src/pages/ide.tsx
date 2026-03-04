import { useEffect } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { Navbar } from "@/components/ide/navbar";
import { FileTree } from "@/components/ide/file-tree";
import { CodeEditor } from "@/components/ide/code-editor";
import { ChatPanel } from "@/components/ide/chat-panel";
import { PreviewPanel } from "@/components/ide/preview-panel";
import { ConsolePanel } from "@/components/ide/console-panel";
import { StatusBar } from "@/components/ide/status-bar";
import { CommandPalette } from "@/components/ide/command-palette";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function IDEPage() {
  const { isSidebarOpen, isChatOpen, isConsoleOpen, toggleSidebar, toggleConsole, activeFile } =
    useIDEStore();
  const [mainTab, setMainTab] = useState<"editor" | "preview">("editor");
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

  const breadcrumb = activeFile
    ? activeFile
        .split("/")
        .filter(Boolean)
        .join(" / ")
    : null;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background" data-testid="ide-page">
      <Navbar />
      <CommandPalette />

      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal">
          {isChatOpen && (
            <>
              <ResizablePanel
                defaultSize={25}
                minSize={20}
                maxSize={40}
                id="chat"
                order={1}
              >
                <ChatPanel />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          {isSidebarOpen && (
            <>
              <ResizablePanel
                defaultSize={15}
                minSize={12}
                maxSize={25}
                id="sidebar"
                order={2}
              >
                <FileTree />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          <ResizablePanel defaultSize={60} minSize={30} id="main" order={3}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={isConsoleOpen ? 70 : 100} minSize={30} id="editor-area" order={1}>
                <div className="h-full flex flex-col">
                  <div className="flex items-center border-b border-border/50 bg-card/20 shrink-0">
                    <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "editor" | "preview")} className="w-full">
                      <TabsList className="h-9 bg-transparent rounded-none border-0 p-0 gap-0">
                        <TabsTrigger
                          value="editor"
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs px-4 h-9"
                          data-testid="tab-editor"
                        >
                          Code
                        </TabsTrigger>
                        <TabsTrigger
                          value="preview"
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs px-4 h-9"
                          data-testid="tab-preview"
                        >
                          Preview
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  {breadcrumb && mainTab === "editor" && (
                    <div className="flex items-center px-3 h-7 border-b border-border/30 bg-card/10 shrink-0" data-testid="breadcrumb">
                      <span className="text-[11px] text-muted-foreground truncate">
                        {breadcrumb}
                      </span>
                    </div>
                  )}

                  <div className="flex-1 min-h-0">
                    {mainTab === "editor" ? <CodeEditor /> : <PreviewPanel />}
                  </div>
                </div>
              </ResizablePanel>

              {isConsoleOpen && (
                <>
                  <ResizableHandle />
                  <ResizablePanel
                    defaultSize={30}
                    minSize={10}
                    maxSize={60}
                    id="console-area"
                    order={2}
                  >
                    <ConsolePanel />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <StatusBar />
    </div>
  );
}
