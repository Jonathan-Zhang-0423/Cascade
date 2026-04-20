import { useState, useRef, useCallback } from "react";
import { useProjectStore } from "@/stores/project-store";
import { MobileChatPanel } from "./MobileChatPanel";
import { MobilePreviewPanel } from "./MobilePreviewPanel";
import { AgentStreamProvider } from "@/components/ide/AgentStreamProvider";

type Tab = "chat" | "preview";

interface MobileIDEProps {
  projectId: string;
}

export function MobileIDE({ projectId }: MobileIDEProps) {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const { projects } = useProjectStore();
  const project = projects.find((p) => p.id === projectId);

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;

    if (Math.abs(dy) > Math.abs(dx)) return;
    if (Math.abs(dx) < 40) return;

    if (dx < 0) setActiveTab("preview");
    else setActiveTab("chat");
  }, []);

  return (
    <AgentStreamProvider>
      <div
        className="h-screen w-screen flex flex-col bg-background overflow-hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Header */}
        <div className="shrink-0 bg-[#0c0c14] border-b border-border/40">
          <div className="flex items-center gap-2 px-3 h-11">
            <a href="/" className="text-muted-foreground text-sm shrink-0">←</a>
            <span className="text-sm font-semibold text-foreground truncate flex-1">
              {project?.name ?? "Project"}
            </span>
            {project?.framework && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-950 text-blue-400 shrink-0">
                {project.framework}
              </span>
            )}
          </div>
          <div className="flex px-4 gap-5">
            {(["chat", "preview"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={[
                  "text-sm pb-2 capitalize transition-colors",
                  activeTab === tab
                    ? "text-blue-500 border-b-2 border-blue-500 font-semibold"
                    : "text-muted-foreground",
                ].join(" ")}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Panel area */}
        <div className="flex-1 min-h-0">
          {activeTab === "chat" ? (
            <MobileChatPanel onShowPreview={() => setActiveTab("preview")} />
          ) : (
            <MobilePreviewPanel onBack={() => setActiveTab("chat")} />
          )}
        </div>
      </div>
    </AgentStreamProvider>
  );
}
