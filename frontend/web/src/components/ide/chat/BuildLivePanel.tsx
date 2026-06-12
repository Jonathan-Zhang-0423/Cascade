import { useState, useEffect, useMemo, memo } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useIDEStore } from "@/stores/ide-store";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  FileText,
  PencilLine,
  Wrench,
  Terminal,
  Brain,
  Sparkles,
  Circle,
  Clock,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  History,
  Loader2,
  ShieldCheck,
  GitMerge,
  Zap,
  ListChecks,
  DollarSign,
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
  /** Token usage from the backend all_complete event. */
  tokenUsage?: { input: number; output: number; total: number };
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
    case "file_read":      return `读取了 ${fileName(entry)}`;
    case "file_write":     return `编辑了 ${fileName(entry)}`;
    case "thinking":       return extractThinkingNarration(entry.detail);
    case "tool_call":      return TOOL_NARRATION[entry.label] || `调用了 ${entry.label}`;
    case "terminal_command": return `执行命令：${entry.label}`;
    case "code_applied":   return `应用了 ${fileName(entry)}`;
    case "code_review":    return entry.label || "代码审查";
    case "capabilities":   return entry.label || "能力激活";
    case "plan":           return entry.label || "任务计划";
    default:               return entry.label || "";
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
    case "code_applied":
      return { rows: entry.filePath ? [{ k: "路径", v: entry.filePath }] : [] };
    case "tool_call":
      return { rows: entry.label ? [{ k: "工具", v: entry.label }] : [] };
    case "terminal_command":
      return { rows: [{ k: "命令", v: (entry.detail || entry.label || "").slice(0, 100) }] };
    case "code_review":
      return {
        rows: entry.label ? [{ k: "状态", v: entry.label }] : [],
        content: entry.detail ? entry.detail.slice(0, 1000) : undefined,
      };
    case "capabilities":
      return {
        rows: [],
        content: entry.detail || undefined,
      };
    case "plan":
      return {
        rows: [],
        content: entry.detail ? entry.detail.slice(0, 2000) : undefined,
      };
    default:
      return { rows: [] };
  }
}

// ── H. toDisplayType ──────────────────────────────────────────────────────
type ActionType = "thinking" | "read" | "edit" | "apply" | "review" | "capabilities" | "plan" | "tool" | "terminal" | "other";

function toDisplayType(raw: string): ActionType {
  switch (raw) {
    case "thinking":       return "thinking";
    case "file_read":      return "read";
    case "file_write":     return "edit";
    case "code_applied":   return "apply";
    case "code_review":    return "review";
    case "capabilities":   return "capabilities";
    case "plan":           return "plan";
    case "tool_call":      return "tool";
    case "terminal_command": return "terminal";
    default:               return "other";
  }
}

const ACTION_META: Record<ActionType, { icon: LucideIcon; color: string }> = {
  thinking:     { icon: Brain,       color: "text-muted-foreground/50" },
  read:         { icon: FileText,    color: "text-muted-foreground/50" },
  edit:         { icon: PencilLine,  color: "text-muted-foreground/50" },
  apply:        { icon: GitMerge,    color: "text-muted-foreground/50" },
  review:       { icon: ShieldCheck, color: "text-muted-foreground/50" },
  capabilities: { icon: Zap,         color: "text-muted-foreground/50" },
  plan:         { icon: ListChecks,  color: "text-muted-foreground/50" },
  tool:         { icon: Wrench,      color: "text-muted-foreground/50" },
  terminal:     { icon: Terminal,    color: "text-muted-foreground/50" },
  other:        { icon: Circle,      color: "text-muted-foreground/50" },
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
        className="flex items-center gap-1.5 w-full text-left py-px text-foreground/80 hover:text-foreground/90 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", open && "rotate-90")} />
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
                  <span className="text-foreground/80 shrink-0">
                    {r.k}：
                  </span>
                  <span className="text-foreground/80 break-all">
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

