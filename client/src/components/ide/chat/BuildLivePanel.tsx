import { useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import type { ActionLogEntry } from "./chat-types";

interface BuildLivePanelProps {
  entries: ActionLogEntry[];
  thinkingText?: string;
  narrationText?: string;
  thinkingElapsedSec?: number | null;
}

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function BrailleSpinner() {
  const [frame, setFrame] = useState(0);
  useState(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % BRAILLE_FRAMES.length), 80);
    return () => clearInterval(id);
  });
  return <span className="text-[#818cf8]">{BRAILLE_FRAMES[frame % BRAILLE_FRAMES.length]}</span>;
}

export function BuildLivePanel({
  entries,
  thinkingText,
  narrationText,
  thinkingElapsedSec,
}: BuildLivePanelProps) {
  const t = useT();
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  const nonThinkingEntries = entries.filter((e) => e.type !== "thinking").slice(-3);
  const hasThinking = !!thinkingText || thinkingElapsedSec != null;
  const isThinkingDone = thinkingElapsedSec != null;

  if (!hasThinking && !narrationText && nonThinkingEntries.length === 0) return null;

  return (
    <div
      className="px-3.5 py-1 font-mono text-[11px] leading-[1.7] space-y-px"
      data-testid="build-live-panel"
    >
      {/* Thinking */}
      {hasThinking && (
        isThinkingDone ? (
          <button
            className="flex items-center gap-1.5 text-[rgba(129,140,248,0.5)] hover:text-[rgba(129,140,248,0.7)] transition-colors w-full text-left"
            onClick={() => setThinkingExpanded((e) => !e)}
            data-testid="thinking-collapsed-chip"
          >
            <span className="text-[10px]">{thinkingExpanded ? "▾" : "▸"}</span>
            <span className="italic">{t("chat.thoughtFor", { n: String(thinkingElapsedSec) })}</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-[rgba(129,140,248,0.6)]" data-testid="thinking-stream">
            <BrailleSpinner />
            <span className="italic truncate">
              {thinkingText ? thinkingText.slice(-60) : t("chat.thinkingLive")}
            </span>
          </div>
        )
      )}

      {/* Expanded thinking */}
      {isThinkingDone && thinkingExpanded && thinkingText && (
        <div className="pl-4 max-h-[120px] overflow-y-auto">
          <p className="text-[10px] text-[rgba(129,140,248,0.35)] italic whitespace-pre-wrap break-words">
            {thinkingText}
          </p>
        </div>
      )}

      {/* Narration */}
      {narrationText && (
        <div className="flex items-start gap-1.5" data-testid="narration-live-text">
          <span className="text-[#34d68a] shrink-0">│</span>
          <span className="text-[rgba(238,238,246,0.6)]">{narrationText}</span>
        </div>
      )}

      {/* File operations */}
      {nonThinkingEntries.map((entry, i) => {
        const isWrite = entry.type === "file_write";
        const isRead = entry.type === "file_read";
        const fileName = entry.filePath
          ? entry.filePath.split("/").pop() || entry.filePath
          : entry.label;
        const verb = isWrite ? "Write" : isRead ? "Read" : entry.label || "...";
        return (
          <div
            key={i}
            className="flex items-center gap-1.5"
          >
            <span className={cn(
              "shrink-0",
              isWrite ? "text-[#34d68a]" : "text-[rgba(238,238,246,0.15)]"
            )}>│</span>
            <span className={cn(
              "truncate",
              isWrite ? "text-[#34d68a]" : "text-[rgba(238,238,246,0.35)]"
            )}>
              {isWrite || isRead ? `${verb} ${fileName}` : fileName}
            </span>
          </div>
        );
      })}
    </div>
  );
}
