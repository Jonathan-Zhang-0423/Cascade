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
  TerminalSquare,
  GitCompare,
  GitMerge,
  ShieldCheck,
  Zap,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionLogEntry } from "./chat-types";
import { getActionLogColor } from "./chat-utils";
import { useIDEStore } from "@/stores/ide-store";
import { InlineDiffView } from "./InlineDiffView";
import { useT } from "@/lib/i18n";

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
    case "research":
      return <Globe className={cls} />;
    case "terminal_command":
      // >_ glyph matches the terminal aesthetic in the screenshots
      return <span className={cn("font-mono font-bold leading-none shrink-0", small ? "text-[8px]" : "text-[10px]")}>&gt;_</span>;
    case "step":
      return <ListChecks className={cls} />;
    case "code_applied":
      return <GitMerge className={cls} />;
    case "code_review":
      return <ShieldCheck className={cls} />;
    case "capabilities":
      return <Zap className={cls} />;
    case "plan":
      return <ListChecks className={cls} />;
    case "narration":
      return <Wrench className={cls} />;
    default:
      return <Wrench className={cls} />;
  }
}

function getGroupLabel(type: ActionLogEntry["type"], count: number, t: (k: string, v?: Record<string,string>) => string): string {
  switch (type) {
    case "file_write":
      return count === 1 ? t("action.wroteFile") : t("action.wroteFiles", { count: String(count) });
    case "file_read":
      return count === 1 ? t("action.readFile") : t("action.readFiles", { count: String(count) });
    case "tool_call":
      return count === 1 ? t("action.toolCall") : t("action.toolCalls", { count: String(count) });
    case "research":
      return count === 1 ? "Research" : `Research (${count})`;
    case "terminal_command":
      return count === 1 ? t("action.command") : t("action.commands", { count: String(count) });
    default:
      return count === 1 ? t("action.action") : t("action.actions", { count: String(count) });
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
    if (last && last.type === entry.type && entry.type !== "step" && entry.type !== "thinking" && entry.type !== "research") {
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
  const t = useT();
  const color = getActionLogColor(entry.type);
  const icon = getActionLogIcon(entry.type);
  const isFileEntry = entry.type === "file_write" || entry.type === "file_read";
  const isWrite = entry.type === "file_write";
  const isRead = entry.type === "file_read";
  const isResearch = entry.type === "research";

  // Extract filename from path
  const fileName = entry.filePath
    ? entry.filePath.split("/").pop() || entry.filePath
    : entry.label;

  const displayLabel = isFileEntry
    ? fileName
    : entry.label.length > 50
      ? entry.label.slice(0, 50) + "…"
      : entry.label;

  const actionType = isWrite ? t("action.written") : isRead ? t("action.read") : null;

  // Research card: special rendering with cyan border and expandable detail
  if (isResearch) {
    return <ResearchCard entry={entry} />;
  }

  return (
    <div className="space-y-0" style={{ animation: "fade-up 150ms ease" }}>
      <div
        className={cn(
          "flex items-center gap-2 py-2 px-2.5 rounded-md text-[12px] border",
          isWrite
            ? "border-[rgba(52,214,138,0.25)] bg-[rgba(52,214,138,0.08)] shadow-sm"
            : isRead
            ? "border-[rgba(129,140,248,0.15)] bg-[rgba(129,140,248,0.05)]"
            : "border-border/20 bg-border/20"
        )}
        style={isWrite ? { animation: "file-flash 600ms ease-out, fade-up 150ms ease" } : undefined}
      >
        <div className={cn(
          "flex items-center justify-center rounded-md p-1.5 shrink-0",
          isWrite ? "bg-[rgba(52,214,138,0.15)]" : isRead ? "bg-[rgba(129,140,248,0.1)]" : "bg-border/20"
        )}>
          <div className={isWrite ? "text-[#5fe8a0]" : isRead ? "text-[#818cf8]" : "text-muted-foreground/60"}>
            {icon}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn("font-medium truncate leading-tight",
            isWrite ? "text-[#5fe8a0]" : isRead ? "text-[#818cf8]" : "text-foreground/80"
          )}>
            {displayLabel}
          </div>
          {isFileEntry && entry.filePath && (
            <div className="text-[10px] text-muted-foreground/40 truncate font-mono mt-0.5">
              {entry.filePath}
            </div>
          )}
        </div>
        {actionType && (
          <div className={cn(
            "shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded",
            isWrite ? "bg-[rgba(52,214,138,0.15)] text-[#5fe8a0]" : "bg-[rgba(129,140,248,0.1)] text-[#818cf8]"
          )}>
            {actionType}
          </div>
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

/**
 * Research card: shows a search query in progress or completed results.
 * - "Research" label with query → searching state (animated dots)
 * - "Research complete" label with summary → done state (expandable detail)
 */
function ResearchCard({ entry }: { entry: ActionLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isComplete = entry.label.toLowerCase().includes("complete");
  const icon = <Globe className="w-3 h-3 shrink-0" />;

  return (
    <div className="space-y-0" style={{ animation: "fade-up 150ms ease" }}>
      <div
        className={cn(
          "flex items-center gap-2 py-2 px-2.5 rounded-md text-[12px] border",
          isComplete
            ? "border-[rgba(34,211,238,0.25)] bg-[rgba(34,211,238,0.06)]"
            : "border-[rgba(34,211,238,0.15)] bg-[rgba(34,211,238,0.03)]",
        )}
      >
        <div className="flex items-center justify-center rounded-md p-1.5 shrink-0 bg-[rgba(34,211,238,0.12)]">
          <div className="text-cyan-400">
            {icon}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate leading-tight text-cyan-300">
            {isComplete ? "Research complete" : `🔍 ${entry.detail || entry.label}`}
          </div>
          {isComplete && entry.detail && (
            <div className="text-[10px] text-cyan-400/60 truncate mt-0.5">
              {entry.detail}
            </div>
          )}
        </div>
        {!isComplete && (
          <div className="flex items-center gap-[3px] shrink-0">
            <span className="w-[4px] h-[4px] rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: "0ms" }} />
            <span className="w-[4px] h-[4px] rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="w-[4px] h-[4px] rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
        )}
        {isComplete && (
          <button
            className="shrink-0 text-cyan-400/60 hover:text-cyan-300 transition-colors p-0.5"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
      </div>
      {expanded && isComplete && entry.detail && (
        <div className="border border-t-0 border-[rgba(34,211,238,0.15)] rounded-b-md px-3 py-2 bg-[rgba(34,211,238,0.02)]">
          <p className="text-[11px] leading-relaxed text-muted-foreground/70 whitespace-pre-wrap break-words">
            {entry.detail}
          </p>
        </div>
      )}
    </div>
  );
}

export function ThinkingStream({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <div
      ref={containerRef}
      className="max-h-[180px] overflow-y-auto rounded-md px-3 py-2"
      style={{
        background: "rgba(129,140,248,0.06)",
        border: "1px solid rgba(129,140,248,0.12)",
        animation: "fade-up 150ms ease",
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
        {text}
      </p>
    </div>
  );
}

export function CollapsedThinking({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  return (
    <div
      className="rounded-md border border-blue-400/15 overflow-hidden"
      data-testid="collapsed-thinking"
    >
      <button
        className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-blue-400/70 hover:bg-border/20 transition-colors text-left"
        onClick={() => setExpanded((e) => !e)}
        data-testid="button-expand-thinking"
      >
        <Brain className="w-3 h-3 shrink-0" />
        <span className="flex-1 truncate leading-tight font-medium">
          {t("action.thinking")}
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
  const t = useT();

  // Single entry: just render it directly, no grouping
  if (count === 1) {
    return <ActionLogLiveRow entry={group.entries[0]} />;
  }

  // Multiple file reads: show as collapsible list
  if (group.type === "file_read" && count > 1) {
    const fileNames = group.entries
      .map(e => e.filePath?.split("/").pop() || e.label)
      .filter(Boolean)
      .slice(0, 4)
      .join(", ");

    return (
      <div className="space-y-1">
        {expanded ? (
          <>
            {group.entries.map((entry, i) => (
              <ActionLogLiveRow key={i} entry={entry} />
            ))}
            <button
              className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors flex items-center gap-1 mt-1"
              onClick={() => setExpanded(false)}
            >
              <ChevronUp className="w-3 h-3" />
              {t("action.collapse")}
            </button>
          </>
        ) : (
          <button
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[12px] border border-[rgba(129,140,248,0.15)] bg-[rgba(129,140,248,0.04)] hover:bg-[rgba(129,140,248,0.08)] transition-colors text-left text-[#818cf8]"
            onClick={() => setExpanded(true)}
            style={{ animation: "fade-up 150ms ease" }}
          >
            <div className="flex items-center justify-center rounded p-1.5 bg-[rgba(129,140,248,0.1)]">
              <FileSearch className="w-3 h-3 text-[#818cf8]" />
            </div>
            <div className="flex-1">
              <div className="font-medium">{t("action.readFilesGroup", { count: String(count) })}</div>
              {fileNames && (
                <div className="text-[10px] text-muted-foreground/40 truncate font-mono mt-0.5">{fileNames}</div>
              )}
            </div>
            <ChevronDown className="w-3 h-3 text-muted-foreground/40" />
          </button>
        )}
      </div>
    );
  }

  // Multiple file writes: show all distinct rows, no grouping
  if (group.type === "file_write") {
    return (
      <div className="space-y-1">
        {group.entries.map((entry, i) => (
          <ActionLogLiveRow key={i} entry={entry} showCodePreview={i === group.entries.length - 1} />
        ))}
      </div>
    );
  }

  // Other types: render all entries in a list
  return (
    <div className="space-y-1">
      {group.entries.map((entry, i) => (
        <ActionLogLiveRow key={i} entry={entry} />
      ))}
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
  const t = useT();

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
          className="rounded-md border-l-2 border-[#34d68a] bg-[rgba(52,214,138,0.04)] px-3 py-2 mb-1"
          style={{ animation: "fade-up 150ms ease" }}
          data-testid="narration-live-text"
        >
          <div className="flex items-center gap-2 mb-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34d68a] animate-pulse shrink-0" />
            <span className="text-[10px] font-medium text-[#34d68a]/70 uppercase tracking-wide">
              {t("action.live")}
            </span>
          </div>
          <p className="text-[12px] leading-relaxed text-foreground/85 font-mono">
            {narrationText}
          </p>
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
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const lastBuildFileDiffs = useIDEStore((s) => s.lastBuildFileDiffs);
  const icon = getActionLogIcon(entry.type);
  const isCodeEntry = entry.type === "file_write" || entry.type === "file_read";
  const isWrite = entry.type === "file_write";
  const isRead = entry.type === "file_read";
  const hasDetail = entry.detail && entry.detail.trim().length > 0;

  const fileName = entry.filePath
    ? entry.filePath.split("/").pop() || entry.filePath
    : entry.label;
  const displayLabel = isCodeEntry
    ? fileName
    : entry.label.length > 45
      ? entry.label.slice(0, 45) + "…"
      : entry.label;

  const fileDiff = entry.type === "file_write" && entry.filePath
    ? lastBuildFileDiffs[entry.filePath]
    : undefined;

  const actionType = isWrite ? t("action.written") : isRead ? t("action.read") : null;

  return (
    <div
      className={cn(
        "rounded-md overflow-hidden animate-in fade-in duration-200 border",
        isWrite
          ? "border-[rgba(52,214,138,0.25)] bg-[rgba(52,214,138,0.05)]"
          : isRead
          ? "border-[rgba(129,140,248,0.15)] bg-[rgba(129,140,248,0.04)]"
          : "border-border/30 bg-card/20"
      )}
      data-testid={`action-chip-${index}`}
    >
      <button
        className={cn(
          "w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] hover:bg-border/20 transition-colors text-left group"
        )}
        onClick={() => hasDetail && setExpanded((e) => !e)}
        disabled={!hasDetail && !fileDiff}
        data-testid={`button-action-chip-${index}`}
      >
        <div className={cn(
          "flex items-center justify-center rounded p-1 shrink-0",
          isWrite ? "bg-[rgba(52,214,138,0.15)]" : isRead ? "bg-[rgba(129,140,248,0.1)]" : "bg-border/20"
        )}>
          <div className={isWrite ? "text-[#5fe8a0]" : isRead ? "text-[#818cf8]" : "text-muted-foreground/60"}>
            {icon}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn("font-medium truncate leading-tight",
            isWrite ? "text-[#5fe8a0]" : isRead ? "text-[#818cf8]" : "text-foreground/80"
          )}>
            {displayLabel}
          </div>
          {isCodeEntry && entry.filePath && (
            <div className="text-[9px] text-muted-foreground/35 truncate font-mono mt-0.5">
              {entry.filePath}
            </div>
          )}
        </div>
        {actionType && (
          <div className={cn(
            "shrink-0 text-[9px] font-medium px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity",
            isWrite ? "bg-[rgba(52,214,138,0.15)] text-[#5fe8a0]" : "bg-[rgba(129,140,248,0.1)] text-[#818cf8]"
          )}>
            {actionType}
          </div>
        )}
        {fileDiff && (
          <button
            className="shrink-0 flex items-center justify-center p-1 rounded hover:bg-border/20 transition-colors"
            onClick={(e) => { e.stopPropagation(); setDiffExpanded((d) => !d); }}
            data-testid={`button-diff-${index}`}
          >
            <GitCompare className="w-3 h-3 text-muted-foreground/50 hover:text-foreground" />
          </button>
        )}
        {(hasDetail || fileDiff) && (
          <span className="shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors">
            {expanded || diffExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
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
  const t = useT();

  if (count === 1) {
    return group.entries[0].type === "thinking" ? (
      <CollapsedThinking text={group.entries[0].detail} />
    ) : (
      <ActionLogChip entry={group.entries[0]} index={startIndex} />
    );
  }

  const label = getGroupLabel(group.type, count, t);
  const previewIcons = group.entries.slice(0, 3);

  return (
    <div
      className="border border-border/30 rounded-md overflow-hidden"
      data-testid={`grouped-collapsed-${group.type}-${startIndex}`}
    >
      <button
        className={cn(
          "w-full flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-border/20 transition-colors text-left",
          getActionLogColor(group.type),
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
  const t = useT();

  let runningIndex = 0;

  return (
    <div className="px-3 py-2 space-y-1" data-testid="action-log-collapsed">
      <div className="flex items-center gap-1.5 mb-1.5">
        <ListChecks className="w-3 h-3 text-muted-foreground/60" />
        <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
          {t("action.actions2", { count: String(entries.length) })}
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
          {t("action.showMore", { count: String(groups.length - 6) })}
        </button>
      )}
      {showAll && hasMore && (
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mt-1"
          onClick={() => setShowAll(false)}
          data-testid="button-collapse-actions"
        >
          <ChevronUp className="w-3 h-3" />
          {t("action.collapse")}
        </button>
      )}
    </div>
  );
}
