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
          <div className="h-full flex gap-1.5">
            {activeTool && (
              <div className="w-[260px] shrink-0 bg-background rounded-lg border border-border/50 overflow-hidden">
                {activeTool === "files" && <FileTree />}
                {activeTool === "chat" && <ChatPanel />}
              </div>
            )}

            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="flex-1 min-h-0 flex gap-1.5">
                <div className="flex-1 min-w-0 bg-background rounded-lg border border-border/50 overflow-hidden">
                  <CodeEditor />
                </div>

                <div className="flex-1 min-w-0 bg-background rounded-lg border border-border/50 overflow-hidden">
                  <PreviewPanel />
                </div>
              </div>

              {isConsoleOpen && (
                <div className="h-[200px] shrink-0 bg-background rounded-lg border border-border/50 overflow-hidden">
                  <ConsolePanel />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
