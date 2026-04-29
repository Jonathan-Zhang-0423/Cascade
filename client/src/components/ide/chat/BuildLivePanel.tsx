import { Brain, ChevronRight, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ActionLogEntry } from "./chat-types";
import { useT } from "@/lib/i18n";

interface BuildLivePanelProps {
  entries: ActionLogEntry[];
  thinkingText?: string;
  narrationText?: string;
  thinkingElapsedSec?: number | null;
}

export function BuildLivePanel({
  entries,
  thinkingText,
  narrationText,
  thinkingElapsedSec,
}: BuildLivePanelProps) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const t = useT();

  const nonThinkingEntries = entries.filter((e) => e.type !== "thinking").slice(-5);
  const hasThinking = !!thinkingText || thinkingElapsedSec != null;
  const isThinkingDone = thinkingElapsedSec != null;

  if (!hasThinking && !narrationText && nonThinkingEntries.length === 0) return null;

  return (
    <div
      className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden"
      data-testid="build-live-panel"
    >
      <div className="px-3 py-2 space-y-1.5">
        {/* Thinking zone */}
        {hasThinking && (
          isThinkingDone ? (
            // Collapsed chip after narration starts
            <button
              className="w-full flex items-center gap-1.5 text-[11px] text-blue-400/70 hover:text-blue-400/90 transition-colors text-left"
              onClick={() => setThinkingExpanded((e) => !e)}
              data-testid="thinking-collapsed-chip"
            >
              <Brain className="w-3 h-3 shrink-0" />
              <span className="flex-1">
                {t("action.thinking")} · {thinkingElapsedSec}s
              </span>
              {thinkingExpanded ? (
                <ChevronDown className="w-2.5 h-2.5 shrink-0" />
              ) : (
                <ChevronRight className="w-2.5 h-2.5 shrink-0" />
              )}
            </button>
          ) : (
            // Streaming thinking
            <div
              className="rounded-md px-3 py-2"
              style={{
                background: "rgba(129,140,248,0.06)",
                border: "1px solid rgba(129,140,248,0.12)",
              }}
              data-testid="thinking-stream"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <Brain className="w-3 h-3 shrink-0 text-[#818cf8]" />
                <span className="text-[11px] font-medium text-[#818cf8] uppercase tracking-wide flex-1">
                  {t("action.thinking")}
                </span>
                <div className="flex items-center gap-[3px]">
                  <span className="w-[4px] h-[4px] rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: "0ms" }} />
                  <span className="w-[4px] h-[4px] rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: "150ms" }} />
                  <span className="w-[4px] h-[4px] rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
              <p className="text-[12px] leading-relaxed italic text-muted-foreground/80 whitespace-pre-wrap break-words">
                {thinkingText}
              </p>
            </div>
          )
        )}

        {/* Expanded thinking content */}
        {isThinkingDone && thinkingExpanded && thinkingText && (
          <div className="border border-blue-400/10 rounded-md px-3 py-2 max-h-[200px] overflow-y-auto">
            <p className="text-[11px] leading-relaxed italic text-muted-foreground/70 whitespace-pre-wrap break-words">
              {thinkingText}
            </p>
          </div>
        )}

        {/* Narration zone */}
        {narrationText && (
          <div
            className="border-l-2 border-[#34d68a] px-3 py-1"
            style={{ animation: "fade-up 150ms ease" }}
            data-testid="narration-live-text"
          >
            <p className="text-[12px] leading-relaxed text-foreground/85">
              {narrationText}
            </p>
          </div>
        )}

        {/* File log — last 5 non-thinking entries */}
        {nonThinkingEntries.map((entry, i) => {
          const isWrite = entry.type === "file_write";
          const isRead = entry.type === "file_read";
          const fileName = entry.filePath
            ? entry.filePath.split("/").pop() || entry.filePath
            : entry.label;
          return (
            <div
              key={i}
              className="flex items-center gap-2 text-[11px]"
              style={{ animation: "fade-up 150ms ease" }}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  isWrite ? "bg-[#34d68a]" : isRead ? "bg-[#818cf8]" : "bg-muted-foreground/40"
                )}
              />
              <span className={cn(
                "truncate font-mono",
                isWrite ? "text-[#5fe8a0]" : isRead ? "text-[#818cf8]" : "text-muted-foreground/60"
              )}>
                {fileName}
              </span>
              {isWrite && (
                <span className="shrink-0 text-[9px] text-[#5fe8a0]/60">✓</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
