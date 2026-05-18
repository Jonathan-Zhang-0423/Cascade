import { useState, useRef, useCallback } from "react";
import { useProjectStore } from "@/stores/project-store";
import { MobileChatPanel } from "./MobileChatPanel";
import { MobilePreviewPanel } from "./MobilePreviewPanel";
import { AgentStreamProvider } from "@/components/ide/AgentStreamProvider";
import { useT } from "@/lib/i18n";
import { ChevronLeft } from "lucide-react";

type Tab = "chat" | "preview";

interface MobileIDEProps {
  projectId: string;
}

export function MobileIDE({ projectId }: MobileIDEProps) {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const { projects } = useProjectStore();
  const project = projects.find((p) => p.id === projectId);
  const t = useT();

  const TAB_LABELS: Record<Tab, string> = {
    chat: t("mobile.chatTab"),
    preview: t("mobile.previewTab"),
  };

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
            <a href="/" className="text-primary shrink-0" aria-label="Back">
              <ChevronLeft className="w-5 h-5" />
            </a>
            <span className="font-lora text-sm font-semibold text-foreground truncate flex-1">
              {project?.name ?? "Project"}
            </span>
            {project?.framework && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary/80 shrink-0">
                {project.framework}
              </span>
            )}
          </div>
          <div className="flex px-3 gap-1 pb-2">
            {(["chat", "preview"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={[
                  "text-xs px-3 py-1.5 rounded-full font-semibold capitalize transition-colors",
                  activeTab === tab
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {TAB_LABELS[tab]}
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
