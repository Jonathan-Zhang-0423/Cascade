import { useIDEStore } from "@/stores/ide-store";
import { Navbar } from "@/components/ide/navbar";
import { FileTree } from "@/components/ide/file-tree";
import { CodeEditor } from "@/components/ide/code-editor";
import { ChatPanel } from "@/components/ide/chat-panel";
import { PreviewPanel } from "@/components/ide/preview-panel";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";

export default function IDEPage() {
  const { isSidebarOpen, isChatOpen } = useIDEStore();
  const [mainTab, setMainTab] = useState<"editor" | "preview">("editor");

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background" data-testid="ide-page">
      <Navbar />

      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal">
          {isSidebarOpen && (
            <>
              <ResizablePanel
                defaultSize={15}
                minSize={12}
                maxSize={25}
                id="sidebar"
                order={1}
              >
                <FileTree />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          <ResizablePanel defaultSize={isChatOpen ? 55 : 85} minSize={30} id="main" order={2}>
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
              <div className="flex-1 min-h-0">
                {mainTab === "editor" ? <CodeEditor /> : <PreviewPanel />}
              </div>
            </div>
          </ResizablePanel>

          {isChatOpen && (
            <>
              <ResizableHandle />
              <ResizablePanel
                defaultSize={30}
                minSize={20}
                maxSize={45}
                id="chat"
                order={3}
              >
                <ChatPanel />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
