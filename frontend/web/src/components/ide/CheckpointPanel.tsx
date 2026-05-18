import { useState } from "react";
import { History, RotateCcw, Check, FileDiff } from "lucide-react";
import { useIDEStore } from "@/stores/ide-store";
import type { Checkpoint } from "@/stores/ide-store";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { formatRelativeTime } from "./chat/chat-utils";

function getChangedFileCount(checkpoint: Checkpoint): number {
  if (checkpoint.diff) return checkpoint.diff.length;
  // The most recent checkpoint always has a snapshot (no diff yet)
  return 0;
}

function CheckpointRow({
  checkpoint,
  isActive,
  onRestore,
}: {
  checkpoint: Checkpoint;
  isActive: boolean;
  onRestore: (id: string) => void;
}) {
  const [restored, setRestored] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const t = useT();
  const changedFiles = getChangedFileCount(checkpoint);

  const handleRestoreClick = () => {
    if (isActive) return;
    setConfirming(true);
  };

  const handleConfirm = () => {
    onRestore(checkpoint.id);
    setConfirming(false);
    setRestored(true);
    setTimeout(() => setRestored(false), 2000);
  };

  return (
    <div
      className={cn(
        "px-3 py-2.5 border-b border-border/30 last:border-b-0",
        isActive ? "bg-accent/20" : "hover:bg-muted/30 transition-colors"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {isActive ? (
            <div className="w-2 h-2 rounded-full bg-emerald-500 mt-0.5" />
          ) : (
            <div className="w-2 h-2 rounded-full border border-muted-foreground/40 mt-0.5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "text-xs font-medium truncate",
                isActive ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {checkpoint.label}
            </span>
            <span className="text-[10px] text-muted-foreground/60 shrink-0">
              {formatRelativeTime(checkpoint.timestamp)}
            </span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
              <FileDiff className="w-3 h-3" />
              {changedFiles === 0
                ? t("checkpoint.noChanges")
                : t("checkpoint.filesChanged", { count: String(changedFiles) })}
            </span>
            {!isActive && !confirming && (
              <button
                className="text-[10px] text-muted-foreground/60 hover:text-foreground flex items-center gap-0.5 underline underline-offset-2 transition-colors"
                onClick={handleRestoreClick}
                data-testid={`checkpoint-panel-restore-${checkpoint.id}`}
              >
                {restored ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-500" />
                    <span className="text-emerald-500 no-underline">{t("chat.restored")}</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-2.5 h-2.5" />
                    {t("chat.restore")}
                  </>
                )}
              </button>
            )}
            {confirming && (
              <div className="flex items-center gap-1.5">
                <button
                  className="text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
                  onClick={() => setConfirming(false)}
                >
                  {t("checkpoint.cancel")}
                </button>
                <button
                  className="text-[10px] text-amber-500 hover:text-amber-400 font-medium transition-colors"
                  onClick={handleConfirm}
                  data-testid={`checkpoint-panel-confirm-${checkpoint.id}`}
                >
                  {t("checkpoint.confirm")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CheckpointPanel() {
  const { checkpoints, restoreCheckpoint, refreshPreview } = useIDEStore();
  const t = useT();

  const handleRestore = (id: string) => {
    restoreCheckpoint(id);
    refreshPreview();
  };

  // The most recent checkpoint (last in array) is the current/active state
  const activeCheckpointId =
    checkpoints.length > 0 ? checkpoints[checkpoints.length - 1].id : null;

  const reversed = [...checkpoints].reverse();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 shrink-0">
        <History className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">
          {t("checkpoint.title")}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/50">
          {checkpoints.length} {t("checkpoint.count")}
        </span>
      </div>

      {checkpoints.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground/40 p-4">
          <History className="w-8 h-8" />
          <p className="text-xs text-center">{t("checkpoint.empty")}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {reversed.map((cp) => (
            <CheckpointRow
              key={cp.id}
              checkpoint={cp}
              isActive={cp.id === activeCheckpointId}
              onRestore={handleRestore}
            />
          ))}
        </div>
      )}
    </div>
  );
}
