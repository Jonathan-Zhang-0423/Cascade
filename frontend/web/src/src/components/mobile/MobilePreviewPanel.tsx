import { PreviewPanel } from "@/components/ide/preview-panel";
import { useT } from "@/lib/i18n";

interface MobilePreviewPanelProps {
  onBack: () => void;
}

export function MobilePreviewPanel({ onBack }: MobilePreviewPanelProps) {
  const t = useT();
  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex-1 min-h-0 overflow-hidden [&_.preview-toolbar]:hidden">
        <PreviewPanel fullscreen />
      </div>
      <div
        className="h-11 flex items-center justify-center border-t border-border/40 bg-[#0c0c14] shrink-0"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground flex items-center gap-1.5 px-4 py-2"
        >
          {t("mobile.backToChat")}
        </button>
      </div>
    </div>
  );
}
