import { useState, useRef, useEffect } from "react";
import {
  Brain,
  FilePlus,
  FileSearch,
  ListChecks,
  Wrench,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  TerminalSquare,
  GitCompare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionLogEntry } from "./chat-types";
import { getActionLogColor } from "./chat-utils";
import { useIDEStore } from "@/stores/ide-store";
import { InlineDiffView } from "./InlineDiffView";

function getActionLogIcon(type: ActionLogEntry["type"], small?: boolean) {
  const cls = small ? "w-2.5 h-2.5 shrink-0" : "w-3 h-3 shrink-0";
  switch (type) {
    case "thinking":
      return <Brain className={cls} />;
    case "file_write":
      return <FilePlus className={cls} />;
    case "file_read":
      return <FileSearch className={cls} />;
    case "tool_call":
      return <TerminalSquare className={cls} />;
    case "terminal_command":
      // >_ glyph matches the terminal aesthetic in the screenshots
      return <span className={cn("font-mono font-bold leading-none shrink-0", small ? "text-[8px]" : "text-[10px]")}>&gt;_</span>;
    case "step":
      return <ListChecks className={cls} />;
    case "narration":
      return <Wrench className={cls} />;
    default:
      return <Wrench className={cls} />;
  }
}

function getGroupLabel(type: ActionLogEntry["type"], count: number): string {
  switch (type) {
    case "file_write":
      return count === 1 ? "Wrote 1 file" : `Wrote ${count} files`;
    case "file_read":
      return count === 1 ? "Read 1 file" : `Read ${count} files`;
    case "tool_call":
      return count === 1 ? "1 tool call" : `${count} tool calls`;
    case "terminal_command":
      return count === 1 ? "1 command" : `${count} commands`;
    default:
      return count === 1 ? "1 action" : `${count} actions`;
  }
}

interface ActionGroup {
  type: ActionLogEntry["type"];
  entries: ActionLogEntry[];
}

function groupConsecutiveEntries(entries: ActionLogEntry[]): ActionGroup[] {
  const groups: ActionGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.type === entry.type && entry.type !== "step" && entry.type !== "thinking") {
      last.entries.push(entry);
    } else {
      groups.push({ type: entry.type, entries: [entry] });
    }
  }
  return groups;
}

