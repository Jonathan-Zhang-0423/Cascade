import { useState, useEffect, useMemo, memo } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  FileText,
  PencilLine,
  Wrench,
  Terminal,
  Sparkles,
  Circle,
  Clock,
  ChevronRight,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import type { ActionLogEntry, NarrationSegment } from "./chat-types";

interface BuildLivePanelProps {
  entries: ActionLogEntry[];
  thinkingText?: string;
  narrationText?: string;
  thinkingElapsedSec?: number | null;
  /** Persisted, narration-bound segments. When present the panel renders these
   *  instead of deriving live segments from `entries`. */
  segments?: NarrationSegment[];
  /** True once the build has finished — switches the panel into a settled,
   *  fully-collapsible view and reveals the cost summary card. */
  isCompleted?: boolean;
}

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function BrailleSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setFrame((f) => (f + 1) % BRAILLE_FRAMES.length),
      80,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-[#818cf8]">
      {BRAILLE_FRAMES[frame % BRAILLE_FRAMES.length]}
    </span>
  );
}

// ── A. stripMarkdown ──────────────────────────────────────────────────────
// Narration is meant to be plain Chinese prose. Strip any stray markdown the
// model emits (**, ##, lists, links, code spans, tables, rules) so it renders
// as clean sentences.
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/_{1,2}(.+?)_{1,2}/g, "$1")
    .replace(/\|.+\|/g, "")
    .replace(/^-{3,}$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── B. NarrationLine ──────────────────────────────────────────────────────
const NarrationLine = memo(function NarrationLine({ line }: { line: string }) {
  if (line.startsWith("• ")) {
    return (
      <div className="flex items-start gap-1.5">
        <span className="text-muted-foreground/60 shrink-0">•</span>
        <span>{line.slice(2)}</span>
      </div>
    );
  }
  return <p>{line}</p>;
});

// ── C. NarrationBlock ─────────────────────────────────────────────────────
// Multi-line narration. No leading green dot — just plain stacked lines.
function NarrationBlock({ text, isLive }: { text: string; isLive?: boolean }) {
  const clean = stripMarkdown(text);
  const lines = clean.split("\n").filter((l) => l.trim());
  if (lines.length === 0 && !isLive) return null;
  return (
    <div
      className="px-3.5 py-1 font-mono text-[12px] leading-[1.6] text-muted-foreground space-y-0.5"
      data-testid="narration-block"
    >
      {lines.map((line, i) => (
        <NarrationLine key={i} line={line} />
      ))}
      {isLive && (
        <span className="inline-flex items-center gap-1 text-[rgba(129,140,248,0.7)]">
          <BrailleSpinner />
        </span>
      )}
    </div>
  );
}

// ── D. extractThinkingNarration ───────────────────────────────────────────
// Map raw English chain-of-thought to a short Chinese summary so we never
// surface untranslated thinking text in the timeline.
function extractThinkingNarration(text: string): string {
  const t = (text || "").toLowerCase();
  if (/request_review|代码审查/.test(t)) return "正在请求代码审查";
  if (/\bfix\b|bug|debug|error|修复/.test(t)) return "正在定位并修复问题";
  if (/user.*(message|ask|request|need)|理解用户/.test(t)) return "正在理解用户需求";
  if (/implement|create|build|实现/.test(t)) return "正在实现功能代码";
  if (/read.*file|check.*file|analyze.*file|读取|分析文件/.test(t)) return "正在分析文件结构";
  if (/step by step|\bplan\b|规划/.test(t)) return "正在规划执行步骤";
  if (/test|verify|validate|验证/.test(t)) return "正在验证代码逻辑";
  if (/style|css|layout|\bui\b|样式|界面/.test(t)) return "正在调整界面样式";
  if (/api|endpoint|fetch|接口/.test(t)) return "正在处理接口逻辑";
  return "正在思考解决方案";
}

// ── E. getActionNarration ─────────────────────────────────────────────────
const TOOL_NARRATION: Record<string, string> = {
  read_file: "读取文件",
  write_file: "编辑文件",
  patch_file: "修改文件",
  hash_patch_file: "修改文件",
  ast_search: "搜索代码结构",
  ast_replace: "替换代码结构",
  lsp_diagnostics: "检查类型错误",
  lsp_find_references: "查找符号引用",
  lsp_goto_definition: "跳转到定义",
  shell_run: "运行命令",
  run_tests: "运行测试",
};

// Tools that are pure control-flow signals — never shown as user-facing actions.
const HIDDEN_TOOLS = new Set([
  "mark_step_complete",
  "request_review",
  "submit_verdict",
  "submit_plan",
  "report_issue",
]);

function fileName(entry: ActionLogEntry): string {
  if (entry.filePath) return entry.filePath.split("/").pop() || entry.filePath;
  return entry.label || "";
}

function getActionNarration(entry: ActionLogEntry): string {
  switch (entry.type) {
    case "file_read":
      return `读取了 ${fileName(entry)}`;
    case "file_write":
      return `编辑了 ${fileName(entry)}`;
    case "thinking":
      return extractThinkingNarration(entry.detail);
    case "tool_call":
      return TOOL_NARRATION[entry.label] || `调用了 ${entry.label}`;
    case "terminal_command":
      return `执行命令：${entry.label}`;
    default:
      return entry.label || "";
  }
}

// ── F. getActionDetail ────────────────────────────────────────────────────
interface ActionDetail {
  rows: { k: string; v: string }[];
  content?: string;
}

function getActionDetail(entry: ActionLogEntry): ActionDetail {
  switch (entry.type) {
    case "file_read":
      return {
        rows: entry.filePath ? [{ k: "路径", v: entry.filePath }] : [],
        content: entry.detail ? entry.detail.slice(0, 2000) : undefined,
      };
    case "file_write":
      return { rows: entry.filePath ? [{ k: "路径", v: entry.filePath }] : [] };
    case "tool_call":
      return { rows: entry.label ? [{ k: "工具", v: entry.label }] : [] };
    case "terminal_command":
      return {
        rows: [{ k: "命令", v: (entry.detail || entry.label || "").slice(0, 100) }],
      };
    default:
      return { rows: [] };
  }
}

// ── H. toDisplayType ──────────────────────────────────────────────────────
type ActionType = "thinking" | "read" | "edit" | "tool" | "terminal" | "other";

function toDisplayType(raw: string): ActionType {
  switch (raw) {
    case "thinking":
      return "thinking";
    case "file_read":
      return "read";
    case "file_write":
      return "edit";
    case "tool_call":
      return "tool";
    case "terminal_command":
      return "terminal";
    default:
      return "other";
  }
}

const ACTION_META: Record<ActionType, { icon: LucideIcon; color: string }> = {
  thinking: { icon: Sparkles, color: "text-[#818cf8]" },
  read: { icon: FileText, color: "text-[rgba(238,238,246,0.45)]" },
  edit: { icon: PencilLine, color: "text-[#34d68a]" },
  tool: { icon: Wrench, color: "text-[#4f82ff]" },
  terminal: { icon: Terminal, color: "text-[#f59e0b]" },
  other: { icon: Circle, color: "text-muted-foreground/60" },
};

// ── G. ActionDetailRow ────────────────────────────────────────────────────
// Single collapsible action: [chevron] [icon] [Chinese narration].
// Wrapped in memo so parent re-renders (e.g. on scroll) don't reset the
// per-row expanded state.
const ActionDetailRow = memo(function ActionDetailRow({
  entry,
}: {
  entry: ActionLogEntry;
}) {
  const [open, setOpen] = useState(false);
  const dt = toDisplayType(entry.type);
  const meta = ACTION_META[dt];
  const Icon = meta.icon;
  const narration = getActionNarration(entry);
  const detail = getActionDetail(entry);

  return (
    <div className="font-mono text-[11px]" data-testid="action-detail-row">
      <button
        className="flex items-center gap-1.5 w-full text-left py-px text-[rgba(238,238,246,0.6)] hover:text-foreground/90 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-[9px] text-[rgba(238,238,246,0.3)] w-2 shrink-0">
          {open ? "▾" : "▸"}
        </span>
        <span className="w-6 h-6 flex items-center justify-center shrink-0">
          <Icon className={cn("w-3.5 h-3.5", meta.color)} />
        </span>
        <span className="truncate">{narration}</span>
      </button>
      {open && (
        <div className="pl-[34px] pb-1 space-y-0.5">
          {entry.type === "thinking" ? (
            <p className="text-[10px] text-[rgba(129,140,248,0.55)] italic whitespace-pre-wrap break-words leading-relaxed max-h-[160px] overflow-y-auto">
              {entry.detail}
            </p>
          ) : (
            <>
              {detail.rows.map((r, i) => (
                <div key={i} className="flex gap-1.5 text-[10px]">
                  <span className="text-[rgba(238,238,246,0.3)] shrink-0">
                    {r.k}：
                  </span>
                  <span className="text-[rgba(238,238,246,0.55)] break-all">
                    {r.v}
                  </span>
                </div>
              ))}
              {detail.content && (
                <pre className="text-[9.5px] text-muted-foreground/70 whitespace-pre-wrap break-words leading-snug max-h-[180px] overflow-y-auto bg-[var(--panel-mid-bg)] rounded px-1.5 py-1">
                  {detail.content}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

// ── I. SegmentView ────────────────────────────────────────────────────────
// One narration paragraph plus the actions that ran under it. Collapsed by
// default into an icon bar + count; expands to the full ActionDetailRow list.
// memo-wrapped so scrolling the chat never collapses an expanded segment.
const SegmentView = memo(function SegmentView({
  segment,
}: {
  segment: NarrationSegment;
}) {
  const [expanded, setExpanded] = useState(false);
  const { narration, actions, isLive } = segment;
  const visibleActions = actions.filter(
    (a) => !(a.type === "tool_call" && HIDDEN_TOOLS.has(a.label)),
  );

  return (
    <div className="mb-0.5" data-testid="segment-view">
      {narration && <NarrationBlock text={narration} isLive={isLive} />}
      {visibleActions.length > 0 && (
        <div className="px-3.5">
          {!expanded ? (
            <button
              className="flex items-center gap-1.5 py-0.5 text-[rgba(238,238,246,0.45)] hover:text-[rgba(238,238,246,0.7)] transition-colors font-mono text-[11px]"
              onClick={() => setExpanded(true)}
              data-testid="segment-collapsed"
            >
              <span className="flex items-center gap-0.5">
                {visibleActions.slice(0, 6).map((a, i) => {
                  const isLastShown = i === Math.min(visibleActions.length, 6) - 1;
                  const meta = ACTION_META[toDisplayType(a.type)];
                  const Icon = meta.icon;
                  return (
                    <span key={i} className="inline-flex items-center gap-0.5">
                      <Icon className={cn("w-3 h-3", meta.color)} />
                      {isLive && isLastShown && (
                        <span className="ml-0.5">
                          <BrailleSpinner />
                        </span>
                      )}
                    </span>
                  );
                })}
              </span>
              <span>{visibleActions.length} 个操作</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          ) : (
            <div>
              <button
                className="flex items-center gap-1 py-0.5 text-muted-foreground/70 hover:text-[rgba(238,238,246,0.7)] transition-colors font-mono text-[11px]"
                onClick={() => setExpanded(false)}
                data-testid="segment-expanded"
              >
                <ChevronDown className="w-3 h-3" />
                <span>收起</span>
              </button>
              <div className="border-l border-[rgba(255,255,255,0.06)] ml-1 pl-2 mt-0.5">
                {visibleActions.map((a, i) => (
                  <ActionDetailRow key={i} entry={a} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ── J. CostSummary ────────────────────────────────────────────────────────
function formatDuration(sec: number): string {
  if (sec <= 0) return "0 秒";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

function CostSummary({
  entries,
  elapsedSec,
}: {
  entries: ActionLogEntry[];
  elapsedSec?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const stats = useMemo(() => {
    const reads = entries.filter((e) => e.type === "file_read");
    const writes = entries.filter((e) => e.type === "file_write");
    const ops = entries.filter(
      (e) =>
        e.type !== "step" &&
        e.type !== "narration" &&
        e.type !== "thinking",
    ).length;
    const readFiles = new Set(reads.map((r) => r.filePath || r.label)).size;
    const editFiles = new Set(writes.map((w) => w.filePath || w.label)).size;
    const readLines = reads.reduce(
      (n, r) => n + (r.detail ? r.detail.split("\n").length : 0),
      0,
    );
    let durSec = elapsedSec ?? 0;
    if (!durSec && entries.length > 1) {
      durSec = Math.round(
        (entries[entries.length - 1].timestamp - entries[0].timestamp) / 1000,
      );
    }
    return { ops, readFiles, editFiles, readLines, durSec: Math.max(0, durSec) };
  }, [entries, elapsedSec]);

  return (
    <div className="px-3.5 pt-1" data-testid="cost-summary">
      <button
        className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60 hover:text-[rgba(238,238,246,0.6)] transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <Clock className="w-2.5 h-2.5" />
        <span>共用时 {formatDuration(stats.durSec)}</span>
        <ChevronRight
          className={cn("w-2.5 h-2.5 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-1 pl-4 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[10px] text-muted-foreground/70">
          <span>用时：{formatDuration(stats.durSec)}</span>
          <span>操作数：{stats.ops}</span>
          <span>读取文件：{stats.readFiles}</span>
          <span>读取行数：{stats.readLines}</span>
          <span>修改文件：{stats.editFiles}</span>
        </div>
      )}
    </div>
  );
}

// ── K. BuildLivePanel (main) ──────────────────────────────────────────────
export function BuildLivePanel({
  entries,
  thinkingText,
  narrationText,
  thinkingElapsedSec,
  segments,
  isCompleted,
}: BuildLivePanelProps) {
  const t = useT();
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  const isPersisted = !!segments && segments.length > 0;

  // Live mode: derive narration-bound segments from the flat action log.
  const liveSegments = useMemo<NarrationSegment[]>(() => {
    if (isPersisted) return [];
    const segs: NarrationSegment[] = [];
    for (const entry of entries) {
      if (entry.type === "step" || entry.type === "narration") continue;
      const narration = entry.precedingNarration || "";
      const last = segs[segs.length - 1];
      if (!last || (narration && last.narration !== narration)) {
        segs.push({
          id: String(segs.length),
          narration,
          actions: [entry],
          isLive: false,
        });
      } else {
        last.actions.push(entry);
      }
    }
    // The trailing segment is still "live" while the build runs.
    if (segs.length > 0 && !isCompleted) {
      segs[segs.length - 1] = { ...segs[segs.length - 1], isLive: true };
    }
    return segs;
  }, [entries, isPersisted, isCompleted]);

  const renderSegments = isPersisted ? segments! : liveSegments;

  const hasThinking = !!thinkingText || thinkingElapsedSec != null;
  const isThinkingDone = thinkingElapsedSec != null;

  // Live narration that hasn't been bound to an action yet — shown as a
  // trailing block while streaming.
  const showTrailingNarration =
    !isPersisted && !isCompleted && !!narrationText;

  const hasAnyContent =
    renderSegments.length > 0 ||
    hasThinking ||
    showTrailingNarration ||
    (isPersisted && (segments?.length ?? 0) > 0);

  if (!hasAnyContent) return null;

  const showCost =
    (isPersisted || isCompleted) &&
    entries.some(
      (e) =>
        e.type !== "step" && e.type !== "narration" && e.type !== "thinking",
    );

  return (
    <div
      className="py-1 font-mono text-[11px] leading-[1.6]"
      data-testid="build-live-panel"
    >
      {/* Live thinking (live mode only) */}
      {!isPersisted && hasThinking && (
        <div className="px-3.5">
          {isThinkingDone ? (
            <button
              className="flex items-center gap-1.5 text-[rgba(129,140,248,0.5)] hover:text-[rgba(129,140,248,0.7)] transition-colors w-full text-left"
              onClick={() => setThinkingExpanded((e) => !e)}
              data-testid="thinking-collapsed-chip"
            >
              <span className="text-[10px]">
                {thinkingExpanded ? "▾" : "▸"}
              </span>
              <span className="italic">
                {t("chat.thoughtFor", { n: String(thinkingElapsedSec) })}
              </span>
            </button>
          ) : (
            <div
              className="flex items-center gap-1.5 text-[rgba(129,140,248,0.6)]"
              data-testid="thinking-stream"
            >
              <BrailleSpinner />
              <span className="italic truncate">
                {thinkingText ? thinkingText.slice(-60) : t("chat.thinkingLive")}
              </span>
            </div>
          )}
          {isThinkingDone && thinkingExpanded && thinkingText && (
            <div className="pl-4 max-h-[120px] overflow-y-auto">
              <p className="text-[10px] text-[rgba(129,140,248,0.35)] italic whitespace-pre-wrap break-words">
                {thinkingText}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Narration + action segments */}
      {renderSegments.map((seg) => (
        <SegmentView key={seg.id} segment={seg} />
      ))}

      {/* Trailing live narration not yet bound to an action */}
      {showTrailingNarration && (
        <NarrationBlock text={narrationText!} isLive />
      )}

      {/* Cost summary card */}
      {showCost && <CostSummary entries={entries} elapsedSec={thinkingElapsedSec} />}
    </div>
  );
}
