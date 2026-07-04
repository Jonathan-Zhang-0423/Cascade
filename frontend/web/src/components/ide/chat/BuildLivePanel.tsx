import { useState, useEffect, useMemo, useRef, memo } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useIDEStore } from "@/stores/ide-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLanguageStore } from "@/stores/language-store";

// ── useTypewriter — 打字机逐字显示 hook ───────────────────────────────────
function useTypewriter(text: string, enabled: boolean, charMs = 18, onDone?: () => void): string {
  const [displayed, setDisplayed] = useState("");
  const prevText = useRef("");
  const doneRef = useRef(false);
  useEffect(() => {
    if (!enabled || !text) { setDisplayed(text || ""); return; }
    if (text === prevText.current) return;
    prevText.current = text;
    doneRef.current = false;
    setDisplayed("");
    let i = 0;
    const tick = () => {
      if (i >= text.length) {
        if (!doneRef.current) { doneRef.current = true; onDone?.(); }
        return;
      }
      i++;
      setDisplayed(text.slice(0, i));
      setTimeout(tick, charMs);
    };
    setTimeout(tick, charMs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, enabled, charMs]);
  return displayed;
}

// ── AnimatedDots — 从左到右逐个显示的三点动画 ─────────────────────────────
function AnimatedDots() {
  return (
    <>
      <style>{`
        @keyframes dot-fade {
          0%, 20%   { opacity: 0; }
          40%, 100% { opacity: 1; }
        }
        .anim-dot-1 { animation: dot-fade 1.2s ease-in-out infinite; animation-delay: 0s;    }
        .anim-dot-2 { animation: dot-fade 1.2s ease-in-out infinite; animation-delay: 0.3s;  }
        .anim-dot-3 { animation: dot-fade 1.2s ease-in-out infinite; animation-delay: 0.6s;  }
      `}</style>
      <span aria-hidden="true">
        <span className="anim-dot-1">.</span>
        <span className="anim-dot-2">.</span>
        <span className="anim-dot-3">.</span>
      </span>
    </>
  );
}

// ── LiveBar — 转圈圈 + 打字机文字 + 三点（完全复用 TypingIndicator 逻辑）────
const LIVE_PHRASES_ZH = [
  "正在脑洞大开中", "灵感正在路上，请稍候", "AI 正在认真思考，不是在摸鱼",
  "代码宇宙正在重组中", "正在向平行宇宙借点智慧", "思维发动机预热中",
  "正在把你的想法翻译成代码语言", "正在解锁最优解", "AI 大脑正在高速运转",
  "正在召唤代码精灵", "把咖啡因转化为代码中", "正在对齐神经元",
  "想法正在结晶", "正在量子计算最优解", "大模型正在认真上班",
  "正在把文字变成魔法", "灵感女神正在降临", "正在高速检索知识库",
];
const LIVE_PHRASES_EN = [
  "Brainwaves detected, processing", "Consulting the code oracle",
  "Firing up the neural engines", "Turning caffeine into code",
  "Assembling brilliant thoughts", "Summoning the AI muse",
  "Untangling the idea spaghetti", "Crunching possibilities",
  "Downloading inspiration", "Aligning neurons, please hold",
  "Searching all known universes", "Cooking up something great",
  "Connecting the creative dots", "Spinning up the idea turbine",
];

function LiveBar() {
  const { lang } = useLanguageStore();
  const phrases = lang === "zh" ? LIVE_PHRASES_ZH : LIVE_PHRASES_EN;
  const phrase = useRef(phrases[Math.floor(Math.random() * phrases.length)]).current;

  const [charCount, setCharCount] = useState(0);
  useEffect(() => {
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (i < phrase.length) {
        i++; setCharCount(i);
        timer = setTimeout(tick, 90);
      } else {
        timer = setTimeout(() => { i = 0; setCharCount(0); timer = setTimeout(tick, 90); }, 2400);
      }
    };
    timer = setTimeout(tick, 90);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phrase]);

  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground/60 font-mono text-[10.5px]">
      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
      <span>{phrase.slice(0, charCount)}<AnimatedDots /></span>
    </span>
  );
}
import {
  FileText,
  Trash2,
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
  Globe,
  type LucideIcon,
} from "lucide-react";
import type { ActionLogEntry, NarrationSegment } from "./chat-types";
import { normalizeActionLogEntry, rebuildSegmentsFromActionLog, stringifyLogValue } from "./action-log-normalize";
import { shouldShowBuildCostSummary } from "./build-live-panel-utils";

