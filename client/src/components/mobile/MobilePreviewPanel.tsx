import { PreviewPanel } from "@/components/ide/preview-panel";

interface MobilePreviewPanelProps {
  onBack: () => void;
}

export function MobilePreviewPanel({ onBack }: MobilePreviewPanelProps) {
  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex-1 min-h-0 overflow-hidden [&_.preview-toolbar]:hidden">
        <PreviewPanel />
      </div>
      <div
        className="h-11 flex items-center justify-center border-t border-border/40 bg-[#0c0c14] shrink-0"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground flex items-center gap-1.5 px-4 py-2"
        >
          ← Back to Chat
        </button>
      </div>
    </div>
  );
}