export function ActionLogLiveRow({
  entry,
  showCodePreview,
}: {
  entry: ActionLogEntry;
  showCodePreview?: boolean;
}) {
  const color = getActionLogColor(entry.type);
  const icon = getActionLogIcon(entry.type);
  const label =
    entry.label.length > 50 ? entry.label.slice(0, 50) + "…" : entry.label;
  const isFileEntry = entry.type === "file_write" || entry.type === "file_read";
  const isWrite = entry.type === "file_write";

  const writeStatusLabel = isWrite
    ? (entry.label.toLowerCase().includes("edit") ||
       entry.label.toLowerCase().includes("updat") ||
       entry.label.toLowerCase().includes("modif"))
      ? "edited" : "created"
    : null;

  return (
    <div className="space-y-0" style={{ animation: "fade-up 150ms ease" }}>
      <div
        className={cn(
          "flex items-center gap-1.5 py-[5px] text-[12px]",
          isWrite
            ? "border-l-2 border-green-500 bg-[#0d1f12] px-2"
            : color,
        )}
        style={isWrite ? { animation: "file-flash 600ms ease-out, fade-up 150ms ease" } : undefined}
      >
        {icon}
        <span className={cn("truncate leading-tight font-medium", isWrite ? "text-green-400 font-medium" : "")}>
          {label}
        </span>
        {isWrite && writeStatusLabel && (
          <span className="ml-auto shrink-0 text-green-600 text-[11px]">{writeStatusLabel}</span>
        )}
        {!isWrite && isFileEntry && entry.filePath && (
          <span className="ml-auto shrink-0 text-muted-foreground/40 text-[10px] font-mono">
            {entry.filePath}
          </span>
        )}
      </div>
      {showCodePreview &&
        isFileEntry &&
        entry.detail &&
        entry.detail.trim().length > 0 && (
          <div
            className="rounded overflow-hidden text-[10px] font-mono leading-relaxed max-h-[120px] overflow-y-hidden relative"
            style={{ backgroundColor: "#1E1E1E", color: "#D4D4D4" }}
          >
            <div
              className="absolute inset-x-0 bottom-0 h-8 pointer-events-none"
              style={{ background: "linear-gradient(transparent, #1E1E1E)" }}
            />
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <tbody>
                {entry.detail
                  .split("\n")
                  .slice(0, 20)
                  .map((line, li) => (
                    <tr key={li} style={{ height: "17px" }}>
                      <td
                        className="select-none text-right sticky left-0"
                        style={{
                          padding: "0 5px",
                          color: "#858585",
                          width: "32px",
                          minWidth: "32px",
                          borderRight: "1px solid #333",
                          backgroundColor: "#1E1E1E",
                        }}
                      >
                        {li + 1}
                      </td>
                      <td style={{ padding: "0 8px", whiteSpace: "pre" }}>
                        <code>{line}</code>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

export function ThinkingStream({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <div
      ref={containerRef}
      className="max-h-[180px] overflow-y-auto rounded-md bg-[#1a1a2e] border border-indigo-900/50 px-3 py-2"
      data-testid="thinking-stream"
      style={{ animation: "fade-up 150ms ease" }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Brain className="w-3 h-3 shrink-0 text-indigo-400" />
        <span className="text-[11px] font-medium text-indigo-400 uppercase tracking-wide flex-1">
          Thinking
        </span>
        <div className="flex items-center gap-[3px]">
          <span className="w-[4px] h-[4px] rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: "0ms" }} />
          <span className="w-[4px] h-[4px] rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: "150ms" }} />
          <span className="w-[4px] h-[4px] rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
      <p className="text-[12px] leading-relaxed italic text-muted-foreground/80 whitespace-pre-wrap break-words">
        {text}
      </p>
    </div>
  );
}

export function CollapsedThinking({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded-md border border-blue-400/15 overflow-hidden"
      data-testid="collapsed-thinking"
    >
      <button
        className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-blue-400/70 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpanded((e) => !e)}
        data-testid="button-expand-thinking"
      >
        <Brain className="w-3 h-3 shrink-0" />
        <span className="flex-1 truncate leading-tight font-medium">
          Thinking
        </span>
        <span className="shrink-0 text-muted-foreground/40">
          {expanded ? (
            <ChevronDown className="w-2.5 h-2.5" />
          ) : (
            <ChevronRight className="w-2.5 h-2.5" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-blue-400/10 px-3 py-2 max-h-[200px] overflow-y-auto">
          <p className="text-[11px] leading-relaxed italic text-muted-foreground/70 whitespace-pre-wrap break-words">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}

function GroupedActionRow({ group }: { group: ActionGroup }) {
  const [expanded, setExpanded] = useState(false);
  const count = group.entries.length;
  const color = getActionLogColor(group.type);

  if (count === 1) {
    return <ActionLogLiveRow entry={group.entries[0]} />;
  }

  // Collapsed view for consecutive file reads
  if (group.type === "file_read" && count > 1) {
    const fileNames = group.entries
      .map(e => e.filePath?.split("/").pop() || e.label)
      .filter(Boolean)
      .slice(0, 4)
      .join(", ");
    return (
      <div
        className="flex items-center gap-1.5 py-[5px] px-1 text-[12px] rounded-md"
        style={{ animation: "fade-up 150ms ease" }}
      >
        {getActionLogIcon("file_read")}
        <span className="text-muted-foreground/60">Read {count} files</span>
        {fileNames && (
          <span className="text-muted-foreground/30 text-[11px] truncate ml-1">{fileNames}</span>
        )}
      </div>
    );
  }

  const label = getGroupLabel(group.type, count);
  // Show up to 3 icons from individual entries to give a glanceable signature
  const previewIcons = group.entries.slice(0, 3);

  return (
    <div className="border border-border/20 rounded-md overflow-hidden" style={{ animation: "fade-up 150ms ease" }}>
      <button
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-muted/30 transition-colors text-left",
          color,
        )}
        onClick={() => setExpanded((e) => !e)}
        data-testid={`grouped-action-${group.type}`}
      >
        {/* Multi-icon strip: shows distinct entry icons side-by-side */}
        <div className="flex items-center gap-0.5 shrink-0">
          {previewIcons.map((entry, i) => (
            <span key={i} className="opacity-80">
              {getActionLogIcon(entry.type, true)}
            </span>
          ))}
        </div>
        <span className="flex-1 truncate leading-tight font-medium">{label}</span>
        <span className="shrink-0 text-muted-foreground/40">
          {expanded ? (
            <ChevronDown className="w-2.5 h-2.5" />
          ) : (
            <ChevronRight className="w-2.5 h-2.5" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/15 px-2 py-1 space-y-0.5">
          {group.entries.map((entry, i) => (
            <ActionLogLiveRow key={i} entry={entry} showCodePreview={i === group.entries.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ActionLogLive({
  entries,
  thinkingText,
  narrationText,
}: {
  entries: ActionLogEntry[];
  thinkingText?: string;
  narrationText?: string;
}) {
  const last5 = entries.slice(-5);

  const thinkingEntries = entries.filter((e) => e.type === "thinking");
  const nonThinkingEntries = last5.filter((e) => e.type !== "thinking");
  const groups = groupConsecutiveEntries(nonThinkingEntries);

  return (
    <div className="px-3 py-2 space-y-1.5" data-testid="action-log-live">
      {thinkingText && <ThinkingStream text={thinkingText} />}
      {!thinkingText &&
        thinkingEntries.map((entry, i) => (
          <CollapsedThinking key={`t-${i}`} text={entry.detail} />
        ))}
      {narrationText && !thinkingText && (
        <div
          className="flex items-start gap-1.5 py-0.5 text-[11px]"
          data-testid="narration-live-text"
        >
          <MessageSquare className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground/50" />
          <span className="leading-relaxed text-foreground/70 line-clamp-3">
            {narrationText}
          </span>
        </div>
      )}
      {groups.map((group, i) => (
        <GroupedActionRow key={i} group={group} />
      ))}
    </div>
  );
}

export function ActionLogChip({
  entry,
  index,
}: {
  entry: ActionLogEntry;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const lastBuildFileDiffs = useIDEStore((s) => s.lastBuildFileDiffs);
  const color = getActionLogColor(entry.type);
  const icon = getActionLogIcon(entry.type);
  const label =
    entry.label.length > 45 ? entry.label.slice(0, 45) + "…" : entry.label;
  const hasDetail = entry.detail && entry.detail.trim().length > 0;

  const isCodeEntry = entry.type === "file_write" || entry.type === "file_read";
  const fileDiff = entry.type === "file_write" && entry.filePath
    ? lastBuildFileDiffs[entry.filePath]
    : undefined;

  return (
    <div
      className="border border-border/30 rounded-md overflow-hidden animate-in fade-in duration-200"
      data-testid={`action-chip-${index}`}
    >
      <button
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-muted/30 transition-colors text-left",
          color,
        )}
        onClick={() => hasDetail && setExpanded((e) => !e)}
        disabled={!hasDetail && !fileDiff}
        data-testid={`button-action-chip-${index}`}
      >
        {icon}
        <span className="flex-1 truncate leading-tight">{label}</span>
        {fileDiff && (
          <button
            className="shrink-0 flex items-center gap-0.5 text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors px-1"
            onClick={(e) => { e.stopPropagation(); setDiffExpanded((d) => !d); }}
            data-testid={`button-diff-${index}`}
          >
            <GitCompare className="w-2.5 h-2.5" />
          </button>
        )}
        {hasDetail && (
          <span className="shrink-0 text-muted-foreground/40">
            {expanded ? (
              <ChevronDown className="w-2.5 h-2.5" />
            ) : (
              <ChevronRight className="w-2.5 h-2.5" />
            )}
          </span>
        )}
      </button>
      {diffExpanded && fileDiff && (
        <div className="border-t border-border/20 px-2 py-1.5">
          <InlineDiffView oldContent={fileDiff.old} newContent={fileDiff.new} />
        </div>
      )}
      {expanded && hasDetail && (
        <div className="border-t border-border/20">
          {isCodeEntry ? (
            <div
              className="overflow-x-auto max-h-[200px] overflow-y-auto text-[10px] font-mono leading-relaxed"
              style={{ backgroundColor: "#1E1E1E", color: "#D4D4D4" }}
            >
              <table className="w-full" style={{ borderCollapse: "collapse" }}>
                <tbody>
                  {entry.detail.split("\n").map((line, li) => (
                    <tr key={li} style={{ height: "18px" }}>
                      <td
                        className="select-none text-right sticky left-0"
                        style={{
                          padding: "0 6px",
                          color: "#858585",
                          width: "36px",
                          minWidth: "36px",
                          borderRight: "1px solid #333333",
                          backgroundColor: "#1E1E1E",
                        }}
                      >
                        {li + 1}
                      </td>
                      <td style={{ padding: "0 10px", whiteSpace: "pre" }}>
                        <code>{line}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground/80 whitespace-pre-wrap leading-relaxed max-h-[120px] overflow-y-auto">
              {entry.detail}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsedGroupedRow({ group, startIndex }: { group: ActionGroup; startIndex: number }) {
  const [expanded, setExpanded] = useState(false);
  const count = group.entries.length;
  const color = getActionLogColor(group.type);

  if (count === 1) {
    return group.entries[0].type === "thinking" ? (
      <CollapsedThinking text={group.entries[0].detail} />
    ) : (
      <ActionLogChip entry={group.entries[0]} index={startIndex} />
    );
  }

  const label = getGroupLabel(group.type, count);
  const previewIcons = group.entries.slice(0, 3);

  return (
    <div
      className="border border-border/30 rounded-md overflow-hidden"
      data-testid={`grouped-collapsed-${group.type}-${startIndex}`}
    >
      <button
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-muted/30 transition-colors text-left",
          color,
        )}
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-0.5 shrink-0">
          {previewIcons.map((entry, i) => (
            <span key={i} className="opacity-80">
              {getActionLogIcon(entry.type, true)}
            </span>
          ))}
        </div>
        <span className="flex-1 truncate leading-tight font-medium">{label}</span>
        <span className="shrink-0 text-muted-foreground/40">
          {expanded ? (
            <ChevronDown className="w-2.5 h-2.5" />
          ) : (
            <ChevronRight className="w-2.5 h-2.5" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/15 space-y-1 px-1 py-1">
          {group.entries.map((entry, i) => (
            <ActionLogChip key={i} entry={entry} index={startIndex + i} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ActionLogCollapsed({ entries }: { entries: ActionLogEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  const groups = groupConsecutiveEntries(entries);
  const displayGroups = showAll ? groups : groups.slice(0, 6);
  const hasMore = groups.length > 6;

  let runningIndex = 0;

  return (
    <div className="px-3 py-2 space-y-1" data-testid="action-log-collapsed">
      <div className="flex items-center gap-1.5 mb-1.5">
        <ListChecks className="w-3 h-3 text-muted-foreground/60" />
        <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
          Actions ({entries.length})
        </span>
      </div>
      {displayGroups.map((group, i) => {
        const idx = runningIndex;
        runningIndex += group.entries.length;
        return <CollapsedGroupedRow key={i} group={group} startIndex={idx} />;
      })}
      {hasMore && !showAll && (
        <button
          className="text-[10px] text-primary/70 hover:text-primary transition-colors flex items-center gap-1 mt-1"
          onClick={() => setShowAll(true)}
          data-testid="button-show-all-actions"
        >
          <ChevronDown className="w-3 h-3" />
          Show {groups.length - 6} more groups
        </button>
      )}
      {showAll && hasMore && (
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mt-1"
          onClick={() => setShowAll(false)}
          data-testid="button-collapse-actions"
        >
          <ChevronUp className="w-3 h-3" />
          Collapse
        </button>
      )}
    </div>
  );
}