// ── I-0. ThinkingActionRow ────────────────────────────────────────────────
const ThinkingActionRow = memo(function ThinkingActionRow({
  entry,
  isLive,
  t,
}: {
  entry: ActionLogEntry;
  isLive: boolean;
  t: (key: string, vars?: Record<string, string>) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="font-mono text-[11px]" data-testid="thinking-action-row">
      <button
        className="flex items-center gap-1.5 w-full text-left py-px text-foreground/80 hover:text-foreground/90 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="w-6 h-6 flex items-center justify-center shrink-0">
          <Brain className="w-3.5 h-3.5 text-muted-foreground/50" />
        </span>
        <span className="truncate text-muted-foreground/70">
          {isLive ? t("chat.thinkingLive") : t("agent.thinking")}
        </span>
        {isLive && <Loader2 className="w-2.5 h-2.5 animate-spin ml-1 shrink-0 text-muted-foreground/50" />}
      </button>
      {open && entry.detail && (
        <div className="pl-[34px] pb-1">
          <p className="text-[10px] text-muted-foreground/40 italic whitespace-pre-wrap break-words leading-relaxed max-h-[160px] overflow-y-auto">
            {entry.detail}
          </p>
        </div>
      )}
    </div>
  );
});

// ── I. SegmentView ────────────────────────────────────────────────────────
// One step row: [>] [icons×N] [spinner(live)]
// thinking action renders as first item when expanded, collapsible separately.
const SegmentView = memo(function SegmentView({
  segment,
}: {
  segment: NarrationSegment;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  const { actions, isLive, stepLabel } = segment;

  const thinkingEntry = actions.find((a) => a.type === "thinking");
  const nonThinkingActions = actions.filter(
    (a) => a.type !== "thinking" && !(a.type === "tool_call" && HIDDEN_TOOLS.has(a.label)),
  );

  // Nothing to show at all
  if (!thinkingEntry && nonThinkingActions.length === 0) return null;

  // Step label stripped of "Step N/M: " prefix for display
  const stepTitle = stepLabel
    ? stepLabel.replace(/^Step\s*\d+\/\d+:\s*/i, "").trim()
    : "";

  return (
    <div className="mb-0.5" data-testid="segment-view">
      <div className="px-3.5">
        {!expanded ? (
          <button
            className="flex items-center gap-1.5 py-0.5 w-full text-left text-foreground/80 hover:text-foreground/90 transition-colors font-mono text-[11px]"
            onClick={() => setExpanded(true)}
            data-testid="segment-collapsed"
          >
            <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/40" />
            {/* thinking icon — same style as other action icons */}
            {thinkingEntry && (
              <span className="inline-flex items-center gap-0.5 shrink-0">
                <Brain className="w-3 h-3 text-muted-foreground/50" />
              </span>
            )}
            {/* non-thinking action icon counts */}
            <span className="flex items-center gap-1.5 shrink-0">
              {(() => {
                const counts = new Map<ActionType, number>();
                for (const a of nonThinkingActions) {
                  const dt = toDisplayType(a.type);
                  counts.set(dt, (counts.get(dt) ?? 0) + 1);
                }
                return Array.from(counts.entries()).map(([dt, count]) => {
                  const meta = ACTION_META[dt];
                  const Icon = meta.icon;
                  return (
                    <span key={dt} className="inline-flex items-center gap-0.5">
                      <Icon className={cn("w-3 h-3", meta.color)} />
                      <span className={cn("text-[10px]", meta.color)}>×{count}</span>
                    </span>
                  );
                });
              })()}
            </span>
            {/* live spinner */}
            {isLive && (
              <Loader2 className="w-3 h-3 animate-spin text-[#4f82ff]/70 shrink-0" />
            )}
            {/* step title on the right */}
            {stepTitle && (
              <span className="ml-auto text-[10px] text-muted-foreground/35 truncate max-w-[180px]">
                {stepTitle}
              </span>
            )}
          </button>
        ) : (
          <div>
            <button
              className="flex items-center gap-1 py-0.5 text-muted-foreground/70 hover:text-foreground/80 transition-colors font-mono text-[11px] w-full"
              onClick={() => setExpanded(false)}
              data-testid="segment-expanded"
            >
              <ChevronDown className="w-3 h-3 shrink-0" />
              {stepTitle && (
                <span className="ml-1 text-[10px] text-muted-foreground/35 truncate">
                  {stepTitle}
                </span>
              )}
            </button>
            <div className="border-l border-border/40 ml-1 pl-2 mt-0.5">
              {/* thinking row first */}
              {thinkingEntry && (
                <ThinkingActionRow entry={thinkingEntry} isLive={isLive && nonThinkingActions.length === 0} t={t} />
              )}
              {nonThinkingActions.map((a, i) => (
                <ActionDetailRow key={i} entry={a} />
              ))}
            </div>
          </div>
        )}
      </div>
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

// Provider/model pricing table (CNY per 1M tokens)
const PROVIDER_PRICING: Record<string, { input: number; output: number; label: string }> = {
  doubao:          { input: 4,    output: 16,   label: "Doubao" },
  kimi:            { input: 15,   output: 15,   label: "Kimi K2" },
  minimax:         { input: 10,   output: 10,   label: "MiniMax" },
  glm:             { input: 10,   output: 10,   label: "GLM" },
  "deepseek-pro":  { input: 4,    output: 16,   label: "DeepSeek Pro" },
  "deepseek-flash":{ input: 0.5,  output: 2,    label: "DeepSeek Flash" },
};

function calcCost(input: number, output: number, provider: string): number {
  const p = PROVIDER_PRICING[provider] ?? PROVIDER_PRICING["doubao"];
  return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
}

function formatCost(cny: number): string {
  if (cny < 0.001) return "< ¥0.001";
  if (cny < 0.01)  return `¥${cny.toFixed(4)}`;
  if (cny < 1)     return `¥${cny.toFixed(3)}`;
  return `¥${cny.toFixed(2)}`;
}

function CostSummary({
  entries,
  elapsedSec,
  tokenUsage,
}: {
  entries: ActionLogEntry[];
  elapsedSec?: number | null;
  tokenUsage?: { input: number; output: number; total: number };
}) {
  const [open, setOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const selectedProvider = useIDEStore((s) => s.selectedProvider);
  const t = useT();

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

  // 估算 token：无真实数据时按 thinking detail 字符数 /4 粗算
  const displayTokens = useMemo(() => {
    if (tokenUsage && tokenUsage.total > 0) return tokenUsage;
    const thinkingChars = entries
      .filter((e) => e.type === "thinking")
      .reduce((n, e) => n + (e.detail?.length ?? 0), 0);
    const writeChars = entries
      .filter((e) => e.type === "file_write")
      .reduce((n, e) => n + (e.detail?.length ?? 0), 0);
    const est = Math.round(thinkingChars / 4) + Math.round(writeChars / 4);
    if (est < 100) return null;
    return { input: Math.round(est * 0.7), output: Math.round(est * 0.3), total: est, estimated: true };
  }, [tokenUsage, entries]);

  const cost = displayTokens
    ? calcCost(displayTokens.input, displayTokens.output, selectedProvider)
    : null;

  return (
    <div className="px-3.5 pt-1" data-testid="cost-summary">
      {/* 时间消耗 */}
      <button
        className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-muted-foreground/70 hover:text-foreground/80 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <Clock className="w-2.5 h-2.5" />
        <span>{t("build.timeSpent", { dur: formatDuration(stats.durSec) })}</span>
        <ChevronRight
          className={cn("w-2.5 h-2.5 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-1 pl-4 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[10px] text-muted-foreground/60">
          <span>{t("build.timeDetail", { dur: formatDuration(stats.durSec) })}</span>
          <span>{t("build.ops", { n: String(stats.ops) })}</span>
          <span>{t("build.readFiles", { n: String(stats.readFiles) })}</span>
          <span>{t("build.readLines", { n: String(stats.readLines) })}</span>
          <span>{t("build.editFiles", { n: String(stats.editFiles) })}</span>
        </div>
      )}

      {/* Token 消耗 + 费用 */}
      {displayTokens && (
        <>
          <button
            className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-muted-foreground/70 hover:text-foreground/80 transition-colors mt-0.5"
            onClick={() => setTokenOpen((o) => !o)}
          >
            <Sparkles className="w-2.5 h-2.5" />
            <span>
              {t("build.tokensTotal", { n: displayTokens.total.toLocaleString() })}
              {(displayTokens as any).estimated && <span className="opacity-50 font-normal"> {t("build.estimated")}</span>}
            </span>
            <ChevronRight
              className={cn("w-2.5 h-2.5 transition-transform", tokenOpen && "rotate-90")}
            />
          </button>
          {tokenOpen && (
            <div className="mt-1 pl-4 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[10px] text-muted-foreground/60">
              <span>{t("build.tokenInput", { n: displayTokens.input.toLocaleString() })}</span>
              <span>{t("build.tokenOutput", { n: displayTokens.output.toLocaleString() })}</span>
              <span>{t("build.tokenSum", { n: displayTokens.total.toLocaleString() })}</span>
            </div>
          )}
          {cost !== null && cost > 0 && (
            <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-muted-foreground/60 mt-0.5">
              <DollarSign className="w-2.5 h-2.5" />
              <span>
                {t("build.costEstimate", { cost: formatCost(cost) })}
                {(displayTokens as any).estimated && <span className="opacity-50 font-normal"> {t("build.estimated")}</span>}
              </span>
              <ChevronRight className="w-2.5 h-2.5 opacity-0" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── K. CheckpointSummary ──────────────────────────────────────────────────
function CheckpointSummary() {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showInlineHistory, setShowInlineHistory] = useState(false);
  const t = useT();
  const isMobile = useIsMobile();
  const { checkpoints, restoreCheckpoint, refreshPreview, requestHistoryTab } = useIDEStore();

  const latest = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
  const canRollback = checkpoints.length >= 2;

  if (!latest) return null;

  const handleRollback = () => {
    if (!canRollback) return;
    setConfirming(true);
  };

  const handleConfirmRollback = () => {
    const target = checkpoints[checkpoints.length - 2];
    restoreCheckpoint(target.id);
    refreshPreview();
    setConfirming(false);
  };

  const handleViewHistory = () => {
    if (isMobile) {
      setShowInlineHistory((v) => !v);
    } else {
      requestHistoryTab();
    }
  };

  const dateStr = new Date(latest.timestamp).toLocaleString();

  return (
    <div className="px-3.5 pt-0.5" data-testid="checkpoint-summary">
      <button
        className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-muted-foreground/70 hover:text-foreground/80 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <History className="w-2.5 h-2.5" />
        <span>{t("checkpoint.title")}</span>
        <ChevronRight className={cn("w-2.5 h-2.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-1 pl-4 space-y-1.5 font-mono text-[10px]">
          <div className="text-muted-foreground/70">
            {t("checkpoint.savedAt")}：{dateStr}
          </div>
          {!confirming ? (
            <div className="flex items-center gap-2">
              <button
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] transition-colors",
                  canRollback
                    ? "border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                    : "border-border/30 text-muted-foreground/30 cursor-not-allowed"
                )}
                onClick={handleRollback}
                disabled={!canRollback}
              >
                <RotateCcw className="w-2.5 h-2.5" />
                {t("checkpoint.rollback")}
              </button>
              <button
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors"
                onClick={handleViewHistory}
              >
                <History className="w-2.5 h-2.5" />
                {t("checkpoint.viewHistory")}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/60">{t("checkpoint.confirm")}？</span>
              <button
                className="text-amber-500 hover:text-amber-400 font-medium transition-colors"
                onClick={handleConfirmRollback}
              >
                {t("checkpoint.confirm")}
              </button>
              <button
                className="text-muted-foreground/60 hover:text-foreground transition-colors"
                onClick={() => setConfirming(false)}
              >
                {t("checkpoint.cancel")}
              </button>
            </div>
          )}
          {/* Mobile inline history list */}
          {isMobile && showInlineHistory && (
            <div className="mt-1 border border-border/40 rounded overflow-hidden">
              {[...checkpoints].reverse().map((cp, i) => {
                const isActive = cp.id === checkpoints[checkpoints.length - 1].id;
                return (
                  <div
                    key={cp.id}
                    className={cn(
                      "flex items-center justify-between px-2 py-1.5 text-[10px]",
                      i < checkpoints.length - 1 && "border-b border-border/30",
                      isActive ? "bg-accent/20" : "hover:bg-muted/20"
                    )}
                  >
                    <span className={cn("truncate", isActive ? "text-foreground" : "text-muted-foreground")}>
                      {new Date(cp.timestamp).toLocaleString()}
                    </span>
                    {!isActive && (
                      <button
                        className="ml-2 shrink-0 text-muted-foreground/60 hover:text-foreground underline underline-offset-2 transition-colors"
                        onClick={() => { restoreCheckpoint(cp.id); refreshPreview(); setShowInlineHistory(false); }}
                      >
                        {t("chat.restore")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export function BuildLivePanel({
  entries,
  thinkingText: _thinkingText,
  narrationText,
  thinkingElapsedSec: _thinkingElapsedSec,
  segments,
  isCompleted,
  tokenUsage,
}: BuildLivePanelProps) {
  const t = useT();

  const isPersisted = !!segments && segments.length > 0;

  // Live mode: group by step entries in the action log.
  // thinking entry is written once per step (at narration_token time) — no in-place merge needed.
  const liveSegments = useMemo<NarrationSegment[]>(() => {
    if (isPersisted) return [];
    const segs: NarrationSegment[] = [];
    for (const entry of entries) {
      if (entry.type === "narration") continue;
      if (entry.type === "step") {
        segs.push({ id: String(segs.length), narration: "", actions: [], isLive: false, stepLabel: entry.label });
      } else {
        if (segs.length === 0) segs.push({ id: "0", narration: "", actions: [], isLive: false });
        const last = segs[segs.length - 1];
        if (!last.narration && entry.precedingNarration) {
          last.narration = entry.precedingNarration;
        }
        last.actions.push(entry);
      }
    }
    if (segs.length > 0 && !isCompleted) {
      segs[segs.length - 1] = { ...segs[segs.length - 1], isLive: true };
    }
    return segs;
  }, [entries, isPersisted, isCompleted]);

  const renderSegments = isPersisted ? segments! : liveSegments;

  // Thinking is now per-step inside SegmentView — no global thinking state needed.
  const showTrailingNarration = false;

  const hasAnyContent =
    renderSegments.length > 0 ||
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

      {/* Narration + action segments */}
      {renderSegments.map((seg, idx) => {
        const finalSeg =
          isCompleted || (isPersisted && idx < renderSegments.length)
            ? { ...seg, isLive: false }
            : seg;
        return (
          <SegmentView
            key={`${seg.id}-${finalSeg.isLive ? "live" : "done"}`}
            segment={finalSeg}
          />
        );
      })}

      {/* Trailing live narration not yet bound to an action */}
      {showTrailingNarration && (
        <NarrationBlock text={narrationText!} isLive />
      )}

      {/* Cost summary card */}
      {showCost && <CostSummary entries={entries} elapsedSec={_thinkingElapsedSec} tokenUsage={tokenUsage} />}

      {/* Checkpoint card */}
      {showCost && <CheckpointSummary />}
    </div>
  );
}
