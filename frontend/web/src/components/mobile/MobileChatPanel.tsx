import { ChatPanel } from "@/components/ide/chat-panel";
import { ChatErrorBoundary } from "@/components/ide/chat/error-boundary";
import { useIDEStore } from "@/stores/ide-store";
import { useT } from "@/lib/i18n";

interface MobileChatPanelProps {
  onShowPreview: () => void;
}

export function MobileChatPanel({ onShowPreview }: MobileChatPanelProps) {
  const taskStatuses = useIDEStore((s) => s.taskStatuses);
  const t = useT();

  const statuses = Object.values(taskStatuses);
  const buildComplete =
    statuses.length > 0 &&
    statuses.every((s) => s === "done");

  return (
    <div className="relative flex flex-col h-full w-full">
      <ChatErrorBoundary>
        <ChatPanel />
      </ChatErrorBoundary>

      {buildComplete && (
        <button
          onClick={onShowPreview}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg flex items-center gap-2 transition-colors"
        >
          <span>▶</span>
          <span>{t("mobile.previewButton")}</span>
        </button>
      )}
    </div>
  );
}