interface BuildLivePanelProps {
  entries: ActionLogEntry[];
  thinkingText?: string;
  narrationText?: string;
  thinkingElapsedSec?: number | null;
  segments?: NarrationSegment[];
  isCompleted?: boolean;
  tokenUsage?: { input: number; output: number; total: number };
  completionSummary?: string;
  stepNarrations?: Record<number, string>;
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

// ── C2. TypewriterNarration — 打字机逐字显示的 narration ─────────────────
function TypewriterNarration({ text, onDone, skipAnimation }: { text: string; onDone?: () => void; skipAnimation?: boolean }) {
  const displayed = useTypewriter(text, !skipAnimation, 18, onDone);
  // skipAnimation=true 时直接显示完整文字，不跑打字机
  const finalText = skipAnimation ? text : displayed;
  const clean = stripMarkdown(finalText);
  const lines = clean.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  return (
    <div className="px-3.5 py-1 font-mono text-[12px] leading-[1.6] text-muted-foreground space-y-0.5">
      {lines.map((line, i) => (
        <NarrationLine key={i} line={line} />
      ))}
    </div>
  );
}
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
  list_files: "查看文件列表",
  grep: "搜索项目文件",
  write_file: "编辑文件",
  edit_file: "修改文件",
  patch_file: "修改文件",
  hash_patch_file: "修改文件",
  ast_search: "搜索代码结构",
  ast_replace: "替换代码结构",
  lsp_diagnostics: "检查类型错误",
  lsp_find_references: "查找符号引用",
  lsp_goto_definition: "跳转到定义",
  shell_run: "运行命令",
  run_tests: "运行测试",
  mcp_search: "联网搜索",
  fetch_url: "读取网页",
  research: "联网调研",
  update_project_memory: "更新项目记忆",
  submit_interaction_script: "保存演示脚本",
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
    case "file_delete":    return `删除了 ${fileName(entry)}`;
    case "thinking":       return extractThinkingNarration(entry.detail);
    case "tool_call":      return TOOL_NARRATION[entry.label] || `调用了 ${entry.label}`;
    case "research":       return entry.label.toLowerCase().includes("complete") ? `研究完成 — ${entry.detail}` : `🔍 搜索: ${entry.detail || entry.label}`;
    case "terminal_command": return `执行命令：${entry.label}`;
    case "code_applied":   return `应用了 ${fileName(entry)}`;
    case "code_review":    return entry.label || "代码审查";
    case "capabilities":   return entry.label || "能力激活";
    case "plan":           return entry.label || "任务计划";
    default:               return entry.label || "";
  }
}

