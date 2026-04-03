import { useState, useRef, useEffect } from "react";
import {
  Brain,
  FilePlus,
  FileSearch,
  Terminal,
  ListChecks,
  Wrench,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  TerminalSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionLogEntry } from "./chat-types";
import { getActionLogColor } from "./chat-utils";

function getActionLogIcon(type: ActionLogEntry["type"]) {
  switch (type) {
    case "thinking":
      return <Brain className="w-3 h-3 shrink-0" />;
    case "file_write":
      return <FilePlus className="w-3 h-3 shrink-0" />;
    case "file_read":
      return <FileSearch className="w-3 h-3 shrink-0" />;
    case "tool_call":
      return <TerminalSquare className="w-3 h-3 shrink-0" />;
    case "terminal_command":
      return <Terminal className="w-3 h-3 shrink-0" />;
    case "step":
      return <ListChecks className="w-3 h-3 shrink-0" />;
    case "narration":
      return <Wrench className="w-3 h-3 shrink-0" />;
    default:
      return <Wrench className="w-3 h-3 shrink-0" />;
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

  return (
    <div className="space-y-0">
      <div
        className={cn("flex items-center gap-1.5 py-0.5 text-[11px]", color)}
      >
        {icon}
        <span className="truncate leading-tight font-medium">{label}</span>
        {isFileEntry && entry.filePath && (
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
      className="max-h-[180px] overflow-y-auto rounded-md bg-muted/20 border border-blue-400/15 px-3 py-2"
      data-testid="thinking-stream"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Brain className="w-3 h-3 shrink-0 text-blue-400 animate-pulse" />
        <span className="text-[10px] font-semibold text-blue-400/80 uppercase tracking-wide">
          Thinking
        </span>
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
  const icon = getActionLogIcon(group.type);

  if (count === 1) {
    return <ActionLogLiveRow entry={group.entries[0]} />;
  }

  const label = getGroupLabel(group.type, count);

  return (
    <div className="border border-border/20 rounded-md overflow-hidden">
      <button
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-muted/30 transition-colors text-left",
          color,
        )}
        onClick={() => setExpanded((e) => !e)}
        data-testid={`grouped-action-${group.type}`}
      >
        <div className="flex items-center -space-x-1">
          {icon}
          {count > 1 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-3.5 min-w-[14px] px-1 rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
              {count}
            </span>
          )}
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
  const color = getActionLogColor(entry.type);
  const icon = getActionLogIcon(entry.type);
  const label =
    entry.label.length > 45 ? entry.label.slice(0, 45) + "…" : entry.label;
  const hasDetail = entry.detail && entry.detail.trim().length > 0;

  const isCodeEntry = entry.type === "file_write" || entry.type === "file_read";

  return (
    <div
      className="border border-border/30 rounded-md overflow-hidden"
      data-testid={`action-chip-${index}`}
    >
      <button
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-muted/30 transition-colors text-left",
          color,
        )}
        onClick={() => hasDetail && setExpanded((e) => !e)}
        disabled={!hasDetail}
        data-testid={`button-action-chip-${index}`}
      >
        {icon}
        <span className="flex-1 truncate leading-tight">{label}</span>
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
  const icon = getActionLogIcon(group.type);

  if (count === 1) {
    return group.entries[0].type === "thinking" ? (
      <CollapsedThinking text={group.entries[0].detail} />
    ) : (
      <ActionLogChip entry={group.entries[0]} index={startIndex} />
    );
  }

  const label = getGroupLabel(group.type, count);

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
        <div className="flex items-center -space-x-1">
          {icon}
          <span className="ml-1.5 inline-flex items-center justify-center h-3.5 min-w-[14px] px-1 rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
            {count}
          </span>
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