// ── E2. summarizeActions — 根据 actions 生成智能简短 narration ─────────────
function summarizeActions(actions: ActionLogEntry[]): string {
  if (actions.length === 0) return "";

  const writes  = actions.filter(a => a.type === "file_write" || a.type === "code_applied");
  const reads   = actions.filter(a => a.type === "file_read");
  const deletes = actions.filter(a => a.type === "file_delete");
  const terms   = actions.filter(a => a.type === "terminal_command");
  const reviews = actions.filter(a => a.type === "code_review");
  const research = actions.filter(a => a.type === "research");
  const tools = actions.filter(a => a.type === "tool_call");

  // 取文件名（去掉路径前缀）
  const name = (entry: ActionLogEntry) =>
    (entry.filePath || entry.label || "").split("/").pop() || "";

  // 合并读+写的文件列表，展示"读取并修改了 X"
  const rwFiles = [...new Set([
    ...reads.map(name),
    ...writes.map(name),
  ])].filter(Boolean);

  const parts: string[] = [];

  if (reads.length > 0 && writes.length > 0) {
    // 既读又写
    const files = rwFiles.slice(0, 2).join("、");
    const extra = rwFiles.length > 2 ? ` 等 ${rwFiles.length} 个文件` : "";
    parts.push(`读取并修改了 ${files}${extra}`);
  } else if (writes.length > 0) {
    const files = writes.slice(0, 2).map(name).filter(Boolean).join("、");
    const extra = writes.length > 2 ? ` 等 ${writes.length} 个文件` : "";
    parts.push(`修改了 ${files}${extra}`);
  } else if (reads.length > 0) {
    const files = reads.slice(0, 2).map(name).filter(Boolean).join("、");
    const extra = reads.length > 2 ? ` 等 ${reads.length} 个文件` : "";
    parts.push(`读取了 ${files}${extra}`);
  }

  if (deletes.length > 0) {
    const files = deletes.slice(0, 2).map(name).filter(Boolean).join("、");
    parts.push(`删除了 ${files}${deletes.length > 2 ? ` 等 ${deletes.length} 个文件` : ""}`);
  }

  if (terms.length > 0) {
    const cmd = (terms[0].label || terms[0].detail || "命令").slice(0, 30);
    parts.push(terms.length === 1 ? `执行了 ${cmd}` : `执行了 ${terms.length} 条命令`);
  }

  if (reviews.length > 0) parts.push("代码审查");
  if (research.length > 0) {
    parts.push(research.length === 1 ? "完成了联网调研" : `完成了 ${research.length} 次联网调研`);
  }
  if (parts.length === 0 && tools.length > 0) {
    const named = tools
      .map((a) => TOOL_NARRATION[a.label] || a.label)
      .filter(Boolean)
      .slice(0, 2)
      .join("、");
    parts.push(named ? `调用了 ${named}${tools.length > 2 ? ` 等 ${tools.length} 个工具` : ""}` : `调用了 ${tools.length} 个工具`);
  }

  return parts.join("，");
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
    case "file_delete":
      return { rows: entry.filePath ? [{ k: "路径", v: entry.filePath }] : [] };
    case "code_applied":
      return { rows: entry.filePath ? [{ k: "路径", v: entry.filePath }] : [] };
    case "tool_call":
      return { rows: entry.label ? [{ k: "工具", v: entry.label }] : [] };
    case "research":
      return { rows: [{ k: "查询", v: entry.detail || entry.label }] };
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
type ActionType = "thinking" | "read" | "edit" | "delete" | "apply" | "review" | "capabilities" | "plan" | "tool" | "terminal" | "research" | "other";

function toDisplayType(raw: string): ActionType {
  switch (raw) {
    case "thinking":       return "thinking";
    case "file_read":      return "read";
    case "file_write":     return "edit";
    case "file_delete":    return "delete";
    case "code_applied":   return "apply";
    case "code_review":    return "review";
    case "capabilities":   return "capabilities";
    case "plan":           return "plan";
    case "tool_call":      return "tool";
    case "research":       return "research";
    case "terminal_command": return "terminal";
    default:               return "other";
  }
}

const ACTION_META: Record<ActionType, { icon: LucideIcon; color: string }> = {
  thinking:     { icon: Brain,       color: "text-muted-foreground/50" },
  read:         { icon: FileText,    color: "text-muted-foreground/50" },
  edit:         { icon: PencilLine,  color: "text-muted-foreground/50" },
  delete:       { icon: Trash2,      color: "text-muted-foreground/50" },
  apply:        { icon: GitMerge,    color: "text-muted-foreground/50" },
  review:       { icon: ShieldCheck, color: "text-muted-foreground/50" },
  capabilities: { icon: Zap,         color: "text-muted-foreground/50" },
  plan:         { icon: ListChecks,  color: "text-muted-foreground/50" },
  tool:         { icon: Wrench,      color: "text-muted-foreground/50" },
  terminal:     { icon: Terminal,    color: "text-muted-foreground/50" },
  research:     { icon: Globe,       color: "text-cyan-400/70" },
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
  const { lang } = useLanguageStore();
  const isChinese = lang === "zh";
  // 中文：用 extractThinkingNarration 提取关键节点；英文：截取前150字符
  const thinkingSummary = entry.detail
    ? isChinese
      ? extractThinkingNarration(entry.detail)
      : entry.detail.slice(0, 150).replace(/\n+/g, " ").trim() + (entry.detail.length > 150 ? "…" : "")
    : "";
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
          {isLive ? <>{t("chat.thinkingLive")}<AnimatedDots /></> : t("agent.thinking")}
        </span>
        {isLive && <LiveBar />}
      </button>
      {open && thinkingSummary && (
        <div className="pl-[34px] pb-1">
          <p className="text-[10px] text-muted-foreground/40 italic whitespace-pre-wrap break-words leading-relaxed max-h-[120px] overflow-y-auto">
            {thinkingSummary}
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

  // Nothing to show at all — show spinner if live (waiting for first action),
  // or a minimal done row if completed (step had no file actions but still ran).
  if (!thinkingEntry && nonThinkingActions.length === 0) {
    const stepTitle0 = stepLabel ? stepLabel.replace(/^Step\s*\d+\/\d+:\s*/i, "").trim() : "";
    const displayText0 = segment.narration
      ? segment.narration.split("\n")[0].replace(/^#{1,6}\s*Step\s*\d+[:/：]?\s*/i, "").replace(/^•\s*/, "").trim()
      : stepTitle0;
    return (
      <div className="mb-0.5 px-3.5" data-testid="segment-view">
        <div className="flex items-center gap-1.5 py-0.5 font-mono text-[11px]">
          <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/40" />
          {isLive && <LiveBar />}
          {displayText0 && (
            <span className="ml-2 text-[10.5px] text-muted-foreground/40 truncate min-w-0 max-w-[50%]">
              {displayText0}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Step label stripped of "Step N/M: " prefix for display
  const stepTitle = stepLabel
    ? stepLabel.replace(/^Step\s*\d+\/\d+:\s*/i, "").trim()
    : "";

  return (
    <div className="mb-0.5" data-testid="segment-view">
      <div className="px-3.5">
        {!expanded ? (
          <div>
            {/* 第一行：折叠符号 + narration（去掉左侧 spinner） */}
            <button
              className="flex items-center gap-1.5 py-0.5 w-full text-left text-foreground/80 hover:text-foreground/90 transition-colors font-mono text-[11px]"
              onClick={() => setExpanded(true)}
              data-testid="segment-collapsed"
            >
              <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/40" />
              {(() => {
                // narration 优先；为空时 fallback 到 stepTitle；都没有时 live 显示占位
                const displayText = segment.narration
                  ? segment.narration
                      .replace(/^#{1,6}\s*Step\s*\d+[:/：]?\s*/i, "")
                      .replace(/^•\s*/, "")
                      .trim()
                      .split(/(?<=[。．！？.!?])\s*/)[0]
                      .trim()
                  : stepTitle || (isLive ? "处理中" : "");
                if (!displayText) return null;
                return (
                  <span className={cn(
                    "text-[10.5px] truncate min-w-0",
                    isLive ? "text-muted-foreground/40" : "text-muted-foreground/55"
                  )}>
                    {displayText}
                  </span>
                );
              })()}
            </button>
            {/* 第二行：actions 图标摘要 + spinner 在最右侧 */}
            {(thinkingEntry || nonThinkingActions.length > 0) && (
              <div className="flex items-center gap-1.5 pl-[18px] pb-0.5">
                {thinkingEntry && (
                  <span className="inline-flex items-center gap-0.5 shrink-0">
                    <Brain className="w-3 h-3 text-muted-foreground/50" />
                  </span>
                )}
                <span className="flex items-center gap-1.5 shrink-0">
                  {(() => {
                    const counts = new Map<ActionType, number>();
                    for (const a of nonThinkingActions) {
                      const dt = toDisplayType(a.type);
                      counts.set(dt, (counts.get(dt) ?? 0) + 1);
                    }
                    return Array.from(counts.entries()).slice(0, 3).map(([dt, count]) => {
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
                {isLive && (
                  <LiveBar />
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <button
              className="flex items-start gap-1 py-0.5 text-muted-foreground/70 hover:text-foreground/80 transition-colors font-mono text-[11px] w-full text-left"
              onClick={() => setExpanded(false)}
              data-testid="segment-expanded"
            >
              <ChevronDown className="w-3 h-3 shrink-0 mt-[1px]" />
              {segment.narration ? (
                <span className="ml-2 text-[10.5px] text-foreground/80 leading-relaxed">
                  {segment.narration
                    .replace(/^#{1,6}\s*Step\s*\d+[:/：]?\s*/i, "")
                    .replace(/^•\s*/, "")
                    .trim()
                    .split(/(?<=[。．！？.!?])\s*/)[0]
                    .trim()}
                </span>
              ) : stepTitle ? (
                <span className="ml-1 text-[10px] text-muted-foreground/35">
                  {stepTitle}
                </span>
              ) : null}
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

  // 打字机效果：mounted 后触发一次，让时间/token 数字逐字出现
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = setTimeout(() => setReady(true), 60); return () => clearTimeout(id); }, []);

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
    <div
      className="px-3.5 pt-1"
      data-testid="cost-summary"
      style={{ opacity: ready ? 1 : 0, transition: "opacity 0.4s ease" }}
    >
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
  completionSummary,
  stepNarrations = {},
}: BuildLivePanelProps) {
  const t = useT();
  const projectId = useIDEStore((s) => s.projectId);
  const safeEntries = useMemo(
    () => (Array.isArray(entries) ? entries : []).map((entry) => normalizeActionLogEntry(entry as any)),
    [entries],
  );
  const safeSegments = useMemo<NarrationSegment[] | undefined>(
    () => Array.isArray(segments) ? segments.map((seg, index) => ({
      id: stringifyLogValue(seg.id, String(index)),
      narration: stringifyLogValue(seg.narration, ""),
      actions: Array.isArray(seg.actions)
        ? seg.actions.map((entry) => normalizeActionLogEntry(entry as any))
        : [],
      isLive: Boolean(seg.isLive),
      stepLabel: stringifyLogValue(seg.stepLabel, ""),
    })) : undefined,
    [segments],
  );
  const persistedSegments = useMemo<NarrationSegment[] | undefined>(
    () => rebuildSegmentsFromActionLog(safeEntries, safeSegments) ?? safeSegments,
    [safeEntries, safeSegments],
  );

  // 打字机效果只触发一次：用 localStorage 记录"已展示完毕"
  // 刷新/重进项目后直接完整显示，不重复动画
  const summaryKey = projectId ? `cascade-summary-shown-${projectId}` : null;
  const alreadyShown = summaryKey ? !!localStorage.getItem(summaryKey) : false;
  const [summaryDone, setSummaryDone] = useState(() => !completionSummary || alreadyShown);

  const handleSummaryDone = () => {
    setSummaryDone(true);
    if (summaryKey) localStorage.setItem(summaryKey, "1");
  };

  useEffect(() => {
    if (!completionSummary) setSummaryDone(true);
  }, [completionSummary]);

  const isPersisted = !!persistedSegments && persistedSegments.length > 0;

  // Persisted 模式：优先用 summarizeActions，actions 为空则保留原有 narration
  const mergedSegments = useMemo<NarrationSegment[]>(() => {
    if (!isPersisted || !persistedSegments) return [];
    return persistedSegments.map((seg) => {
      const summary = summarizeActions(seg.actions);
      return { ...seg, narration: summary || seg.narration };
    });
  }, [isPersisted, persistedSegments]);

  // Live 模式：每次 entries 变化都重算 narration
  // live 最后一个 segment 用当前已有 actions 实时生成文字（哪怕只有1个action）
  const liveSegments = useMemo<NarrationSegment[]>(() => {
    if (isPersisted) return [];
    const segs: NarrationSegment[] = [];
    // 按 stepNum 分组：每个 entry 上都记录了它属于哪个步骤。
    // step entry 本身创建 segment，其他 entry 按 stepNum 归入对应 segment。
    // 这样即使 tool call 在 step entry 之前到达，也能正确归入对应步骤。
    const segByStep = new Map<number, NarrationSegment>();
    let maxStepNum = 0;

    for (const entry of safeEntries) {
      if (entry.type === "narration") continue;
      if (entry.type === "step") {
        const match = entry.label?.match(/Step\s*(\d+)/i);
        const stepNum = match ? parseInt(match[1], 10) : (maxStepNum + 1);
        maxStepNum = Math.max(maxStepNum, stepNum);
        if (!segByStep.has(stepNum)) {
          const seg: NarrationSegment = { id: String(stepNum), narration: "", actions: [], isLive: false, stepLabel: entry.label };
          segByStep.set(stepNum, seg);
        } else {
          // step entry 到来时补上 stepLabel（可能比 action entries 晚到）
          segByStep.get(stepNum)!.stepLabel = entry.label;
        }
      } else {
        const sn = (entry as any).stepNum as number | undefined;
        const targetStep = (sn != null && sn > 0) ? sn : (maxStepNum > 0 ? maxStepNum : 1);
        maxStepNum = Math.max(maxStepNum, targetStep);
        if (!segByStep.has(targetStep)) {
          segByStep.set(targetStep, { id: String(targetStep), narration: "", actions: [], isLive: false });
        }
        segByStep.get(targetStep)!.actions.push(entry);
      }
    }

    // 按步骤号顺序输出
    const sortedSteps = Array.from(segByStep.keys()).sort((a, b) => a - b);
    for (const sn of sortedSteps) segs.push(segByStep.get(sn)!);

    // 每个 step 生成 narration
    for (const seg of segs) {
      const summary = summarizeActions(seg.actions);
      seg.narration = summary;
    }
    if (segs.length > 0 && !isCompleted) {
      segs[segs.length - 1] = { ...segs[segs.length - 1], isLive: true };
    }
    return segs;
  }, [safeEntries, isPersisted, isCompleted]);

  const renderSegments = isPersisted ? mergedSegments : liveSegments;

  const hasLooseLiveActivity =
    !isCompleted &&
    !isPersisted &&
    (Boolean(_thinkingText?.trim()) || Boolean(narrationText?.trim()));
  const hasLiveSegment = renderSegments.some((seg) => seg.isLive);
  const showLooseLiveBar = hasLooseLiveActivity && !hasLiveSegment;

  // Thinking is now per-step inside SegmentView; keep only the live status fallback global.
  const showTrailingNarration = false;

  const hasAnyContent =
    renderSegments.length > 0 ||
    showLooseLiveBar ||
    (isPersisted && (persistedSegments?.length ?? 0) > 0);

  if (!hasAnyContent) return null;

  const showCost = shouldShowBuildCostSummary(isCompleted, safeEntries);

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

      {showLooseLiveBar && (
        <div className="mb-0.5 px-3.5" data-testid="loose-live-bar">
          <div className="flex items-center gap-1.5 py-0.5 font-mono text-[11px]">
            <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/40" />
            <LiveBar />
          </div>
        </div>
      )}

      {/* Trailing live narration not yet bound to an action */}
      {showTrailingNarration && (
        <NarrationBlock text={narrationText!} isLive />
      )}

      {/* Completion summary — 打字机效果逐字出现，完成后再显示 CostSummary */}
      {isCompleted && completionSummary && (
        <div className="px-3.5 py-2 mt-1 border-t border-border/30">
          <TypewriterNarration
            text={completionSummary}
            skipAnimation={alreadyShown}
            onDone={handleSummaryDone}
          />
        </div>
      )}

      {/* Cost summary card — 等总结打字机完成后才显示 */}
      {showCost && summaryDone && <CostSummary entries={safeEntries} elapsedSec={_thinkingElapsedSec} tokenUsage={tokenUsage} />}

      {/* Checkpoint card */}
      {showCost && summaryDone && <CheckpointSummary />}
    </div>
  );
}
