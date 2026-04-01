import { useState, useRef, useEffect, useCallback } from "react";
import { useIDEStore, type ChatMessage, type ManagerPlan, type ManagerSubTask, type VerificationResult, type HolisticReviewResult, type ReviewPhase, type ChatMode, type AIProvider, type BuildResultData, flattenFiles } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useLLMMonitorStore, type LLMEventType, type LLMEventSource } from "@/stores/llm-monitor-store";
import { useLanguageStore } from "@/stores/language-store";
import { useT, tr } from "@/lib/i18n";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUp, Send, Sparkles, Lightbulb, X, Check, FileCode, Loader2, Square, ChevronRight, ChevronDown, ChevronUp, History, RotateCcw, ExternalLink, ClipboardList, Zap, Play, CircleDot, CheckCircle2, XCircle, Circle, AlertTriangle, StopCircle, Search, HelpCircle, ShieldCheck, FileText, Hammer, PenLine, Brain, Terminal, FilePlus, FileSearch, Wrench, ListChecks, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

const KNOWN_MGR_EVENT_TYPES: Set<string> = new Set([
  "thinking_token", "raw_token", "manager_token", "communicator_token",
  "communicator_narration_starting", "communicator_error",
  "plan_preparing", "plan_ready", "manager_done", "manager_error",
]);

const MGR_SOURCE_MAP: Record<string, LLMEventSource> = {
  communicator_token: "communicator",
  communicator_narration_starting: "communicator",
  communicator_error: "communicator",
};

const KNOWN_BUILD_EVENT_TYPES: Set<string> = new Set([
  "thinking_token", "narration_token", "communicator_token",
  "action_log", "step_starting", "step_completed", "step_failed", "step_cancelled",
  "editor_token", "code_applied",
  "reviewing", "review_passed", "bugs_found", "fixing", "needs_input",
  "all_complete", "build_error", "done",
]);

const BUILD_SOURCE_MAP: Record<string, LLMEventSource> = {
  narration_token: "communicator",
  communicator_token: "communicator",
  editor_token: "editor",
  code_applied: "editor",
  reviewing: "verifier",
  review_passed: "verifier",
  bugs_found: "verifier",
  thinking_token: "editor",
  action_log: "editor",
  step_starting: "manager",
  step_completed: "manager",
  step_failed: "manager",
  step_cancelled: "manager",
  fixing: "editor",
  all_complete: "manager",
  build_error: "editor",
  done: "manager",
  needs_input: "verifier",
};

export interface ActionLogEntry {
  type: "thinking" | "tool_call" | "file_read" | "file_write" | "step" | "narration";
  label: string;
  detail: string;
  timestamp: number;
  filePath?: string;
}

function getActionLogIcon(type: ActionLogEntry["type"]) {
  switch (type) {
    case "thinking": return <Brain className="w-3 h-3 shrink-0" />;
    case "file_write": return <FilePlus className="w-3 h-3 shrink-0" />;
    case "file_read": return <FileSearch className="w-3 h-3 shrink-0" />;
    case "tool_call": return <Terminal className="w-3 h-3 shrink-0" />;
    case "step": return <ListChecks className="w-3 h-3 shrink-0" />;
    case "narration": return <Wrench className="w-3 h-3 shrink-0" />;
    default: return <Wrench className="w-3 h-3 shrink-0" />;
  }
}

function getActionLogColor(type: ActionLogEntry["type"]): string {
  switch (type) {
    case "thinking": return "text-blue-400";
    case "file_write": return "text-green-400";
    case "file_read": return "text-amber-400";
    case "tool_call": return "text-purple-400";
    case "step": return "text-primary";
    case "narration": return "text-muted-foreground";
    default: return "text-muted-foreground";
  }
}

function ActionLogLiveRow({ entry, showCodePreview }: { entry: ActionLogEntry; showCodePreview?: boolean }) {
  const color = getActionLogColor(entry.type);
  const icon = getActionLogIcon(entry.type);
  const label = entry.label.length > 50 ? entry.label.slice(0, 50) + "…" : entry.label;
  const isFileEntry = entry.type === "file_write" || entry.type === "file_read";

  return (
    <div className="space-y-0">
      <div className={cn("flex items-center gap-1.5 py-0.5 text-[11px]", color)}>
        {icon}
        <span className="truncate leading-tight font-medium">{label}</span>
        {isFileEntry && entry.filePath && (
          <span className="ml-auto shrink-0 text-muted-foreground/40 text-[10px] font-mono">{entry.filePath}</span>
        )}
      </div>
      {showCodePreview && isFileEntry && entry.detail && entry.detail.trim().length > 0 && (
        <div
          className="rounded overflow-hidden text-[10px] font-mono leading-relaxed max-h-[120px] overflow-y-hidden relative"
          style={{ backgroundColor: "#1E1E1E", color: "#D4D4D4" }}
        >
          <div className="absolute inset-x-0 bottom-0 h-8 pointer-events-none" style={{ background: "linear-gradient(transparent, #1E1E1E)" }} />
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <tbody>
              {entry.detail.split("\n").slice(0, 20).map((line, li) => (
                <tr key={li} style={{ height: "17px" }}>
                  <td
                    className="select-none text-right sticky left-0"
                    style={{ padding: "0 5px", color: "#858585", width: "32px", minWidth: "32px", borderRight: "1px solid #333", backgroundColor: "#1E1E1E" }}
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

function ThinkingStream({ text }: { text: string }) {
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
        <span className="text-[10px] font-semibold text-blue-400/80 uppercase tracking-wide">Thinking</span>
      </div>
      <p className="text-[12px] leading-relaxed italic text-muted-foreground/80 whitespace-pre-wrap break-words">
        {text}
      </p>
    </div>
  );
}

function CollapsedThinking({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-blue-400/15 overflow-hidden" data-testid="collapsed-thinking">
      <button
        className="w-full flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-blue-400/70 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpanded(e => !e)}
        data-testid="button-expand-thinking"
      >
        <Brain className="w-3 h-3 shrink-0" />
        <span className="flex-1 truncate leading-tight font-medium">Thinking</span>
        <span className="shrink-0 text-muted-foreground/40">
          {expanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
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

function ActionLogLive({ entries, thinkingText, narrationText }: { entries: ActionLogEntry[]; thinkingText?: string; narrationText?: string }) {
  const last5 = entries.slice(-5);

  const thinkingEntries = entries.filter(e => e.type === "thinking");
  const nonThinkingEntries = last5.filter(e => e.type !== "thinking");
  const lastFileIdx = [...nonThinkingEntries].map((e, i) => ({ e, i })).filter(({ e }) => e.type === "file_write" || e.type === "file_read").pop()?.i ?? -1;

  return (
    <div className="px-3 py-2 space-y-1.5" data-testid="action-log-live">
      {thinkingText && (
        <ThinkingStream text={thinkingText} />
      )}
      {!thinkingText && thinkingEntries.map((entry, i) => (
        <CollapsedThinking key={`t-${i}`} text={entry.detail} />
      ))}
      {narrationText && !thinkingText && (
        <div className="flex items-start gap-1.5 py-0.5 text-[11px]" data-testid="narration-live-text">
          <MessageSquare className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground/50" />
          <span className="leading-relaxed text-foreground/70 line-clamp-3">
            {narrationText}
          </span>
        </div>
      )}
      {nonThinkingEntries.map((entry, i) => (
        <ActionLogLiveRow key={i} entry={entry} showCodePreview={i === lastFileIdx} />
      ))}
    </div>
  );
}

function ActionLogChip({ entry, index }: { entry: ActionLogEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const color = getActionLogColor(entry.type);
  const icon = getActionLogIcon(entry.type);
  const label = entry.label.length > 45 ? entry.label.slice(0, 45) + "…" : entry.label;
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
          color
        )}
        onClick={() => hasDetail && setExpanded(e => !e)}
        disabled={!hasDetail}
        data-testid={`button-action-chip-${index}`}
      >
        {icon}
        <span className="flex-1 truncate leading-tight">{label}</span>
        {hasDetail && (
          <span className="shrink-0 text-muted-foreground/40">
            {expanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
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
                        style={{ padding: "0 6px", color: "#858585", width: "36px", minWidth: "36px", borderRight: "1px solid #333333", backgroundColor: "#1E1E1E" }}
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

function ActionLogCollapsed({ entries }: { entries: ActionLogEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayEntries = showAll ? entries : entries.slice(0, 6);
  const hasMore = entries.length > 6;

  return (
    <div className="px-3 py-2 space-y-1" data-testid="action-log-collapsed">
      <div className="flex items-center gap-1.5 mb-1.5">
        <ListChecks className="w-3 h-3 text-muted-foreground/60" />
        <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
          Actions ({entries.length})
        </span>
      </div>
      {displayEntries.map((entry, i) => (
        entry.type === "thinking" ? (
          <CollapsedThinking key={i} text={entry.detail} />
        ) : (
          <ActionLogChip key={i} entry={entry} index={i} />
        )
      ))}
      {hasMore && !showAll && (
        <button
          className="text-[10px] text-primary/70 hover:text-primary transition-colors flex items-center gap-1 mt-1"
          onClick={() => setShowAll(true)}
          data-testid="button-show-all-actions"
        >
          <ChevronDown className="w-3 h-3" />
          Show {entries.length - 6} more actions
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

interface ParsedCompletion {
  headline: string;
  fileChanges: string[];
  specialNotes: string;
}

function parseCompletionSummary(raw: string): ParsedCompletion | null {
  // Extract content between markers without using dotAll flag (s) for compat
  function extractMarker(text: string, marker: string): string | null {
    const idx = text.indexOf(`[${marker}]`);
    if (idx === -1) return null;
    const start = idx + marker.length + 2;
    const nextBracket = text.indexOf("[", start);
    const end = nextBracket !== -1 ? nextBracket : text.length;
    return text.slice(start, end).trim();
  }

  const headline = extractMarker(raw, "HEADLINE");
  const fileChanges: string[] = [];
  let n = 1;
  while (true) {
    const change = extractMarker(raw, `FILE_CHANGE_${n}`);
    if (!change) break;
    fileChanges.push(change);
    n++;
  }
  const specialNotes = extractMarker(raw, "SPECIAL_NOTES");

  if (!headline && fileChanges.length === 0 && !specialNotes) return null;
  return {
    headline: headline || "",
    fileChanges,
    specialNotes: specialNotes || "",
  };
}

function BuildCompletionCard({ changedFiles, summary, userLang }: { changedFiles: string[]; summary?: string; userLang?: string }) {
  const lang = userLang?.toLowerCase().includes("chinese") || userLang === "zh" ? "zh" : "en";
  const isZh = lang === "zh";
  const [showFiles, setShowFiles] = useState(false);

  const defaultHeadline = isZh ? "✅ 构建完成！" : "✅ Build complete!";
  const filesLabel = isZh ? "查看变更文件" : "View changed files";
  const hideFilesLabel = isZh ? "隐藏文件" : "Hide files";
  const generatingLabel = isZh ? "正在生成摘要…" : "Generating summary…";
  const whatBuiltLabel = isZh ? "构建内容" : "What was built";
  const nextStepsLabel = isZh ? "下一步" : "Next steps";

  const parsed = summary ? parseCompletionSummary(summary) : null;
  const headline = parsed?.headline || defaultHeadline;

  return (
    <div
      className="mx-3 mt-2 mb-1 rounded-lg border border-green-500/25 bg-green-500/[0.04] overflow-hidden"
      data-testid="build-completion-card"
    >
      <div className="px-3 py-2 border-b border-green-500/15 flex items-start gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
        <span className="text-[12.5px] font-semibold text-green-500 leading-snug" data-testid="completion-headline">
          {headline}
        </span>
      </div>

      {!summary && (
        <div className="px-3 py-2">
          <p className="text-[11px] text-muted-foreground italic">{generatingLabel}</p>
        </div>
      )}

      {parsed && parsed.fileChanges.length > 0 && (
        <div className="px-3 py-2.5 space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide">{whatBuiltLabel}</p>
          <ol className="space-y-1.5 list-none">
            {parsed.fileChanges.map((change, i) => (
              <li key={i} className="flex items-start gap-2 text-[11.5px] text-foreground/75" data-testid={`file-change-${i}`}>
                <span className="shrink-0 w-4 h-4 rounded-full bg-green-500/15 text-green-500 text-[9px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span className="leading-relaxed">{change}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {parsed && !parsed.fileChanges.length && summary && (
        <div className="px-3 py-2">
          <p className="text-[11.5px] text-foreground/75 leading-relaxed whitespace-pre-wrap">{summary}</p>
        </div>
      )}

      {parsed?.specialNotes && (
        <div className="px-3 py-2 border-t border-green-500/10">
          <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1">{nextStepsLabel}</p>
          <p className="text-[11.5px] text-foreground/70 leading-relaxed" data-testid="completion-special-notes">{parsed.specialNotes}</p>
        </div>
      )}

      {changedFiles.length > 0 && (
        <div className="border-t border-green-500/10">
          <button
            className="w-full px-3 py-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors"
            onClick={() => setShowFiles(v => !v)}
            data-testid="toggle-changed-files"
          >
            <FileCode className="w-3 h-3 shrink-0" />
            <span>{showFiles ? hideFilesLabel : filesLabel} ({changedFiles.length})</span>
          </button>
          {showFiles && (
            <div className="px-3 pb-2 space-y-1">
              {changedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px] text-foreground/50 font-mono" data-testid={`changed-file-${i}`}>
                  <span className="truncate">{f}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function detectLanguage(text: string): string {
  const chineseRe = /[\u4e00-\u9fff]/;
  return chineseRe.test(text) ? "Chinese" : "English";
}

type PlanCardLang = "Chinese" | "English";

const planCardStrings: Record<PlanCardLang, Record<string, string>> = {
  Chinese: {
    startBuilding: "开始构建",
    revisePlan: "修改方案",
    buildNow: "立即构建",
    showAllSteps: "显示全部 {n} 步",
    collapse: "收起",
    viewFullPlan: "查看完整方案",
    stop: "停止",
    allStepsBuilt: "全部 {n} 步已完成",
    stepsDone: "{done}/{total} 步已完成",
    allVerified: "所有步骤已完成并验证 ✓",
    needsInput: "需要您的输入：",
    pleaseRespond: "请回复：",
    approve: "确认",
    submitContinue: "提交并继续",
    inputPlaceholder: "在此输入您的回复...",
    completed: "已完成",
    building: "构建中...",
    reviewing: "正在审查项目...",
    reviewPassed: "审查通过",
    reviewPassedPct: "审查通过 ({pct}%)",
    issuesFound: "发现 {n} 个问题",
    issuesFoundGeneric: "发现问题",
    fixingIssues: "修复问题中（第 {n}/3 轮）...",
    thinking: "思考中...",
    planning: "规划中...",
    whatAndWhy: "任务目标",
    whatAndWhyNone: "未指定目标",
    doneLooksLike: "完成后是什么样",
    doneLooksLikeNone: "未指定完成标准",
    outOfScope: "暂不包含",
    outOfScopeNone: "无特别限制",
    tasks: "任务步骤",
    relevantFiles: "相关文件",
    overview: "概述",
    viewPlanDoc: "查看完整方案文档",
  },
  English: {
    startBuilding: "Start building",
    revisePlan: "Revise Plan",
    buildNow: "Build Now",
    showAllSteps: "Show all {n} steps",
    collapse: "Collapse",
    viewFullPlan: "View full plan",
    stop: "Stop",
    allStepsBuilt: "All {n} steps built",
    stepsDone: "{done}/{total} steps done",
    allVerified: "All steps built & verified ✓",
    needsInput: "Needs your input:",
    pleaseRespond: "Please respond:",
    approve: "Approve",
    submitContinue: "Submit & Continue",
    inputPlaceholder: "Type your response here...",
    completed: "Completed",
    building: "Building...",
    reviewing: "Reviewing project...",
    reviewPassed: "Review passed",
    reviewPassedPct: "Review passed ({pct}%)",
    issuesFound: "{n} issues found",
    issuesFoundGeneric: "Issues found",
    fixingIssues: "Fixing issues (cycle {n}/3)...",
    thinking: "Thinking...",
    planning: "Planning...",
    whatAndWhy: "What & Why",
    whatAndWhyNone: "Not specified",
    doneLooksLike: "Done looks like",
    doneLooksLikeNone: "Not specified",
    outOfScope: "Out of scope",
    outOfScopeNone: "Nothing specific noted",
    tasks: "Tasks",
    relevantFiles: "Relevant files",
    overview: "Overview",
    viewPlanDoc: "View plan document",
  },
};

function t(lang: PlanCardLang, key: string, vars?: Record<string, string | number>): string {
  let str = planCardStrings[lang]?.[key] || planCardStrings.English[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, String(v));
    }
  }
  return str;
}

function usePlanCardLang(): PlanCardLang {
  const { lang } = useLanguageStore();
  return lang === "zh" ? "Chinese" : "English";
}

function getPlanCardLang(): PlanCardLang {
  const lang = useLanguageStore.getState().lang;
  return lang === "zh" ? "Chinese" : "English";
}


function normalizeSteps(plan: any): ManagerSubTask[] {
  const raw = plan?.steps ?? plan?.sub_tasks;
  if (!Array.isArray(raw)) return [];
  return raw.map((t: any, i: number) => ({
    step: t.step ?? i + 1,
    sub_task_id: t.sub_task_id ?? "",
    title: t.title ?? t.description?.slice(0, 50) ?? `Step ${i + 1}`,
    description: t.description ?? "",
    acceptance_criteria: t.acceptance_criteria ?? "",
    required_files: Array.isArray(t.required_files) ? t.required_files : [],
  }));
}

const PROJECT_NAME_REGEX = /\[\[PROJECT_NAME:([^\]]+)\]\]/;
const PROJECT_NAME_REGEX_GLOBAL = /\[\[PROJECT_NAME:[^\]]+\]\]/g;

function stripProjectNameMarker(text: string): string {
  return text.replace(PROJECT_NAME_REGEX_GLOBAL, "").trim();
}

interface CodeBlock {
  language: string;
  filePath: string;
  code: string;
}

const PLAIN_FENCE_RE = /```[\w]*\n[\s\S]*?```/g;

function stripPlainFences(text: string): string {
  return text.replace(PLAIN_FENCE_RE, "").trim();
}

function parseCodeBlocks(content: string): Array<string | CodeBlock> {
  const parts: Array<string | CodeBlock> = [];
  const regex = /```(\w*)\s+file="([^"]+)"\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const segment = stripPlainFences(content.slice(lastIndex, match.index));
      if (segment) parts.push(segment);
    }
    parts.push({
      language: match[1] || "text",
      filePath: match[2],
      code: match[3].trimEnd(),
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    const segment = stripPlainFences(content.slice(lastIndex));
    if (segment) parts.push(segment);
  }

  return parts;
}

function extractCodeBlocks(content: string): CodeBlock[] {
  return parseCodeBlocks(content).filter(
    (part): part is CodeBlock => typeof part !== "string"
  );
}

function formatRelativeTime(timestamp: number): string {
  const lang = useLanguageStore.getState().lang;
  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);
  if (diff < 10) return tr(lang, "chat.timeJustNow");
  if (diff < 60) return tr(lang, "chat.timeSAgo", { n: String(diff) });
  const mins = Math.floor(diff / 60);
  if (mins < 60) return tr(lang, "chat.timeMAgo", { n: String(mins) });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tr(lang, "chat.timeHAgo", { n: String(hours) });
  return tr(lang, "chat.timeDAgo", { n: String(Math.floor(hours / 24)) });
}

const THEME_COLORS = {
  "vs-dark": {
    keyword: "#569CD6",
    string: "#CE9178",
    comment: "#6A9955",
    tag: "#569CD6",
    property: "#9CDCFE",
    number: "#B5CEA8",
    attr: "#92C5F7",
    foreground: "#D4D4D4",
    lineNum: "#858585",
    bg: "#1E1E1E",
    lineBorder: "#333333",
    lineHover: "rgba(255,255,255,0.04)",
  },
  "vs-light": {
    keyword: "#0000FF",
    string: "#A31515",
    comment: "#008000",
    tag: "#800000",
    property: "#001080",
    number: "#098658",
    attr: "#FF0000",
    foreground: "#000000",
    lineNum: "#999999",
    bg: "#FFFFFF",
    lineBorder: "#E8E8E8",
    lineHover: "rgba(0,0,0,0.03)",
  },
  "hc-black": {
    keyword: "#569CD6",
    string: "#CE9178",
    comment: "#7CA668",
    tag: "#569CD6",
    property: "#9CDCFE",
    number: "#B5CEA8",
    attr: "#92C5F7",
    foreground: "#FFFFFF",
    lineNum: "#AAAAAA",
    bg: "#000000",
    lineBorder: "#6FC3DF",
    lineHover: "rgba(255,255,255,0.08)",
  },
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface Token { type: string; text: string; }

function findTagEnd(code: string, start: number): number {
  let j = start;
  while (j < code.length) {
    if (code[j] === '"' || code[j] === "'") {
      const q = code[j];
      j++;
      while (j < code.length && code[j] !== q) j++;
      j++;
      continue;
    }
    if (code[j] === ">") return j;
    j++;
  }
  return -1;
}

function tokenizeLine(code: string, lang: "html" | "css" | "js" | "text"): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let inCssBlock = false;
  for (let ci = 0; ci < i && ci < code.length; ci++) {
    if (code[ci] === "{") inCssBlock = true;
    if (code[ci] === "}") inCssBlock = false;
  }

  while (i < code.length) {
    if (lang === "html" && code.slice(i, i + 4) === "<!--") {
      const end = code.indexOf("-->", i + 4);
      if (end !== -1) {
        tokens.push({ type: "comment", text: code.slice(i, end + 3) });
        i = end + 3;
        continue;
      } else {
        tokens.push({ type: "comment", text: code.slice(i) });
        return tokens;
      }
    }

    if ((lang === "js" || lang === "css") && code[i] === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end !== -1) {
        tokens.push({ type: "comment", text: code.slice(i, end + 2) });
        i = end + 2;
        continue;
      } else {
        tokens.push({ type: "comment", text: code.slice(i) });
        return tokens;
      }
    }

    if ((lang === "js" || lang === "css") && code[i] === "/" && code[i + 1] === "/") {
      tokens.push({ type: "comment", text: code.slice(i) });
      return tokens;
    }

    if (code[i] === '"' || code[i] === "'") {
      const quote = code[i];
      let j = i + 1;
      while (j < code.length && code[j] !== quote) {
        if (code[j] === "\\") j++;
        j++;
      }
      if (lang === "html" && i > 0) {
        let prev = i - 1;
        while (prev >= 0 && code[prev] === " ") prev--;
        if (code[prev] === "=") {
          tokens.push({ type: "string", text: code.slice(i, j + 1) });
          i = j + 1;
          continue;
        }
      }
      tokens.push({ type: "string", text: code.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    if (lang === "js" && code[i] === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== "`") {
        if (code[j] === "\\") j++;
        j++;
      }
      tokens.push({ type: "string", text: code.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    if (lang === "html" && code[i] === "<") {
      if (code.slice(i, i + 9).toLowerCase() === "<!doctype") {
        const end = findTagEnd(code, i + 1);
        if (end !== -1) {
          tokens.push({ type: "tag", text: code.slice(i, end + 1) });
          i = end + 1;
          continue;
        }
      }

      const end = findTagEnd(code, i + 1);
      if (end !== -1) {
        tokens.push({ type: "tag", text: "<" });
        const inner = code.slice(i + 1, end);
        let k = 0;
        let nameStart = 0;
        if (inner[0] === "/") {
          tokens.push({ type: "tag", text: "/" });
          nameStart = 1;
          k = 1;
        }
        let nameEnd = k;
        while (nameEnd < inner.length && /[a-zA-Z0-9_:-]/.test(inner[nameEnd])) nameEnd++;
        if (nameEnd > k) {
          tokens.push({ type: "tag", text: inner.slice(k, nameEnd) });
        }
        k = nameEnd;

        while (k < inner.length) {
          if (inner[k] === " " || inner[k] === "\t" || inner[k] === "\n") {
            let ws = k;
            while (ws < inner.length && (inner[ws] === " " || inner[ws] === "\t" || inner[ws] === "\n")) ws++;
            tokens.push({ type: "plain", text: inner.slice(k, ws) });
            k = ws;
            continue;
          }
          if (inner[k] === "/" && k === inner.length - 1) {
            tokens.push({ type: "tag", text: "/" });
            k++;
            continue;
          }
          if (/[a-zA-Z_@:]/.test(inner[k])) {
            let ae = k;
            while (ae < inner.length && /[a-zA-Z0-9_:.-]/.test(inner[ae])) ae++;
            const attrName = inner.slice(k, ae);
            tokens.push({ type: "attr", text: attrName });
            k = ae;
            let ws = k;
            while (ws < inner.length && inner[ws] === " ") ws++;
            if (inner[ws] === "=") {
              tokens.push({ type: "plain", text: inner.slice(k, ws + 1) });
              k = ws + 1;
              while (k < inner.length && inner[k] === " ") {
                tokens.push({ type: "plain", text: " " });
                k++;
              }
              if (k < inner.length && (inner[k] === '"' || inner[k] === "'")) {
                const q = inner[k];
                let qe = k + 1;
                while (qe < inner.length && inner[qe] !== q) qe++;
                tokens.push({ type: "string", text: inner.slice(k, qe + 1) });
                k = qe + 1;
              }
            }
            continue;
          }
          tokens.push({ type: "plain", text: inner[k] });
          k++;
        }
        tokens.push({ type: "tag", text: ">" });
        i = end + 1;
        continue;
      }
    }

    if ((lang === "js" || lang === "css") && /[0-9]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[0-9a-fA-Fx.%emsvwrhin]/.test(code[j])) j++;
      tokens.push({ type: "number", text: code.slice(i, j) });
      i = j;
      continue;
    }

    if (lang === "js" && /[a-zA-Z_$]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      const keywords = new Set([
        "function", "const", "let", "var", "if", "else", "return", "class",
        "import", "export", "async", "await", "true", "false", "null",
        "undefined", "new", "this", "super", "for", "while", "do", "switch",
        "case", "break", "continue", "default", "try", "catch", "finally",
        "throw", "typeof", "instanceof", "in", "of", "from", "extends",
        "yield", "void", "delete", "debugger", "with",
      ]);
      tokens.push({ type: keywords.has(word) ? "keyword" : "plain", text: word });
      i = j;
      continue;
    }

    if (lang === "css" && code[i] === "@") {
      tokens.push({ type: "keyword", text: "@" });
      i++;
      let j = i;
      while (j < code.length && /[a-zA-Z-]/.test(code[j])) j++;
      if (j > i) {
        tokens.push({ type: "keyword", text: code.slice(i, j) });
        i = j;
      }
      continue;
    }

    if (lang === "css" && /[a-zA-Z_-]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_-]/.test(code[j])) j++;
      const word = code.slice(i, j);
      let afterWord = j;
      while (afterWord < code.length && code[afterWord] === " ") afterWord++;
      const lineBeforeWord = code.slice(0, i);
      const hasOpenBrace = lineBeforeWord.includes("{") || lineBeforeWord.trimStart().match(/^[a-z-]+\s*:/);
      if (code[afterWord] === ":" && code[afterWord + 1] !== ":" && hasOpenBrace) {
        tokens.push({ type: "property", text: word });
      } else {
        tokens.push({ type: "plain", text: word });
      }
      i = j;
      continue;
    }

    if (lang === "css" && code[i] === "#") {
      let j = i + 1;
      while (j < code.length && /[0-9a-fA-F]/.test(code[j])) j++;
      if (j - i > 1 && (j - i === 4 || j - i === 7 || j - i === 9)) {
        tokens.push({ type: "number", text: code.slice(i, j) });
        i = j;
        continue;
      }
    }

    if (lang === "html" && code[i] === "&") {
      let j = i + 1;
      while (j < code.length && j - i < 10 && code[j] !== ";") j++;
      if (code[j] === ";") {
        tokens.push({ type: "plain", text: code.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
    }

    tokens.push({ type: "plain", text: code[i] });
    i++;
  }

  return tokens;
}

function CodeBlockView({ block, applied }: { block: CodeBlock; autoApplied?: boolean; applied?: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  const { openFile, theme } = useIDEStore();
  const tGlobalRef = useT();
  const fileName = block.filePath.split("/").pop() || block.filePath;
  const lineCount = block.code.split("\n").length;

  const colors = THEME_COLORS[theme] || THEME_COLORS["vs-dark"];

  const detectLang = (): "html" | "css" | "js" | "text" => {
    const lang = block.language.toLowerCase();
    if (lang === "html" || fileName.endsWith(".html")) return "html";
    if (lang === "css" || fileName.endsWith(".css")) return "css";
    if (lang === "javascript" || lang === "js" || lang === "jsx" || lang === "ts" || lang === "tsx" ||
        fileName.endsWith(".js") || fileName.endsWith(".jsx") || fileName.endsWith(".ts") || fileName.endsWith(".tsx"))
      return "js";
    return "text";
  };

  const lang = detectLang();

  const highlightLine = (line: string): string => {
    if (lang === "text") return escapeHtml(line);
    const tokens = tokenizeLine(line, lang);
    return tokens.map((t) => {
      const escaped = escapeHtml(t.text);
      const colorMap: Record<string, string> = {
        keyword: colors.keyword,
        string: colors.string,
        comment: colors.comment,
        tag: colors.tag,
        property: colors.property,
        number: colors.number,
        attr: colors.attr,
      };
      const c = colorMap[t.type];
      if (c) return `<span style="color:${c}">${escaped}</span>`;
      return escaped;
    }).join("");
  };

  return (
    <div className="w-full my-1 rounded-lg border border-border/50 overflow-hidden" data-testid={`code-block-${block.filePath}`}>
      <div
        className="flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-r from-muted/40 to-muted/20 cursor-pointer select-none hover:from-muted/60 hover:to-muted/40 transition-all text-[11px] text-muted-foreground font-medium"
        onClick={() => setCollapsed((c) => !c)}
        data-testid={`toggle-code-${block.filePath}`}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {collapsed ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
          <FileCode className="w-3 h-3 shrink-0" />
          <span className="truncate text-foreground/80">{fileName}</span>
          <span className="shrink-0 text-muted-foreground/50">{lineCount}L</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {applied && (
            <span className="inline-flex items-center gap-0.5 text-green-500/80 text-[10px] font-medium" data-testid={`applied-${block.filePath}`}>
              <Check className="w-3 h-3" />
              {tGlobalRef("chat.applied")}
            </span>
          )}
          <button
            className="inline-flex items-center gap-1 text-primary/70 hover:text-primary hover:bg-primary/10 px-2 py-1 rounded transition-all text-[10px] font-medium"
            onClick={(e) => { e.stopPropagation(); openFile(block.filePath); }}
            data-testid={`button-open-${block.filePath}`}
          >
            <ExternalLink className="w-3 h-3" />
            <span>{tGlobalRef("chat.open")}</span>
          </button>
        </div>
      </div>
      {!collapsed && (
        <div
          className="overflow-x-auto text-[11px] leading-[1.6] border-t border-border/20 max-h-[240px] overflow-y-auto font-mono"
          style={{ backgroundColor: colors.bg, color: colors.foreground }}
        >
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <tbody>
              {block.code.split("\n").map((line, idx) => (
                <tr key={idx} style={{ height: "20px" }}>
                  <td
                    className="select-none text-right sticky left-0"
                    style={{
                      padding: "0 8px",
                      color: colors.lineNum,
                      width: "44px",
                      minWidth: "44px",
                      borderRight: `1px solid ${colors.lineBorder}`,
                      backgroundColor: colors.bg,
                      userSelect: "none",
                    }}
                  >
                    {idx + 1}
                  </td>
                  <td style={{ padding: "0 12px", whiteSpace: "pre" }}>
                    <code dangerouslySetInnerHTML={{ __html: highlightLine(line) }} />
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

const SUMMARY_HEADERS = [
  "Here's what I did:",
  "Here's what I did：",
  "Here's what I changed:",
  "Here's what I changed：",
  "Here's what I built:",
  "Here's what I built：",
  "Here's what I accomplished:",
  "Here's what I accomplished：",
  "以下是我做的改动：",
  "以下是我做的改动:",
  "我做了以下改动：",
  "我做了以下改动:",
  "以下是我的改动：",
  "以下是我的改动:",
];

function findSummaryHeader(text: string): { index: number; length: number } | null {
  for (const header of SUMMARY_HEADERS) {
    const pattern = new RegExp(`(^|\\n)${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, "m");
    const match = pattern.exec(text);
    if (match) {
      const offset = match[0].startsWith("\n") ? 1 : 0;
      return { index: match.index + offset, length: header.length };
    }
  }
  return null;
}

function renderBoldMarkdown(str: string) {
  const lines = str.split("\n");
  return lines.map((line, lineIdx) => {
    const parts: Array<{ text: string; bold: boolean }> = [];
    const boldRegex = /\*\*(.+?)\*\*/g;
    let last = 0;
    let m;
    while ((m = boldRegex.exec(line)) !== null) {
      if (m.index > last) parts.push({ text: line.slice(last, m.index), bold: false });
      parts.push({ text: m[1], bold: true });
      last = boldRegex.lastIndex;
    }
    if (last < line.length) parts.push({ text: line.slice(last), bold: false });
    if (parts.length === 0) parts.push({ text: "", bold: false });

    return (
      <div key={lineIdx}>
        {parts.map((p, i) =>
          p.bold ? <strong key={i} className="font-semibold text-foreground">{p.text}</strong> : <span key={i}>{p.text}</span>
        )}
      </div>
    );
  });
}

function splitSummaryBody(text: string): { body: string; trailing: string } {
  const lines = text.split("\n");
  let bulletStarted = false;
  let endOfBulletBlock = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      bulletStarted = true;
    } else if (bulletStarted && trimmed.length > 0) {
      endOfBulletBlock = i;
      break;
    }
  }

  if (!bulletStarted) {
    return { body: text, trailing: "" };
  }

  if (endOfBulletBlock === -1) {
    return { body: text, trailing: "" };
  }

  const body = lines.slice(0, endOfBulletBlock).join("\n");
  const trailing = lines.slice(endOfBulletBlock).join("\n");
  return { body, trailing };
}

function TextWithSummary({ text }: { text: string }) {
  const match = findSummaryHeader(text);

  if (!match) {
    return <div className="whitespace-pre-wrap">{text}</div>;
  }

  const before = text.slice(0, match.index);
  const headerText = text.slice(match.index, match.index + match.length);
  const after = text.slice(match.index + match.length);
  const { body, trailing } = splitSummaryBody(after);

  return (
    <div>
      {before.trim().length > 0 && <div className="whitespace-pre-wrap">{before}</div>}
      <div
        className="mt-1 rounded-lg border border-primary/15 bg-primary/[0.03] px-3 py-2.5"
        data-testid="changes-summary"
      >
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary/80 mb-1.5">
          <Check className="w-3.5 h-3.5" />
          {headerText}
        </div>
        <div className="text-[12.5px] leading-relaxed">
          {renderBoldMarkdown(body)}
        </div>
      </div>
      {trailing.trim().length > 0 && <div className="whitespace-pre-wrap mt-1">{trailing}</div>}
    </div>
  );
}

function MessageContent({ content, autoApplied, appliedBlockIndices }: { content: string; autoApplied?: boolean; appliedBlockIndices?: Set<number> }) {
  const parts = parseCodeBlocks(content);

  if (parts.length === 1 && typeof parts[0] === "string") {
    return <TextWithSummary text={parts[0]} />;
  }

  let blockIdx = 0;
  return (
    <>
      {parts.map((part, i) => {
        if (typeof part === "string") {
          return <TextWithSummary key={i} text={part} />;
        }
        const currentBlockIdx = blockIdx++;
        return (
          <CodeBlockView
            key={i}
            block={part}
            autoApplied={autoApplied}
            applied={autoApplied || appliedBlockIndices?.has(currentBlockIdx)}
          />
        );
      })}
    </>
  );
}

function MessageBubble({ message, autoApplied, appliedBlockIndices }: { message: ChatMessage; autoApplied?: boolean; appliedBlockIndices?: Set<number> }) {
  const isAssistant = message.role === "assistant";

  if (isAssistant) {
    return (
      <div
        className="px-3 text-[13px] leading-relaxed text-foreground"
        data-testid={`chat-message-${message.id}`}
      >
        <MessageContent content={message.content} autoApplied={autoApplied} appliedBlockIndices={appliedBlockIndices} />
      </div>
    );
  }

  return (
    <div className="flex justify-end px-3" data-testid={`chat-message-${message.id}`}>
      <div className="rounded-lg px-3.5 py-1.5 text-[13px] leading-relaxed bg-muted text-foreground max-w-[85%]">
        <MessageContent content={message.content} />
      </div>
    </div>
  );
}

function CheckpointMarker({ message }: { message: ChatMessage }) {
  const { restoreCheckpoint, refreshPreview, checkpoints } = useIDEStore();
  const [restored, setRestored] = useState(false);
  const tCp = useT();

  const isAvailable = message.checkpointId
    ? checkpoints.some((cp) => cp.id === message.checkpointId)
    : false;

  const handleRestore = () => {
    if (!message.checkpointId || !isAvailable) return;
    restoreCheckpoint(message.checkpointId);
    refreshPreview();
    setRestored(true);
    setTimeout(() => setRestored(false), 2000);
  };

  return (
    <div
      className={cn("px-3 flex items-center gap-1.5 text-[11px]", isAvailable ? "text-muted-foreground/60" : "text-muted-foreground/30")}
      data-testid={`checkpoint-${message.checkpointId}`}
    >
      <History className="w-3 h-3 shrink-0" />
      <span className="truncate">{message.content}</span>
      <span className="shrink-0">·</span>
      <span className="shrink-0">{formatRelativeTime(message.timestamp)}</span>
      {isAvailable && (
        <>
          <span className="shrink-0">·</span>
          <span
            className={cn(
              "shrink-0 cursor-pointer transition-colors",
              restored ? "text-green-500" : "hover:text-foreground"
            )}
            onClick={handleRestore}
            data-testid={`button-restore-${message.checkpointId}`}
          >
            {restored ? (
              <span className="inline-flex items-center gap-0.5">
                <Check className="w-3 h-3" />
                {tCp("chat.restored")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 underline underline-offset-2">
                <RotateCcw className="w-2.5 h-2.5" />
                {tCp("chat.restore")}
              </span>
            )}
          </span>
        </>
      )}
    </div>
  );
}

function TypingIndicator({ text }: { text?: string }) {
  const lang = usePlanCardLang();
  return (
    <div className="px-3 flex items-center gap-1.5" data-testid="typing-indicator">
      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{text || t(lang, "thinking")}</span>
    </div>
  );
}

function StepItem({ task, status, failureReason, isCompleted, showNumber }: {
  task: ManagerSubTask;
  status?: "pending" | "running" | "done" | "failed" | "needs-input" | "bug";
  failureReason?: string;
  isCompleted?: boolean;
  showNumber?: boolean;
}) {
  const s = status || "pending";
  const tStep = useT();
  const isRunning = s === "running";
  const isDone = s === "done";
  const icons: Record<string, JSX.Element> = {
    pending: <Circle className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />,
    running: <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />,
    done: <CheckCircle2 className={cn("w-3.5 h-3.5 shrink-0", isCompleted ? "text-muted-foreground/30" : "text-green-500")} />,
    failed: <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />,
    "needs-input": <HelpCircle className="w-3.5 h-3.5 text-yellow-500 shrink-0" />,
    bug: <AlertTriangle className="w-3.5 h-3.5 text-orange-500 shrink-0" />,
  };

  const failureReasonLabel = s === "failed"
    ? failureReason === "no_code" ? tStep("chat.noCodeOutput")
    : failureReason === "editor_error" ? tStep("chat.editorError")
    : null
    : null;

  return (
    <div
      className={cn(
        "py-1 px-1.5 rounded-md -mx-1.5 transition-colors",
        isRunning && "bg-blue-500/8"
      )}
      data-testid={`step-${task.step}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <div className="shrink-0">{icons[s] || icons.pending}</div>
        {showNumber && (
          <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0 w-4 text-right leading-none">
            {task.step}.
          </span>
        )}
        <span className={cn(
          "text-[12px] leading-snug flex-1",
          isCompleted ? "text-muted-foreground/40" :
          isDone ? "text-muted-foreground/60" :
          s === "failed" ? "text-red-400" :
          isRunning ? "text-foreground font-medium" :
          s === "needs-input" ? "text-yellow-500" :
          s === "bug" ? "text-orange-500" :
          "text-foreground/50"
        )}>
          {task.title}
        </span>
        {failureReasonLabel && (
          <span className="text-[10px] bg-red-500/15 text-red-400 border border-red-500/30 rounded px-1.5 py-0.5 shrink-0" data-testid={`step-failure-reason-${task.step}`}>
            {failureReasonLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function ReviewStatusBadge({ phase, fixCycle, review, lang }: {
  phase: ReviewPhase;
  fixCycle: number;
  review: HolisticReviewResult | null;
  lang: PlanCardLang;
}) {
  if (phase === "idle" || phase === "building") return null;

  const issueCount = review ? (review.bugs?.length || 0) + (review.missing_features?.length || 0) + (review.regressions?.length || 0) : 0;

  const configs: Record<string, { icon: JSX.Element; text: string; color: string }> = {
    reviewing: {
      icon: <Search className="w-3 h-3 animate-pulse" />,
      text: t(lang, "reviewing"),
      color: "text-amber-400",
    },
    review_passed: {
      icon: <ShieldCheck className="w-3 h-3" />,
      text: review ? t(lang, "reviewPassedPct", { pct: review.requirement_match_percent }) : t(lang, "reviewPassed"),
      color: "text-green-500",
    },
    review_failed: {
      icon: <AlertTriangle className="w-3 h-3" />,
      text: review ? t(lang, "issuesFound", { n: issueCount }) : t(lang, "issuesFoundGeneric"),
      color: "text-red-400",
    },
    fixing: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      text: t(lang, "fixingIssues", { n: fixCycle }),
      color: "text-orange-400",
    },
  };

  const config = configs[phase];
  if (!config) return null;

  return (
    <div className={cn("px-3 pb-2 flex items-center gap-1.5", config.color)} data-testid="review-status-badge">
      {config.icon}
      <span className="text-[10px] font-medium">{config.text}</span>
    </div>
  );
}

function TaskPlanCard({
  plan,
  taskStatuses,
  taskFailureReasons,
  onExecute,
  onRevise,
  isExecuting,
  onStop,
  onContinueWithInput,
  pendingConfirmation,
  confirmationInput,
  onConfirmationInputChange,
  reviewPhase,
  holisticReview,
  fixCycle,
  thinking,
}: {
  plan: ManagerPlan;
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "needs-input" | "bug">;
  taskFailureReasons?: Record<string, string>;
  onExecute?: () => void;
  onRevise?: () => void;
  isExecuting?: boolean;
  onStop?: () => void;
  onContinueWithInput?: (userInput?: string) => void;
  pendingConfirmation?: { stepKey: string; items: string[] } | null;
  confirmationInput?: string;
  onConfirmationInputChange?: (value: string) => void;
  reviewPhase?: ReviewPhase;
  holisticReview?: HolisticReviewResult | null;
  fixCycle?: number;
  thinking?: string;
}) {
  const lang = usePlanCardLang();
  const tCard = useT();
  const steps = normalizeSteps(plan);
  const doneCount = steps.filter((s) => taskStatuses[String(s.step)] === "done").length;
  const total = steps.length;
  const allDone = doneCount === total && total > 0;
  const hasNeedsInput = steps.some((s) => taskStatuses[String(s.step)] === "needs-input");
  const phase = reviewPhase || "idle";
  const hasReviewConfirmation = !!(pendingConfirmation?.stepKey === "review" && phase === "review_failed");
  const showConfirmation = hasNeedsInput || hasReviewConfirmation;
  const isFullyComplete = phase === "review_passed" && allDone;
  const isPreExecution = doneCount === 0 && !isExecuting && !isFullyComplete && onExecute;

  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const hasMore = steps.length > PREVIEW_STEP_COUNT;
  const visibleSteps = isPreExecution && !stepsExpanded
    ? steps.slice(0, PREVIEW_STEP_COUNT)
    : steps;
  const peekSteps = isPreExecution && hasMore && !stepsExpanded
    ? steps.slice(PREVIEW_STEP_COUNT, PREVIEW_STEP_COUNT + 2)
    : [];

  const whatAndWhy = plan.narrated_what_and_why || plan.what_and_why;
  const doneLooksLike = plan.narrated_done_looks_like || plan.done_looks_like;
  const outOfScope = plan.narrated_out_of_scope || plan.out_of_scope;
  const overview = plan.overview;
  const relevantFiles = plan.relevant_files;
  const hasRichSections = !!(overview || whatAndWhy || doneLooksLike || outOfScope);

  return (
    <>
      {thinking && (
        <div className="px-3 mb-0.5">
          <ThinkingToggle thinking={thinking} />
        </div>
      )}
      <div className={cn("mx-3 my-1 rounded-lg border overflow-hidden", isFullyComplete ? "border-green-500/30 bg-card/30" : "border-border/40 bg-card/50")} data-testid="task-plan-card">

        {hasRichSections ? (
          <>
            <div className="px-3 pt-2.5 pb-1.5 border-b border-border/20 flex items-center gap-2">
              <p className="text-[12px] font-medium text-foreground leading-snug flex-1 min-w-0">{plan.summary}</p>
              <button
                onClick={() => setModalOpen(true)}
                className="p-1 rounded hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground shrink-0"
                title={t(lang, "viewPlanDoc")}
                data-testid="button-view-plan-doc"
              >
                <FileText className="w-3 h-3" />
              </button>
            </div>
            <div className="px-3 pt-2 pb-2 border-b border-border/20">
              <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1">{t(lang, "whatAndWhy")}</p>
              <p className="text-[12px] text-foreground/80 leading-relaxed">{whatAndWhy || t(lang, "whatAndWhyNone")}</p>
            </div>
            <div className="px-3 py-2 border-b border-border/20">
              <p className="text-[10px] font-semibold text-green-500/70 uppercase tracking-wide mb-1">{t(lang, "doneLooksLike")}</p>
              <p className="text-[12px] text-foreground/80 leading-relaxed">{doneLooksLike || t(lang, "doneLooksLikeNone")}</p>
            </div>
            <div className="px-3 py-2 border-b border-border/20">
              <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1">{t(lang, "outOfScope")}</p>
              <p className="text-[12px] text-muted-foreground leading-relaxed">{outOfScope || t(lang, "outOfScopeNone")}</p>
            </div>

            <div className={cn("px-3 py-2", !(relevantFiles && relevantFiles.length > 0) && "border-b-0", "border-b border-border/20")}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide">{t(lang, "tasks")}</p>
                {isExecuting && total > 0 ? (
                  <span className="text-[10px] font-mono text-muted-foreground/60" data-testid="step-progress-counter">
                    {doneCount}/{total}
                  </span>
                ) : isPreExecution && hasMore ? (
                  <button
                    onClick={() => setStepsExpanded(!stepsExpanded)}
                    className="flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80 transition-colors"
                    data-testid="button-expand-steps"
                  >
                    {stepsExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                    {stepsExpanded ? t(lang, "collapse") : t(lang, "showAllSteps", { n: steps.length })}
                  </button>
                ) : null}
              </div>
              <div className="space-y-0">
                {visibleSteps.map((task: ManagerSubTask) => (
                  <StepItem
                    key={task.step}
                    task={task}
                    status={taskStatuses[String(task.step)]}
                    failureReason={taskFailureReasons?.[String(task.step)]}
                    isCompleted={isFullyComplete}
                    showNumber
                  />
                ))}
              </div>
              {peekSteps.length > 0 && !stepsExpanded && (
                <div className="relative mt-0">
                  <div className="space-y-0 blur-[2px] select-none pointer-events-none opacity-50">
                    {peekSteps.map((task: ManagerSubTask) => (
                      <StepItem
                        key={task.step}
                        task={task}
                        status={taskStatuses[String(task.step)]}
                        failureReason={taskFailureReasons?.[String(task.step)]}
                        isCompleted={isFullyComplete}
                        showNumber
                      />
                    ))}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-card/90 pointer-events-none" />
                </div>
              )}
            </div>

            {relevantFiles && relevantFiles.length > 0 && (
              <div className="px-3 py-2">
                <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1">{t(lang, "relevantFiles")}</p>
                <div className="flex flex-wrap gap-1">
                  {relevantFiles.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/50 text-[10px] text-muted-foreground font-mono" data-testid={`file-badge-${i}`}>
                      <FileCode className="w-2.5 h-2.5 shrink-0" />
                      {f.split("/").pop() || f}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : isPreExecution ? (
          <>
            <div className="px-3 pt-2.5 pb-1.5 flex items-start justify-between gap-2">
              <p className="text-[13px] leading-snug min-w-0 flex-1 text-foreground">{plan.summary || (plan as any).user_requirement || ""}</p>
              <button
                onClick={() => setModalOpen(true)}
                className="p-1 rounded hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground shrink-0"
                title={t(lang, "viewPlanDoc")}
                data-testid="button-view-plan-doc-preexec"
              >
                <FileText className="w-3 h-3" />
              </button>
            </div>
            <div className="relative px-3 pb-2">
              <div className="space-y-0">
                {visibleSteps.map((task: ManagerSubTask) => (
                  <StepItem key={task.step} task={task} status={taskStatuses[String(task.step)]} failureReason={taskFailureReasons?.[String(task.step)]} isCompleted={isFullyComplete} />
                ))}
              </div>
              {peekSteps.length > 0 && (
                <div className="relative mt-0">
                  <div className="space-y-0 blur-[2px] select-none pointer-events-none opacity-50">
                    {peekSteps.map((task: ManagerSubTask) => (
                      <StepItem key={task.step} task={task} status={taskStatuses[String(task.step)]} failureReason={taskFailureReasons?.[String(task.step)]} isCompleted={isFullyComplete} />
                    ))}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-card/90 pointer-events-none" />
                  <button
                    onClick={() => setStepsExpanded(true)}
                    className="flex items-center gap-1 mt-1 text-[11px] text-primary hover:text-primary/80 transition-colors"
                    data-testid="button-expand-steps"
                  >
                    <ChevronDown className="w-3 h-3" />
                    {t(lang, "showAllSteps", { n: steps.length })}
                  </button>
                </div>
              )}
              {stepsExpanded && hasMore && (
                <button
                  onClick={() => setStepsExpanded(false)}
                  className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-collapse-steps"
                >
                  <ChevronUp className="w-3 h-3" />
                  {t(lang, "collapse")}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="px-3 pb-2">
            {(plan.summary || (plan as any).user_requirement) && (
              <div className="flex items-start justify-between gap-2 pt-2.5 pb-1">
                <p className="text-[12px] text-foreground/70 leading-snug flex-1 min-w-0">
                  {plan.summary || (plan as any).user_requirement}
                </p>
                <button
                  onClick={() => setModalOpen(true)}
                  className="p-1 rounded hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground shrink-0"
                  title={t(lang, "viewPlanDoc")}
                  data-testid="button-view-plan-doc-completed"
                >
                  <FileText className="w-3 h-3" />
                </button>
              </div>
            )}
            {isExecuting && total > 0 && (
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wide">Steps</span>
                <span className="text-[10px] font-mono text-muted-foreground/60" data-testid="step-progress-counter">
                  {doneCount}/{total}
                </span>
              </div>
            )}
            <div className="space-y-0">
              {steps.map((task: ManagerSubTask) => (
                <StepItem
                  key={task.step}
                  task={task}
                  status={taskStatuses[String(task.step)]}
                  failureReason={taskFailureReasons?.[String(task.step)]}
                  isCompleted={isFullyComplete}
                />
              ))}
            </div>
          </div>
        )}

        {doneCount > 0 && !isFullyComplete && (
          <div className="px-3 pb-2 flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">
              {allDone ? t(lang, "allStepsBuilt", { n: total }) : t(lang, "stepsDone", { done: doneCount, total })}
            </span>
          </div>
        )}

        <ReviewStatusBadge phase={phase} fixCycle={fixCycle || 0} review={holisticReview || null} lang={lang} />

        {isFullyComplete && (
          <div className="px-3 pb-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-green-500" />
            <span className="text-[10px] text-green-500 font-medium">
              {t(lang, "allVerified")}
            </span>
          </div>
        )}

        {holisticReview && phase === "review_failed" && holisticReview.bugs.length > 0 && (
          <div className="px-3 pb-2" data-testid="review-bugs-list">
            {holisticReview.bugs.map((bug, i) => (
              <div key={bug.id || i} className="flex items-start gap-1.5 py-0.5">
                <XCircle className="w-2.5 h-2.5 text-red-400 mt-0.5 shrink-0" />
                <span className="text-[10px] text-red-400/80 leading-snug">
                  <span className="font-medium">[{bug.severity}]</span> {bug.description}
                </span>
              </div>
            ))}
          </div>
        )}

        {(() => {
          const inputs: string[] = plan.needs_input || (plan as any).user_confirmation_needed || [];
          return inputs.length > 0 && inputs[0] !== "" ? (
            <div className="px-3 pb-2">
              <div className="flex items-center gap-1 mb-0.5">
                <AlertTriangle className="w-3 h-3 text-yellow-500" />
                <span className="text-[10px] font-medium text-yellow-500">{t(lang, "needsInput")}</span>
              </div>
              {inputs.map((item, i) => (
                <p key={i} className="text-[11px] text-foreground/70 pl-4 leading-snug">• {item}</p>
              ))}
            </div>
          ) : null;
        })()}

        {showConfirmation && pendingConfirmation && onContinueWithInput && (
          <div className="px-3 pb-2 space-y-2" data-testid="confirmation-input-area">
            <div className="flex items-center gap-1 mb-1">
              <HelpCircle className="w-3 h-3 text-yellow-500" />
              <span className="text-[10px] font-medium text-yellow-500">{t(lang, "pleaseRespond")}</span>
            </div>
            {pendingConfirmation.items.map((item, i) => (
              <p key={i} className="text-[11px] text-foreground/80 pl-4 leading-snug">• {item}</p>
            ))}
            <Textarea
              value={confirmationInput || ""}
              onChange={(e) => onConfirmationInputChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onContinueWithInput(confirmationInput || "");
                }
              }}
              placeholder={t(lang, "inputPlaceholder")}
              className="resize-none text-[11px] min-h-[32px] max-h-[60px] bg-muted/30 border-border/30"
              rows={1}
              data-testid="input-confirmation"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-6 text-[10px]"
                onClick={() => onContinueWithInput(tCard("chat.looksGood"))}
                data-testid="button-approve-all"
              >
                <Check className="w-2.5 h-2.5 mr-0.5" />
                {t(lang, "approve")}
              </Button>
              <Button
                size="sm"
                className="flex-1 h-6 text-[10px]"
                onClick={() => onContinueWithInput(confirmationInput || "")}
                disabled={!confirmationInput?.trim()}
                data-testid="button-submit-confirmation"
              >
                <Send className="w-2.5 h-2.5 mr-0.5" />
                {t(lang, "submitContinue")}
              </Button>
            </div>
          </div>
        )}

        {isFullyComplete ? (
          <div className="px-3 py-2 border-t border-green-500/20">
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-[11px] border-green-500/30 text-green-500 cursor-default pointer-events-none"
              disabled
              data-testid="button-plan-completed"
            >
              <CheckCircle2 className="w-3 h-3 mr-1" />
              {t(lang, "completed")}
            </Button>
          </div>
        ) : onExecute && (
          <div className="px-3 py-2 border-t border-border/30">
            {isExecuting ? (
              <Button
                size="sm"
                variant="destructive"
                className="w-full h-7 text-[11px]"
                onClick={onStop}
                data-testid="button-stop-execution"
              >
                <StopCircle className="w-3 h-3 mr-1" />
                {t(lang, "stop")}
              </Button>
            ) : showConfirmation ? null : isPreExecution ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1.5"
                  onClick={onRevise}
                  data-testid="button-revise-plan"
                >
                  <PenLine className="w-3 h-3" />
                  {t(lang, "revisePlan")}
                </Button>
                <div className="flex-1" />
                <Button
                  size="sm"
                  className="h-7 text-[11px] gap-1.5"
                  onClick={onExecute}
                  data-testid="button-execute-plan"
                >
                  <Hammer className="w-3 h-3" />
                  {t(lang, "buildNow")}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                className="w-full h-7 text-[11px]"
                onClick={onExecute}
                data-testid="button-execute-plan"
              >
                <Play className="w-3 h-3 mr-1" />
                {t(lang, "startBuilding")}
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="!fixed !inset-0 !translate-x-0 !translate-y-0 !max-w-none !w-full !h-full !rounded-none flex flex-col p-0 overflow-hidden" data-testid="dialog-full-plan">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/30 shrink-0">
            <DialogTitle className="text-base font-semibold leading-snug pr-8">{plan.summary}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {overview && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1.5">{t(lang, "overview")}</p>
                <p className="text-[13px] text-foreground/80 leading-relaxed">{overview}</p>
              </div>
            )}
            {whatAndWhy && (
              <div>
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1.5">{t(lang, "whatAndWhy")}</p>
                <p className="text-[13px] text-foreground/80 leading-relaxed">{whatAndWhy}</p>
              </div>
            )}
            {doneLooksLike && (
              <div>
                <p className="text-[10px] font-semibold text-green-500/70 uppercase tracking-wide mb-1.5">{t(lang, "doneLooksLike")}</p>
                <p className="text-[13px] text-foreground/80 leading-relaxed">{doneLooksLike}</p>
              </div>
            )}
            {outOfScope && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1.5">{t(lang, "outOfScope")}</p>
                <p className="text-[13px] text-muted-foreground leading-relaxed">{outOfScope}</p>
              </div>
            )}
            <div className={cn((overview || whatAndWhy || doneLooksLike || outOfScope) && "border-t border-border/30 pt-4")}>
              <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">{t(lang, "tasks")}</p>
              <div className="space-y-3">
                {steps.map((step) => (
                  <div key={step.step} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full border border-border/60 bg-muted/40 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[10px] text-muted-foreground font-medium">{step.step}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-foreground">{step.title}</p>
                      {step.description && (
                        <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{step.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="px-6 py-4 border-t border-border/30 shrink-0 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => { setModalOpen(false); onRevise?.(); }}
              data-testid="button-revise-plan-modal"
            >
              <PenLine className="w-3 h-3" />
              {t(lang, "revisePlan")}
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => { setModalOpen(false); onExecute?.(); }}
              data-testid="button-build-now-modal"
            >
              <Hammer className="w-3 h-3" />
              {t(lang, "buildNow")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const PREVIEW_STEP_COUNT = 10;

function ManagerMessageBubble({
  message,
  taskStatuses,
  taskFailureReasons,
  onExecute,
  onRevise,
  isExecuting,
  onStop,
  onContinueWithInput,
  pendingConfirmation,
  confirmationInput,
  onConfirmationInputChange,
  reviewPhase,
  holisticReview,
  fixCycle,
}: {
  message: { role: string; content: string; plan?: ManagerPlan; source?: "communicator" | "manager_raw" | "manager"; typing?: boolean; thinking?: string };
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "needs-input" | "bug">;
  taskFailureReasons?: Record<string, string>;
  onExecute?: () => void;
  onRevise?: () => void;
  isExecuting?: boolean;
  onStop?: () => void;
  onContinueWithInput?: (userInput?: string) => void;
  pendingConfirmation?: { stepKey: string; items: string[] } | null;
  confirmationInput?: string;
  onConfirmationInputChange?: (value: string) => void;
  reviewPhase?: ReviewPhase;
  holisticReview?: HolisticReviewResult | null;
  fixCycle?: number;
}) {
  const tMb = useT();
  if (message.role === "user") {
    return (
      <div className="flex justify-end px-3">
        <div className="rounded-lg px-3.5 py-1.5 text-[13px] leading-relaxed bg-muted text-foreground max-w-[85%]">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.plan) {
    return (
      <TaskPlanCard
        plan={message.plan}
        taskStatuses={taskStatuses}
        taskFailureReasons={taskFailureReasons}
        onExecute={onExecute}
        onRevise={onRevise}
        isExecuting={isExecuting}
        onStop={onStop}
        onContinueWithInput={onContinueWithInput}
        pendingConfirmation={pendingConfirmation}
        confirmationInput={confirmationInput}
        onConfirmationInputChange={onConfirmationInputChange}
        reviewPhase={reviewPhase}
        holisticReview={holisticReview}
        fixCycle={fixCycle}
        thinking={message.thinking}
      />
    );
  }

  if (message.source === "manager_raw") {
    return null;
  }

  return <NarrationBubble message={message} />;
}

function ThinkingToggle({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5">
      <button
        className="flex items-center gap-1 text-[12px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        onClick={() => setOpen(o => !o)}
        data-testid="button-toggle-thinking"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="italic font-medium">(Thinking)</span>
      </button>
      {open && (
        <p className="mt-1 text-muted-foreground/60 italic whitespace-pre-wrap text-[12px] border-l-2 border-muted pl-2" data-testid="text-thinking-content">
          {thinking}
        </p>
      )}
    </div>
  );
}

function NarrationBubble({
  message,
}: {
  message: { role: string; content: string; source?: "communicator" | "manager_raw" | "manager"; thinking?: string; typing?: boolean };
}) {
  return (
    <div className="px-3 text-[13px] leading-relaxed text-foreground" data-testid="plan-message-bubble">
      {message.thinking && (
        <ThinkingToggle thinking={message.thinking} />
      )}
      {message.content && (
        <p className="text-foreground/90 whitespace-pre-wrap">{message.content}</p>
      )}
    </div>
  );
}

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const {
    chatMessages,
    addChatMessage,
    updateLastAssistantMessage,
    setActiveTool,
    isAiResponding,
    setAiResponding,
    files,
    pendingPrompt,
    clearPendingPrompt,
    projectId,
    refreshPreview,
    createCheckpoint,
    chatMode,
    setChatMode,
    managerPlan,
    setManagerPlan,
    managerMessages,
    addManagerMessage,
    taskStatuses,
    taskFailureReasons,
    updateTaskStatus,
    setTaskFailureReason,
    executingTaskIndex,
    setExecutingTaskIndex,
    isManagerResponding,
    setManagerResponding,
    clearManagerPlan,
    pendingConfirmation,
    setPendingConfirmation,
    userConfirmationInput,
    setUserConfirmationInput,
    reviewPhase,
    setReviewPhase,
    holisticReview,
    setHolisticReview,
    fixCycle,
    setFixCycle,
    selectedProvider,
    setSelectedProvider,
  } = useIDEStore();
  const { renameProject } = useProjectStore();
  const tGlobal = useT();
  const chatTitle = tGlobal("chat.title");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingHandled = useRef(false);
  const buildSessionIdRef = useRef<string | null>(null);
  const buildReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const userConfirmationRef = useRef<string>("");
  const autoExecutePlanRef = useRef(false);
  const handleExecutePlanRef = useRef<(() => Promise<void>) | null>(null);
  const [autoAppliedMessageIds] = useState<Set<string>>(new Set());
  const [appliedBlockIndices] = useState<Set<number>>(new Set());
  const [smartResponseLoading, setSmartResponseLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [buildPhase, setBuildPhase] = useState<"thinking" | "working" | "verifying" | "fixing" | null>(null);
  const inputBoxRef = useRef<HTMLDivElement>(null);
  const [providers, setProviders] = useState<{ doubao: boolean; kimi: boolean; minimax: boolean; glm: boolean }>({ doubao: true, kimi: false, minimax: false, glm: false });
  const [liveActionLog, setLiveActionLog] = useState<ActionLogEntry[]>([]);
  const [liveThinkingText, setLiveThinkingText] = useState<string>("");
  const [liveNarrationText, setLiveNarrationText] = useState<string>("");
  const [mgrPreparingPlan, setMgrPreparingPlan] = useState(false);
  const actionLogRef = useRef<ActionLogEntry[]>([]);
  const thinkingFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buildResultMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/providers")
      .then(r => r.json())
      .then((data: { doubao?: boolean; kimi?: boolean; minimax?: boolean; glm?: boolean }) => {
        const loaded = { doubao: !!data.doubao, kimi: !!data.kimi, minimax: !!data.minimax, glm: !!data.glm };
        setProviders(loaded);
        // If the persisted provider is unavailable, fall back to doubao
        const current = useIDEStore.getState().selectedProvider;
        if (current === "kimi" && !loaded.kimi) setSelectedProvider("doubao");
        if (current === "minimax" && !loaded.minimax) setSelectedProvider("doubao");
        if (current === "glm" && !loaded.glm) setSelectedProvider("doubao");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
    el.style.height = Math.min(el.scrollHeight, lineHeight * 10) + "px";
  }, [input]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages, managerMessages, liveActionLog, liveNarrationText, liveThinkingText]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(e.target as Node)) {
        setModeDropdownOpen(false);
      }
    };
    if (modeDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [modeDropdownOpen]);

  const applyCodeBlock = useCallback(async (block: CodeBlock) => {
    const currentState = useIDEStore.getState();
    const currentFiles = flattenFiles(currentState.files);
    const exists = currentFiles.some((f) => f.path === block.filePath);

    if (exists) {
      currentState.updateFileContent(block.filePath, block.code);
    } else {
      const lastSlash = block.filePath.lastIndexOf("/");
      if (lastSlash > 0) {
        const parentPath = block.filePath.substring(0, lastSlash);
        const fileName = block.filePath.substring(lastSlash + 1);
        currentState.addFile(parentPath, fileName, "file");
        await new Promise((r) => setTimeout(r, 80));
        useIDEStore.getState().updateFileContent(block.filePath, block.code);
      }
    }
  }, []);

  const BLOCKING_EVENTS = new Set(["needs_input", "plan_created"]);

  const callCommunicatorCore = useCallback(async (
    event: {
      event: string;
      userLanguage?: string;
      planSummary?: string;
      totalSteps?: number;
      stepTitles?: string[];
      stepNumber?: number;
      stepTitle?: string;
      stepDescription?: string;
      errorSummary?: string;
      confirmationItems?: string[];
      retryAttempt?: number;
      maxRetries?: number;
      reviewSummary?: string;
      bugCount?: number;
      fixCycle?: number;
      maxFixCycles?: number;
      whatAndWhy?: string;
      doneLooksLike?: string;
      outOfScope?: string;
      relevantFiles?: string[];
      changedFiles?: string[];
    },
  ): Promise<string> => {
    let messageInserted = false;
    try {
      const response = await fetch("/api/communicator-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event }),
      });

      if (!response.ok) return "";

      const reader = response.body?.getReader();
      if (!reader) return "";

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith("data: ")) {
            const data = trimmedLine.slice(6).trim();
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                accumulated += parsed.content;
                useLLMMonitorStore.getState().addEvent("communicator", "communicator_token", parsed.content);
                if (!messageInserted) {
                  addManagerMessage({ role: "assistant", content: accumulated, source: "communicator" });
                  messageInserted = true;
                } else {
                  const msgs = useIDEStore.getState().managerMessages;
                  const lastMsg = msgs[msgs.length - 1];
                  if (lastMsg && lastMsg.role === "assistant") {
                    useIDEStore.setState({
                      managerMessages: [
                        ...msgs.slice(0, -1),
                        { ...lastMsg, content: accumulated },
                      ],
                    });
                  }
                }
              }
            } catch {}
          }
        }
      }

      return accumulated;
    } catch {
      return "";
    }
  }, [addManagerMessage]);

  const callCommunicator = useCallback(async (
    event: Parameters<typeof callCommunicatorCore>[0],
  ): Promise<string> => {
    if (BLOCKING_EVENTS.has(event.event)) {
      return callCommunicatorCore(event);
    }
    callCommunicatorCore(event).catch(() => {});
    return "";
  }, [callCommunicatorCore]);

  const handleManagerSend = useCallback(async (overrideMessage?: string) => {
    const trimmed = overrideMessage?.trim() || input.trim();
    if (!trimmed || isManagerResponding || isAiResponding) return;

    addManagerMessage({ role: "user", content: trimmed });
    if (!overrideMessage) setInput("");

    const allFiles = flattenFiles(files);
    const fileContext = allFiles.map((f) => ({
      path: f.path,
      content: f.content || "",
    }));

    const currentMsgs = useIDEStore.getState().managerMessages;
    const messagesForApi = currentMsgs
      .filter((m) => !m.typing && (m.role === "user" || m.plan || (m.role === "assistant" && m.source !== "communicator")))
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.plan ? JSON.stringify(m.plan) : m.content,
      }));

    setManagerResponding(true);

    addManagerMessage({ role: "assistant", content: "", source: "communicator", typing: true });

    const removeTypingBubble = () => {
      const msgs = useIDEStore.getState().managerMessages;
      const typingIdx = msgs.findIndex((m) => m.typing === true);
      if (typingIdx !== -1) {
        useIDEStore.setState({ managerMessages: msgs.filter((_, i) => i !== typingIdx) });
      }
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/manager-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesForApi, files: fileContext, provider: useIDEStore.getState().selectedProvider }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        removeTypingBubble();
        addManagerMessage({ role: "assistant", content: tr(useLanguageStore.getState().lang, "chat.errorConnect"), source: "communicator" });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bufferStr = "";

      let managerAccumulated = "";
      let managerThinkingAccumulated = "";

      let commAccumulated = "";
      let commInserted = false;
      let commNarrationMsgIndex = -1;
      let commTypingIdx = -1;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        bufferStr += decoder.decode(value, { stream: true });
        const lines = bufferStr.split("\n");
        bufferStr = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith("data: ")) continue;
          const raw = trimmedLine.slice(6).trim();
          if (raw === "[DONE]") break;

          let ev: any;
          try { ev = JSON.parse(raw); } catch { continue; }

          const evType = ev.type;
          if (KNOWN_MGR_EVENT_TYPES.has(evType)) {
            const mgrMonitorContent = ev.token || (ev.plan ? "[plan object]" : (ev.message || ev.label || evType));
            useLLMMonitorStore.getState().addEvent(
              MGR_SOURCE_MAP[evType] || "manager",
              evType as LLMEventType,
              typeof mgrMonitorContent === "string" ? mgrMonitorContent : String(mgrMonitorContent),
            );
          }
          const isCurrentProject = useIDEStore.getState().projectId === projectId;

          if (evType === "thinking_token") {
            const token = (ev.token as string) || "";
            if (token) {
              managerThinkingAccumulated += token;
            }
          } else if (evType === "raw_token" || evType === "manager_token") {
            managerAccumulated += ev.token;
          } else if (evType === "plan_preparing") {
            if (!isCurrentProject) continue;
            setMgrPreparingPlan(true);
          } else if (evType === "plan_ready") {
            if (!isCurrentProject) continue;
            setMgrPreparingPlan(false);
            removeTypingBubble();
            const plan = ev.plan;
            const resolvedProjectName = ((ev.project_name as string | undefined) || "").trim() || undefined;
            if (projectId && resolvedProjectName) {
              renameProject(projectId, resolvedProjectName);
            }
            clearManagerPlan();
            const steps = normalizeSteps(plan);
            for (const step of steps) {
              updateTaskStatus(String(step.step), "pending");
            }
            setManagerPlan(plan);
            addManagerMessage({ role: "assistant", content: "", plan, thinking: managerThinkingAccumulated || undefined });
            if (chatMode === "build") {
              autoExecutePlanRef.current = true;
            }

            if (projectId) {
              const userPromptForCodestart = input.trim() || (useIDEStore.getState().managerMessages.find(m => m.role === "user")?.content || "");
              const currentFileNodes = flattenFiles(useIDEStore.getState().files);
              const currentFilesForCS = currentFileNodes.filter(f => f.path && !f.path.endsWith("codestart.md")).map(f => ({ path: f.path!, content: f.content || "" }));
              fetch("/api/generate-codestart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ plan, userPrompt: userPromptForCodestart, projectName: resolvedProjectName, currentFiles: currentFilesForCS }),
              }).then(async (r) => {
                if (!r.ok) return;
                const data = await r.json();
                if (data.content) {
                  useIDEStore.getState().updateFileContent("/project/codestart.md", data.content);
                }
              }).catch(() => {});
            }
          } else if (evType === "communicator_narration_starting") {
            if (!isCurrentProject) continue;
            const msgs = useIDEStore.getState().managerMessages;
            const tIdx = msgs.findIndex((m) => m.typing === true);
            commTypingIdx = tIdx;
          } else if (evType === "communicator_error") {
            if (isCurrentProject && commTypingIdx !== -1) {
              const msgs = useIDEStore.getState().managerMessages;
              if (msgs[commTypingIdx]?.typing) {
                useIDEStore.setState({ managerMessages: msgs.filter((_, i) => i !== commTypingIdx) });
              }
            }
            commTypingIdx = -1;
          } else if (evType === "communicator_token") {
            commAccumulated += ev.token;
            if (isCurrentProject) {
              if (!commInserted) {
                if (commTypingIdx !== -1) {
                  const msgs = useIDEStore.getState().managerMessages;
                  const target = msgs[commTypingIdx];
                  if (target?.typing) {
                    const updated = [...msgs];
                    updated[commTypingIdx] = { ...target, content: commAccumulated, typing: false, preparingPlan: undefined, source: "communicator" as const };
                    useIDEStore.setState({ managerMessages: updated });
                    commNarrationMsgIndex = commTypingIdx;
                    commTypingIdx = -1;
                  } else {
                    addManagerMessage({ role: "assistant", content: commAccumulated, source: "communicator" });
                    commNarrationMsgIndex = useIDEStore.getState().managerMessages.length - 1;
                  }
                } else {
                  addManagerMessage({ role: "assistant", content: commAccumulated, source: "communicator" });
                  commNarrationMsgIndex = useIDEStore.getState().managerMessages.length - 1;
                }
                commInserted = true;
              } else {
                const msgs = useIDEStore.getState().managerMessages;
                if (commNarrationMsgIndex >= 0 && commNarrationMsgIndex < msgs.length) {
                  const target = msgs[commNarrationMsgIndex];
                  if (target?.role === "assistant" && !target.plan) {
                    const updated = [...msgs];
                    updated[commNarrationMsgIndex] = { ...target, content: commAccumulated };
                    useIDEStore.setState({ managerMessages: updated });
                  }
                }
              }
              await new Promise<void>(r => setTimeout(r, 0));
            }
          } else if (evType === "manager_done") {
            if (!isCurrentProject) continue;
            setMgrPreparingPlan(false);
            const nameFromDone = (ev.project_name as string | undefined)?.trim();
            if (projectId && nameFromDone) {
              renameProject(projectId, nameFromDone);
            }

            if (managerAccumulated) {
              const canonical = stripProjectNameMarker(managerAccumulated);
              if (canonical) {
                let parsedPlan: any = null;
                try {
                  const trimmed = canonical.trim();
                  if (trimmed.startsWith("{")) {
                    const parsed = JSON.parse(trimmed);
                    if (parsed && typeof parsed === "object" && (parsed.overview || parsed.whatAndWhy || parsed.steps)) {
                      parsedPlan = parsed;
                    }
                  }
                } catch {
                }

                if (parsedPlan) {
                  removeTypingBubble();
                  const steps = normalizeSteps(parsedPlan);
                  if (steps.length > 0) {
                    clearManagerPlan();
                    for (const step of steps) {
                      updateTaskStatus(String(step.step), "pending");
                    }
                    setManagerPlan(parsedPlan);
                    addManagerMessage({ role: "assistant", content: "", plan: parsedPlan, thinking: managerThinkingAccumulated || undefined });
                  } else {
                    const fallbackText = parsedPlan.overview || parsedPlan.whatAndWhy || parsedPlan.title || JSON.stringify(parsedPlan);
                    const msgs = useIDEStore.getState().managerMessages;
                    const typingIdx = msgs.findIndex((m) => m.typing === true);
                    if (typingIdx !== -1) {
                      const updated = [...msgs];
                      updated[typingIdx] = { ...updated[typingIdx], typing: false, content: fallbackText, source: "manager" as const };
                      useIDEStore.setState({ managerMessages: updated });
                    } else {
                      addManagerMessage({ role: "assistant", content: fallbackText, source: "manager" });
                    }
                  }
                } else {
                  const msgs = useIDEStore.getState().managerMessages;
                  const typingIdx = msgs.findIndex((m) => m.typing === true);
                  if (typingIdx !== -1) {
                    const updated = [...msgs];
                    updated[typingIdx] = { ...updated[typingIdx], typing: false, content: canonical, source: "manager" as const };
                    useIDEStore.setState({ managerMessages: updated });
                  } else {
                    addManagerMessage({ role: "assistant", content: canonical, source: "manager" });
                  }
                }
              }
            }

            const archKeywords = ["architect", "restructur", "refactor", "replac", "migrat", "rewrite", "framework", "library", "dependenc", "api", "backend", "frontend", "database", "stack"];
            const managerText = managerAccumulated.toLowerCase();
            const hasArchChange = archKeywords.some(kw => managerText.includes(kw));
            const existingPlan = useIDEStore.getState().managerPlan;
            if (hasArchChange && existingPlan && projectId) {
              const promptMsg = useIDEStore.getState().managerMessages.find(m => m.role === "user");
              const archFileNodes = flattenFiles(useIDEStore.getState().files);
              const archCurrentFiles = archFileNodes.filter(f => f.path && !f.path.endsWith("codestart.md")).map(f => ({ path: f.path!, content: f.content || "" }));
              fetch("/api/generate-codestart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ plan: existingPlan, userPrompt: input.trim() || promptMsg?.content || "", projectName: undefined, currentFiles: archCurrentFiles }),
              }).then(async (r) => {
                if (!r.ok) return;
                const d = await r.json();
                if (d.content) useIDEStore.getState().updateFileContent("/project/codestart.md", d.content);
              }).catch(() => {});
            }
          } else if (evType === "manager_error") {
            if (!isCurrentProject) continue;
            removeTypingBubble();
            addManagerMessage({ role: "assistant", content: tr(useLanguageStore.getState().lang, "chat.errorConnect"), source: "communicator" });
          }
        }
      }

      if (useIDEStore.getState().projectId === projectId && commInserted && commAccumulated && commNarrationMsgIndex >= 0) {
        const friendlyLines = commAccumulated
          .split("\n")
          .filter((l) => !l.trim().match(/^\[PLAN[_ ]SUMMARY\]/i) && !l.trim().match(/^\[STEP[_ ]\d+\]/i) && !l.trim().match(/^\[WHAT[_ ]AND[_ ]WHY\]/i) && !l.trim().match(/^\[DONE[_ ]LOOKS[_ ]LIKE\]/i) && !l.trim().match(/^\[OUT[_ ]OF[_ ]SCOPE\]/i))
          .map((l) => l.trim())
          .filter(Boolean)
          .join("\n");
        const msgs = useIDEStore.getState().managerMessages;
        if (commNarrationMsgIndex < msgs.length) {
          const target = msgs[commNarrationMsgIndex];
          if (target?.role === "assistant" && !target.plan) {
            const updated = [...msgs];
            if (friendlyLines) {
              updated[commNarrationMsgIndex] = { ...target, content: friendlyLines };
            } else {
              updated.splice(commNarrationMsgIndex, 1);
            }
            useIDEStore.setState({ managerMessages: updated });
          }
        }
      }

      if (useIDEStore.getState().projectId === projectId && !commInserted && managerAccumulated) {
        const nameFromMarker = managerAccumulated.match(PROJECT_NAME_REGEX)?.[1]?.trim();
        if (nameFromMarker) renameProject(projectId, nameFromMarker);
      }
    } catch (error: any) {
      if (useIDEStore.getState().projectId === projectId) {
        removeTypingBubble();
        if (error?.name !== "AbortError") {
          addManagerMessage({ role: "assistant", content: tr(useLanguageStore.getState().lang, "chat.errorConnect"), source: "communicator" });
        }
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (useIDEStore.getState().projectId === projectId) {
        removeTypingBubble();
        setMgrPreparingPlan(false);
        if (!buildSessionIdRef.current) {
          setManagerResponding(false);
        }
      }
    }
  }, [input, isManagerResponding, isAiResponding, files, addManagerMessage, setManagerResponding, setManagerPlan, updateTaskStatus, projectId, renameProject, chatMode, clearManagerPlan]);

  const handleEditorSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isAiResponding || isManagerResponding) return;

    const priorMsgs = useIDEStore.getState().chatMessages;
    const isFirstUserMessage = !priorMsgs.some((m) => m.role === "user");

    const messagesForApi = [
      ...priorMsgs
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: trimmed },
    ];

    addChatMessage({ role: "user", content: trimmed });
    addChatMessage({ role: "assistant", content: "" });
    setInput("");
    setAiResponding(true);

    const allFiles = flattenFiles(files);
    const fileContext = allFiles.map((f) => ({
      path: f.path,
      content: f.content || "",
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulated = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesForApi, files: fileContext, provider: useIDEStore.getState().selectedProvider }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        updateLastAssistantMessage(tr(useLanguageStore.getState().lang, "chat.errorConnect"));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bufferStr = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        bufferStr += decoder.decode(value, { stream: true });
        const lines = bufferStr.split("\n");
        bufferStr = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith("data: ")) continue;
          const raw = trimmedLine.slice(6).trim();
          if (raw === "[DONE]") break outer;

          let ev: any;
          try { ev = JSON.parse(raw); } catch { continue; }

          if (ev.type === "narration_token" && typeof ev.token === "string") {
            accumulated += ev.token;
            useLLMMonitorStore.getState().addEvent("editor-chat", "editor_token", ev.token);
            updateLastAssistantMessage(stripProjectNameMarker(accumulated));
            await new Promise<void>(r => setTimeout(r, 0));
          } else if (ev.type === "thinking_token" && typeof ev.token === "string") {
            useLLMMonitorStore.getState().addEvent("editor-chat", "thinking_token", ev.token);
          } else if (ev.type === "code_applied" && ev.filePath && typeof ev.code === "string") {
            await applyCodeBlock({ filePath: ev.filePath, code: ev.code, language: "" });
          } else if (ev.type === "action_log") {
            useLLMMonitorStore.getState().addEvent("editor-chat", "action_log", JSON.stringify(ev));
          }
        }
      }

      if (isFirstUserMessage && projectId) {
        const nameFromMarker = accumulated.match(PROJECT_NAME_REGEX)?.[1]?.trim();
        if (nameFromMarker) renameProject(projectId, nameFromMarker);
      }

      const stripped = stripProjectNameMarker(accumulated);
      updateLastAssistantMessage(stripped);

      createCheckpoint("AI response");
    } catch (error: any) {
      if (error?.name === "AbortError") {
        if (!accumulated) {
          const msgs = useIDEStore.getState().chatMessages;
          const lastIdx = msgs.length - 1;
          if (lastIdx >= 0 && msgs[lastIdx].role === "assistant" && msgs[lastIdx].content === "") {
            useIDEStore.setState({ chatMessages: msgs.slice(0, lastIdx) });
          }
        }
      } else {
        updateLastAssistantMessage(tr(useLanguageStore.getState().lang, "chat.errorConnect"));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setAiResponding(false);
    }
  }, [input, isAiResponding, isManagerResponding, files, addChatMessage, updateLastAssistantMessage, setAiResponding, projectId, renameProject, createCheckpoint]);

  const handleExecutePlan = useCallback(async () => {
    const plan = useIDEStore.getState().managerPlan;
    if (!plan) return;
    if (buildSessionIdRef.current) return;

    setExecutingTaskIndex(0);
    setManagerResponding(false);
    setBuildPhase("thinking");
    setChatMode("build");
    setReviewPhase("building");
    setFixCycle(0);
    setHolisticReview(null);

    const normalizedSteps = normalizeSteps(plan);
    const firstUserMsg = useIDEStore.getState().managerMessages.find(m => m.role === "user");
    const userRequest = firstUserMsg?.content || "";
    const userLang = firstUserMsg ? detectLanguage(userRequest) : "English";

    const allFiles = flattenFiles(useIDEStore.getState().files);
    const filesForServer = allFiles
      .filter(f => f.path)
      .map(f => ({ path: f.path!, content: f.content || "" }));

    const taskStatuses = useIDEStore.getState().taskStatuses;
    const userConfirmation = userConfirmationRef.current;
    userConfirmationRef.current = "";

    const sessionId = (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2);
    buildSessionIdRef.current = sessionId;

    let commAccumulated = "";
    let commMsgIndex = -1;
    let editorAccumulated = "";
    let thinkingAccumulated = "";

    actionLogRef.current = [];
    setLiveActionLog([]);
    setLiveThinkingText("");
    buildResultMsgIdRef.current = null;

    const appendActionLog = (entry: ActionLogEntry) => {
      actionLogRef.current = [...actionLogRef.current, entry];
      setLiveActionLog([...actionLogRef.current]);
    };

    const flushNarrationToStore = () => {
      if (!commAccumulated) return;
      const isCurrentProject = useIDEStore.getState().projectId === projectId;
      if (!isCurrentProject) return;
      const content = commAccumulated;
      if (commMsgIndex === -1) {
        addManagerMessage({ role: "assistant", content, source: "communicator" });
        commMsgIndex = useIDEStore.getState().managerMessages.length - 1;
      } else {
        const msgs = useIDEStore.getState().managerMessages;
        const target = msgs[commMsgIndex];
        if (target?.role === "assistant") {
          const updated = [...msgs];
          updated[commMsgIndex] = { ...target, content };
          useIDEStore.setState({ managerMessages: updated });
        }
      }
    };

    const flushThinkingToStore = () => {
      const isCurrentProject = useIDEStore.getState().projectId === projectId;
      if (!isCurrentProject) return;
      const msgs = useIDEStore.getState().managerMessages;
      let idx = commMsgIndex;
      if (idx === -1 || !msgs[idx] || msgs[idx].role !== "assistant") {
        const fallbackIdx = [...msgs].reverse().findIndex(m => m.typing === true && m.role === "assistant");
        idx = fallbackIdx !== -1 ? msgs.length - 1 - fallbackIdx : -1;
      }
      if (idx === -1) {
        // No step-header message exists yet — create one on the fly so thinking
        // tokens are never silently dropped (e.g. if step_starting hasn't fired yet).
        addManagerMessage({ role: "assistant", content: "", source: "communicator", typing: true });
        commMsgIndex = useIDEStore.getState().managerMessages.length - 1;
        idx = commMsgIndex;
      }
      const target = useIDEStore.getState().managerMessages[idx];
      if (target?.role === "assistant") {
        const updated = [...useIDEStore.getState().managerMessages];
        updated[idx] = { ...target, thinking: thinkingAccumulated };
        useIDEStore.setState({ managerMessages: updated });
      }
    };

    const resetNarration = () => {
      commAccumulated = "";
      commMsgIndex = -1;
      thinkingAccumulated = "";
    };

    const clearTypingOnCurrentMsg = () => {
      const isCurrentProject = useIDEStore.getState().projectId === projectId;
      if (!isCurrentProject) return;
      if (commMsgIndex === -1) return;
      const msgs = useIDEStore.getState().managerMessages;
      const target = msgs[commMsgIndex];
      if (target?.role === "assistant" && target.typing) {
        const updated = [...msgs];
        updated[commMsgIndex] = { ...target, typing: false };
        useIDEStore.setState({ managerMessages: updated });
      }
    };

    const finalizeEditor = () => {
      editorAccumulated = "";
    };

    try {
      const response = await fetch("/api/build-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          plan,
          userRequest,
          userLang,
          files: filesForServer,
          taskStatuses,
          userConfirmation: userConfirmation || undefined,
          provider: useIDEStore.getState().selectedProvider,
        }),
      });

      if (!response.ok) {
        addManagerMessage({ role: "assistant", content: tr(useLanguageStore.getState().lang, "chat.errorBuildStart"), source: "communicator" });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;
      buildReaderRef.current = reader;

      const decoder = new TextDecoder();
      let buffer = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const raw = trimmed.slice(6).trim();
          if (raw === "[DONE]") { streamDone = true; break; }

          let ev: any;
          try { ev = JSON.parse(raw); } catch { continue; }

          const type = ev.type;
          if (KNOWN_BUILD_EVENT_TYPES.has(type)) {
            const buildMonitorContent = ev.token || ev.label || ev.message || ev.filePath || type;
            useLLMMonitorStore.getState().addEvent(
              BUILD_SOURCE_MAP[type] || "editor",
              type as LLMEventType,
              typeof buildMonitorContent === "string" ? buildMonitorContent : String(buildMonitorContent),
            );
          }

          // Local bookkeeping — always runs regardless of which project is active.
          if (type === "step_starting") {
            finalizeEditor(); resetNarration();
            if (thinkingFadeTimerRef.current) { clearTimeout(thinkingFadeTimerRef.current); thinkingFadeTimerRef.current = null; }
            setBuildPhase("thinking");
            setLiveThinkingText("");
            setLiveNarrationText("");
            const stepNum = (ev.stepNumber as number) ?? 1;
            const stepTitle = (ev.stepTitle as string) || "";
            const totalSteps = (ev.totalSteps as number) || normalizedSteps.length;
            const stepLabel = totalSteps > 1 ? `Step ${stepNum}/${totalSteps}: ${stepTitle}` : stepTitle;
            appendActionLog({ type: "step", label: stepLabel, detail: "", timestamp: Date.now() });
            // Immediately inject a step-progress message so the user sees feedback
            // even when the AI provider emits no delta.content (e.g. Kimi thinking mode).
            const isCurrentProjectNow = useIDEStore.getState().projectId === projectId;
            if (isCurrentProjectNow) {
              // commAccumulated stays "" so narration tokens stream as fresh content
              // (header is the message's initial content, not part of narration stream).
              commAccumulated = "";
              addManagerMessage({ role: "assistant", content: stepLabel, source: "communicator", typing: true });
              commMsgIndex = useIDEStore.getState().managerMessages.length - 1;
              // Set isExecuting=true before the yield so ActionLogLive renders in the same
              // render cycle as the step-header message (not one async tick later).
              setExecutingTaskIndex(stepNum - 1);
            }
            // Yield so React commits the step-header + ActionLogLive before thinking tokens arrive.
            await new Promise<void>(r => setTimeout(r, 0));
          } else if (type === "thinking_token") {
            const token = (ev.token as string) || "";
            if (token) {
              if (!thinkingAccumulated && import.meta.env.DEV) {
                console.log("[build-session] first thinking_token received for current step");
              }
              if (thinkingFadeTimerRef.current) { clearTimeout(thinkingFadeTimerRef.current); thinkingFadeTimerRef.current = null; }
              thinkingAccumulated += token;
              flushThinkingToStore();
              setLiveThinkingText(thinkingAccumulated);
              await new Promise<void>(r => setTimeout(r, 0));
            }
            setBuildPhase("thinking");
          } else if (type === "action_log") {
            const actionType = (ev.actionType as ActionLogEntry["type"]) || "tool_call";
            const label = (ev.label as string) || "";
            const detail = (ev.detail as string) || "";
            const filePath = (ev.filePath as string) || undefined;
            if (thinkingAccumulated) {
              const existing = actionLogRef.current;
              const lastIsThinking = existing.length > 0 && existing[existing.length - 1].type === "thinking";
              if (!lastIsThinking) {
                appendActionLog({ type: "thinking", label: "Thinking", detail: thinkingAccumulated, timestamp: Date.now() });
              }
              thinkingAccumulated = "";
              if (thinkingFadeTimerRef.current) { clearTimeout(thinkingFadeTimerRef.current); thinkingFadeTimerRef.current = null; }
              thinkingFadeTimerRef.current = setTimeout(() => {
                setLiveThinkingText("");
                thinkingFadeTimerRef.current = null;
              }, 400);
            }
            setLiveNarrationText("");
            appendActionLog({ type: actionType, label, detail, timestamp: Date.now(), filePath });
          } else if (type === "narration_token") {
            if (thinkingAccumulated) {
              const existing = actionLogRef.current;
              const lastIsThinking = existing.length > 0 && existing[existing.length - 1].type === "thinking";
              if (!lastIsThinking) {
                appendActionLog({ type: "thinking", label: "Thinking", detail: thinkingAccumulated, timestamp: Date.now() });
              }
              thinkingAccumulated = "";
            }
            if (thinkingFadeTimerRef.current) { clearTimeout(thinkingFadeTimerRef.current); thinkingFadeTimerRef.current = null; }
            thinkingFadeTimerRef.current = setTimeout(() => {
              setLiveThinkingText("");
              thinkingFadeTimerRef.current = null;
            }, 400);
            commAccumulated += ev.token || "";
            setLiveNarrationText(commAccumulated);
            setBuildPhase("working");
            await new Promise<void>(r => setTimeout(r, 0));
          } else if (type === "editor_token") {
            editorAccumulated += ev.token || "";
            setBuildPhase("working");
          } else if (type === "code_applied") {
            setBuildPhase("working");
          } else if (type === "step_completed" || type === "step_failed" || type === "step_cancelled") {
            clearTypingOnCurrentMsg(); finalizeEditor(); flushNarrationToStore();
            setLiveNarrationText("");
          } else if (type === "reviewing") {
            flushNarrationToStore(); resetNarration();
            setLiveNarrationText("");
            setBuildPhase("verifying");
          } else if (type === "bugs_found") {
            setBuildPhase("fixing");
          } else if (type === "fixing") {
            setBuildPhase("fixing");
          } else if (type === "all_complete") {
            if (useIDEStore.getState().projectId === projectId) {
              createCheckpoint("Build complete", { includeManagerThread: true });
            }
            const changedFiles = (ev.changedFiles as string[]) || [];
            const planSummary = (ev.summary as string) || "";
            const finalLog = [...actionLogRef.current];
            if (useIDEStore.getState().projectId === projectId) {
              const buildResult: BuildResultData = {
                actionLog: finalLog,
                completionData: { changedFiles, userLang },
              };
              const curMsgs = useIDEStore.getState().managerMessages;
              const planMsg = [...curMsgs].reverse().find(m => m.plan);
              if (planMsg) {
                const updated = curMsgs.map(m => m.id === planMsg.id ? { ...m, buildResult } : m);
                useIDEStore.setState({ managerMessages: updated });
                buildResultMsgIdRef.current = planMsg.id;
              } else {
                addManagerMessage({ role: "assistant", content: "", source: "communicator", buildResult });
                const msgs = useIDEStore.getState().managerMessages;
                buildResultMsgIdRef.current = msgs[msgs.length - 1]?.id || null;
              }
            }
            const targetMsgId = buildResultMsgIdRef.current;
            ;(async () => {
              if (!targetMsgId) return;
              try {
                const response = await fetch("/api/communicator-chat", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    event: {
                      event: "all_complete",
                      userLanguage: userLang,
                      changedFiles,
                      planSummary,
                    },
                  }),
                });
                if (!response.ok) return;
                const reader = response.body?.getReader();
                if (!reader) return;
                const decoder = new TextDecoder();
                let accumulated = "";
                let buffer = "";
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split("\n");
                  buffer = lines.pop() || "";
                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith("data: ")) continue;
                    const data = trimmed.slice(6).trim();
                    if (data === "[DONE]") break;
                    try {
                      const parsed = JSON.parse(data);
                      if (parsed.content) {
                        accumulated += parsed.content;
                        useLLMMonitorStore.getState().addEvent("communicator", "communicator_summary", parsed.content);
                        const curMsgs = useIDEStore.getState().managerMessages;
                        if (!curMsgs.some(m => m.id === targetMsgId)) break;
                        const updated = curMsgs.map(m => m.id === targetMsgId && m.buildResult
                          ? { ...m, buildResult: { ...m.buildResult, completionData: { ...m.buildResult.completionData, summary: accumulated } } }
                          : m);
                        useIDEStore.setState({ managerMessages: updated });
                      }
                    } catch {}
                  }
                }
              } catch {}
            })();
          } else if (type === "done") {
            finalizeEditor(); flushNarrationToStore();
            setLiveNarrationText("");
            const finalLog = [...actionLogRef.current];
            if (thinkingAccumulated && finalLog.length > 0) {
              const lastIsThinking = finalLog[finalLog.length - 1].type === "thinking";
              if (!lastIsThinking) {
                finalLog.push({ type: "thinking", label: "Thinking", detail: thinkingAccumulated, timestamp: Date.now() });
              }
            }
            if (finalLog.length > 0) {
              const msgId = buildResultMsgIdRef.current;
              if (msgId) {
                const curMsgs = useIDEStore.getState().managerMessages;
                const updated = curMsgs.map(m => m.id === msgId && m.buildResult
                  ? { ...m, buildResult: { ...m.buildResult, actionLog: finalLog } }
                  : m);
                useIDEStore.setState({ managerMessages: updated });
              } else if (useIDEStore.getState().projectId === projectId) {
                const buildResult: BuildResultData = {
                  actionLog: finalLog,
                  completionData: { changedFiles: [], userLang },
                };
                const doneMsgs = useIDEStore.getState().managerMessages;
                const donePlanMsg = [...doneMsgs].reverse().find(m => m.plan);
                if (donePlanMsg) {
                  const updated = doneMsgs.map(m => m.id === donePlanMsg.id ? { ...m, buildResult } : m);
                  useIDEStore.setState({ managerMessages: updated });
                  buildResultMsgIdRef.current = donePlanMsg.id;
                } else {
                  addManagerMessage({ role: "assistant", content: "", source: "communicator", buildResult });
                  const msgs2 = useIDEStore.getState().managerMessages;
                  buildResultMsgIdRef.current = msgs2[msgs2.length - 1]?.id || null;
                }
              }
            }
            setLiveActionLog([]);
            setLiveThinkingText("");
            streamDone = true; break;
          }

          // Skip all Zustand state mutations when the user is viewing a different project.
          // The SSE reader stays alive so the server-side build continues uninterrupted.
          // When the user switches back, isCurrentProject becomes true and UI updates resume.
          const isCurrentProject = useIDEStore.getState().projectId === projectId;
          if (!isCurrentProject) continue;

          // UI / Zustand updates (only when on the correct project)
          if (type === "step_starting") {
            updateTaskStatus(String(ev.stepNumber), "running");
            // setExecutingTaskIndex is called in the local block above (before the yield)
            // so ActionLogLive renders immediately with the step entry.
          } else if (type === "code_applied") {
            await applyCodeBlock({ filePath: ev.filePath, code: ev.code, language: "" });
            refreshPreview();
          } else if (type === "step_completed") {
            updateTaskStatus(String(ev.stepNumber), "done");

            const stepNum = ev.stepNumber as number;
            const lastStep = normalizedSteps[normalizedSteps.length - 1];
            const isLastStep = lastStep && String(lastStep.step) === String(stepNum);
            if (isLastStep) {
              const midPlan = useIDEStore.getState().managerPlan;
              const midProjectId = useIDEStore.getState().projectId;
              if (midPlan && midProjectId) {
                const midMsg = useIDEStore.getState().managerMessages.find(m => m.role === "user");
                const midFileNodes = flattenFiles(useIDEStore.getState().files);
                const midCurrentFiles = midFileNodes.filter(f => f.path && !f.path.endsWith("codestart.md")).map(f => ({ path: f.path!, content: f.content || "" }));
                fetch("/api/generate-codestart", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ plan: midPlan, userPrompt: midMsg?.content || userRequest, projectName: undefined, currentFiles: midCurrentFiles }),
                }).then(async (r) => {
                  if (!r.ok) return;
                  const d = await r.json();
                  if (d.content) useIDEStore.getState().updateFileContent("/project/codestart.md", d.content);
                }).catch(() => {});
              }
            }
          } else if (type === "step_failed") {
            updateTaskStatus(String(ev.stepNumber), "failed");
            if (ev.reason) setTaskFailureReason(String(ev.stepNumber), ev.reason);
          } else if (type === "step_cancelled") {
            updateTaskStatus(String(ev.stepNumber), "pending");
          } else if (type === "reviewing") {
            setReviewPhase("reviewing");
          } else if (type === "review_passed") {
            setReviewPhase("review_passed");
            normalizedSteps.forEach(step => {
              const key = String(step.step);
              const s = useIDEStore.getState().taskStatuses[key];
              if (s === "bug" || s === "failed") updateTaskStatus(key, "done");
            });
          } else if (type === "bugs_found") {
            setReviewPhase("review_failed");
            if (ev.review) setHolisticReview(ev.review);
            normalizedSteps.forEach(step => {
              const key = String(step.step);
              const s = useIDEStore.getState().taskStatuses[key];
              if (s === "done" || s === "failed") updateTaskStatus(key, "bug");
            });
          } else if (type === "fixing") {
            setReviewPhase("fixing");
            setFixCycle(ev.fixCycle || 1);
          } else if (type === "needs_input") {
            setPendingConfirmation({ stepKey: "review", items: ev.items || [] });
          } else if (type === "all_complete") {
            setReviewPhase("review_passed");
            normalizedSteps.forEach(step => {
              const key = String(step.step);
              const s = useIDEStore.getState().taskStatuses[key];
              if (s === "bug" || s === "failed") updateTaskStatus(key, "done");
            });

            const currentPlan = useIDEStore.getState().managerPlan;
            const currentProjectId = useIDEStore.getState().projectId;
            if (currentPlan && currentProjectId) {
              const userMsg = useIDEStore.getState().managerMessages.find(m => m.role === "user");
              const userPromptForUpdate = userMsg?.content || userRequest;
              const currentAllFiles = flattenFiles(useIDEStore.getState().files);
              const currentFilesForServer = currentAllFiles.filter(f => f.path).map(f => ({ path: f.path!, content: f.content || "" }));
              const existingCodestart = currentFilesForServer.find(f => f.path === "/project/codestart.md");
              const existingContent = existingCodestart?.content || "";
              const hasStubContent = existingContent.includes("_Generated after planning is complete._") || existingContent.includes("_Populated after");
              if (hasStubContent || currentAllFiles.length > 4) {
                const nonCSFiles = currentFilesForServer.filter(f => !f.path.endsWith("codestart.md"));
                fetch("/api/generate-codestart", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ plan: currentPlan, userPrompt: userPromptForUpdate, projectName: undefined, currentFiles: nonCSFiles }),
                }).then(async (r) => {
                  if (!r.ok) return;
                  const data = await r.json();
                  if (data.content) {
                    useIDEStore.getState().updateFileContent("/project/codestart.md", data.content);
                  }
                }).catch(() => {});
              }
            }
          } else if (type === "build_error") {
            addManagerMessage({ role: "assistant", content: tr(useLanguageStore.getState().lang, "chat.errorBuildGeneric"), source: "communicator" });
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError" && useIDEStore.getState().projectId === projectId) {
        addManagerMessage({ role: "assistant", content: tr(useLanguageStore.getState().lang, "chat.errorBuildInterrupted"), source: "communicator" });
      }
    } finally {
      flushNarrationToStore();
      buildSessionIdRef.current = null;
      buildReaderRef.current = null;
      if (thinkingFadeTimerRef.current) { clearTimeout(thinkingFadeTimerRef.current); thinkingFadeTimerRef.current = null; }
      setBuildPhase(null);
      setLiveThinkingText("");
      setLiveNarrationText("");
      const finalLog = [...actionLogRef.current];
      if (finalLog.length > 0) {
        const msgId = buildResultMsgIdRef.current;
        if (msgId) {
          const curMsgs = useIDEStore.getState().managerMessages;
          const updated = curMsgs.map(m => m.id === msgId && m.buildResult
            ? { ...m, buildResult: { ...m.buildResult, actionLog: finalLog } }
            : m);
          useIDEStore.setState({ managerMessages: updated });
        } else if (useIDEStore.getState().projectId === projectId) {
          const buildResult: BuildResultData = {
            actionLog: finalLog,
            completionData: { changedFiles: [], userLang },
          };
          const finallyMsgs = useIDEStore.getState().managerMessages;
          const finallyPlanMsg = [...finallyMsgs].reverse().find(m => m.plan);
          if (finallyPlanMsg) {
            const updated = finallyMsgs.map(m => m.id === finallyPlanMsg.id ? { ...m, buildResult } : m);
            useIDEStore.setState({ managerMessages: updated });
          } else {
            addManagerMessage({ role: "assistant", content: "", source: "communicator", buildResult });
          }
        }
      }
      setLiveActionLog([]);
      if (useIDEStore.getState().projectId === projectId) {
        normalizedSteps.forEach(step => {
          const key = String(step.step);
          const s = useIDEStore.getState().taskStatuses[key];
          if (s === "pending" || s === "running") updateTaskStatus(key, "done");
        });
        setExecutingTaskIndex(null);
        setAiResponding(false);
      }
    }
  }, [applyCodeBlock, refreshPreview, addManagerMessage, updateTaskStatus, setTaskFailureReason, setExecutingTaskIndex, setManagerResponding, setReviewPhase, setHolisticReview, setFixCycle, setPendingConfirmation, setChatMode, setAiResponding, projectId, createCheckpoint, setBuildPhase]);

  handleExecutePlanRef.current = handleExecutePlan;

  const handleStopExecution = useCallback(() => {
    if (buildSessionIdRef.current) {
      fetch(`/api/build-session/${buildSessionIdRef.current}`, { method: "DELETE" }).catch(() => {});
      buildSessionIdRef.current = null;
    }
    if (buildReaderRef.current) {
      buildReaderRef.current.cancel().catch(() => {});
      buildReaderRef.current = null;
    }
    if (thinkingFadeTimerRef.current) { clearTimeout(thinkingFadeTimerRef.current); thinkingFadeTimerRef.current = null; }
    setAiResponding(false);
    setExecutingTaskIndex(null);
    setReviewPhase("idle");
    setBuildPhase(null);
    setLiveThinkingText("");
    setLiveNarrationText("");
    setLiveActionLog([]);
  }, [setAiResponding, setExecutingTaskIndex, setReviewPhase, setBuildPhase]);

  const handleContinueExecution = useCallback((userInput?: string) => {
    const plan = useIDEStore.getState().managerPlan;
    if (!plan) return;

    const inputText = userInput || useIDEStore.getState().userConfirmationInput || "";

    if (inputText.trim()) {
      addChatMessage({ role: "user", content: inputText.trim() });
      userConfirmationRef.current = inputText.trim();
    } else {
      userConfirmationRef.current = "";
    }

    setPendingConfirmation(null);
    setUserConfirmationInput("");

    const steps = normalizeSteps(plan);
    for (const t of steps) {
      const key = String(t.step);
      if (useIDEStore.getState().taskStatuses[key] === "needs-input") {
        updateTaskStatus(key, "pending");
      }
    }
    handleExecutePlan();
  }, [handleExecutePlan, updateTaskStatus, addChatMessage, setPendingConfirmation, setUserConfirmationInput]);


  useEffect(() => {
    pendingHandled.current = false;
  }, [projectId]);

  useEffect(() => {
    if (pendingPrompt && !pendingHandled.current && !isAiResponding && !isManagerResponding) {
      pendingHandled.current = true;
      const prompt = pendingPrompt;
      handleManagerSend(prompt).then(() => {
        clearPendingPrompt();
      });
    }
  }, [pendingPrompt, isAiResponding, isManagerResponding, clearPendingPrompt, handleManagerSend]);

  useEffect(() => {
    if (!isManagerResponding && autoExecutePlanRef.current) {
      autoExecutePlanRef.current = false;
      handleExecutePlan();
    }
  }, [isManagerResponding, handleExecutePlan]);

  const isExecuting = executingTaskIndex !== null;

  const handleStop = useCallback(() => {
    if (isExecuting) {
      handleStopExecution();
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setAiResponding(false);
    setManagerResponding(false);
    setMgrPreparingPlan(false);
  }, [setAiResponding, setManagerResponding, isExecuting, handleStopExecution]);

  const handleToggleMode = useCallback(() => {
    const next = chatMode === "manager" ? "build" : "manager";
    setChatMode(next);
  }, [chatMode, setChatMode]);

  const handleRevisePlan = useCallback(() => {
    setChatMode("manager");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [setChatMode]);

  const handleCurrentSend = useCallback(() => {
    if (pendingConfirmation) {
      const trimmed = input.trim();
      if (trimmed) {
        setInput("");
        handleContinueExecution(trimmed);
      }
      return;
    }
    if (chatMode === "build" && managerPlan && !isExecuting && !input.trim()) {
      handleExecutePlan();
      return;
    }
    if (chatMode === "build") {
      handleEditorSend();
      return;
    }
    handleManagerSend();
  }, [handleManagerSend, handleEditorSend, pendingConfirmation, input, handleContinueExecution, chatMode, managerPlan, isExecuting, handleExecutePlan]);

  const handleCurrentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleCurrentSend();
    }
  };

  const handleSmartResponse = useCallback(async () => {
    const validRoles = new Set(["user", "assistant"]);
    const msgs = (chatMode === "manager" ? managerMessages : chatMessages)
      .filter(m => !m.hidden && !m.typing && validRoles.has(m.role) && m.content?.trim())
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

    if (msgs.length === 0) return;

    const hasChinese = msgs.some(m => /[\u4e00-\u9fff]/.test(m.content));
    const language = hasChinese ? "Chinese" : "English";

    setSmartResponseLoading(true);
    try {
      const res = await fetch("/api/smart-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, mode: chatMode, language }),
      });
      const data = await res.json();
      if (data.suggestion) {
        setInput(data.suggestion);
        setTimeout(() => textareaRef.current?.focus(), 50);
      } else if (data.error) {
        console.error("Smart response error:", data.error);
        toast({ title: "Smart response failed", description: data.error, variant: "destructive" });
      }
    } catch (err) {
      console.error("Smart response fetch error:", err);
      toast({ title: "Smart response failed", description: "Network error", variant: "destructive" });
    } finally {
      setSmartResponseLoading(false);
    }
  }, [chatMode, chatMessages, managerMessages]);

  const isBusy = isAiResponding || isManagerResponding || isExecuting;

  return (
    <div className="h-full flex flex-col" data-testid="chat-panel">
      <div className="flex items-center justify-between gap-2 px-3 h-9 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground" data-testid="text-chat-title">
            {chatTitle}
          </span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setActiveTool(null)}
          aria-label={tGlobal("chat.close")}
          data-testid="button-close-chat"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-2 space-y-2" ref={scrollRef}>
        {(() => {
          const lastPlanMsgId = [...managerMessages].reverse().find((m) => m.plan)?.id;
          const lastChatIdx = chatMessages.length - 1;
          type MergedItem =
            | { kind: "chat"; msg: ChatMessage; idx: number; order: number }
            | { kind: "manager"; msg: typeof managerMessages[number]; order: number };
          const merged: MergedItem[] = [
            ...chatMessages.map((msg, idx) => ({ kind: "chat" as const, msg, idx, order: idx })),
            ...managerMessages.map((msg, idx) => ({ kind: "manager" as const, msg, order: idx })),
          ].sort((a, b) => a.msg.timestamp - b.msg.timestamp || a.order - b.order);

          const seenCheckpointIds = new Set<string>();

          return merged.map((item) => {
            if (item.kind === "chat") {
              const { msg, idx } = item;
              if (msg.hidden) return null;
              if (msg.role === "checkpoint" && msg.checkpointId) {
                if (seenCheckpointIds.has(msg.checkpointId)) return null;
                seenCheckpointIds.add(msg.checkpointId);
              }
              const isLastAssistant = msg.role === "assistant" && idx === lastChatIdx;
              return msg.role === "checkpoint" ? (
                <CheckpointMarker key={`c-${msg.id}`} message={msg} />
              ) : (
                <MessageBubble
                  key={`c-${msg.id}`}
                  message={msg}
                  autoApplied={autoAppliedMessageIds.has(msg.id)}
                  appliedBlockIndices={isLastAssistant ? appliedBlockIndices : undefined}
                />
              );
            } else {
              const { msg } = item;
              if (msg.role === "checkpoint" && msg.checkpointId) {
                if (seenCheckpointIds.has(msg.checkpointId)) return null;
                seenCheckpointIds.add(msg.checkpointId);
                return (
                  <CheckpointMarker
                    key={`m-${msg.id}`}
                    message={{ id: msg.id, role: "checkpoint", content: msg.content, timestamp: msg.timestamp, checkpointId: msg.checkpointId }}
                  />
                );
              }
              if (msg.buildResult && !msg.plan) {
                return (
                  <div key={`m-${msg.id}`} className="space-y-2">
                    {msg.buildResult.actionLog.length > 0 && (
                      <div className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden">
                        <ActionLogCollapsed entries={msg.buildResult.actionLog as ActionLogEntry[]} />
                      </div>
                    )}
                    <BuildCompletionCard
                      changedFiles={msg.buildResult.completionData.changedFiles}
                      userLang={msg.buildResult.completionData.userLang}
                      summary={msg.buildResult.completionData.summary}
                    />
                  </div>
                );
              }
              const isLastPlan = msg.plan && msg.id === lastPlanMsgId;
              return (
                <div key={`m-${msg.id}`} className="space-y-2">
                  <ManagerMessageBubble
                    message={msg}
                    taskStatuses={isLastPlan ? taskStatuses : {}}
                    taskFailureReasons={isLastPlan ? taskFailureReasons : undefined}
                    onExecute={isLastPlan ? handleExecutePlan : undefined}
                    onRevise={isLastPlan ? handleRevisePlan : undefined}
                    isExecuting={isLastPlan ? isExecuting : undefined}
                    onStop={isLastPlan ? handleStopExecution : undefined}
                    onContinueWithInput={isLastPlan ? handleContinueExecution : undefined}
                    pendingConfirmation={isLastPlan ? pendingConfirmation : undefined}
                    confirmationInput={isLastPlan ? userConfirmationInput : undefined}
                    onConfirmationInputChange={isLastPlan ? setUserConfirmationInput : undefined}
                    reviewPhase={isLastPlan ? reviewPhase : undefined}
                    holisticReview={isLastPlan ? holisticReview : undefined}
                    fixCycle={isLastPlan ? fixCycle : undefined}
                  />
                  {msg.buildResult && (
                    <>
                      {msg.buildResult.actionLog.length > 0 && (
                        <div className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden">
                          <ActionLogCollapsed entries={msg.buildResult.actionLog as ActionLogEntry[]} />
                        </div>
                      )}
                      <BuildCompletionCard
                        changedFiles={msg.buildResult.completionData.changedFiles}
                        userLang={msg.buildResult.completionData.userLang}
                        summary={msg.buildResult.completionData.summary}
                      />
                    </>
                  )}
                </div>
              );
            }
          });
        })()}
        {isAiResponding && chatMessages[chatMessages.length - 1]?.content === "" && chatMode !== "manager" && (
          <TypingIndicator />
        )}
        {isManagerResponding && chatMode !== "build" && (
          mgrPreparingPlan ? (
            <div className="mx-3 mb-2 px-3 py-2 rounded-lg border border-border/30 bg-card/30 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-blue-400/80" />
              <span className="text-[12px] text-muted-foreground/90 font-medium">Preparing plan…</span>
            </div>
          ) : (
            <TypingIndicator text={t(getPlanCardLang(), "planning")} />
          )
        )}
        {isExecuting && (liveActionLog.length > 0 || !!liveThinkingText || !!liveNarrationText) && (
          <div className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden">
            <ActionLogLive entries={liveActionLog} thinkingText={liveThinkingText || undefined} narrationText={liveNarrationText || undefined} />
          </div>
        )}
      </div>
      <div className="px-2 pb-2 pt-1.5 border-t border-border/50 shrink-0">
        {(isBusy || isExecuting) && buildPhase && (
          <div className="flex items-center gap-1.5 px-1 pb-1.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            <span className="text-[11px] text-muted-foreground">
              {buildPhase === "thinking" && "Agent is thinking..."}
              {buildPhase === "working" && "Agent is working..."}
              {buildPhase === "verifying" && "Agent is verifying..."}
              {buildPhase === "fixing" && "Agent is fixing..."}
            </span>
          </div>
        )}
        <div
          ref={inputBoxRef}
          onFocus={() => setInputFocused(true)}
          onBlur={() => {
            setTimeout(() => {
              if (!inputBoxRef.current?.contains(document.activeElement)) {
                setInputFocused(false);
              }
            }, 0);
          }}
          className={cn(
            "rounded-xl border bg-background overflow-hidden transition-[border-color,box-shadow]",
            inputFocused ? "border-primary ring-2 ring-primary/40" : "border-border/60"
          )}
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleCurrentKeyDown}
            placeholder={chatMode === "manager" && pendingConfirmation ? tGlobal("chat.placeholderResponse") : chatMode === "manager" ? tGlobal("chat.placeholderManager") : managerPlan ? tGlobal("chat.placeholderStartBuild") : tGlobal("chat.placeholderDefault")}
            className="resize-none text-[13px] min-h-[60px] overflow-y-auto rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent px-3 pt-3 pb-1"
            data-testid="input-chat"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <button
              className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-muted/50 transition-colors group"
              onClick={handleToggleMode}
              data-testid="toggle-plan-mode"
              title={chatMode === "manager" ? tGlobal("chat.switchToBuild") : tGlobal("chat.switchToPlan")}
            >
              <div className={cn(
                "w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors shrink-0",
                chatMode === "manager"
                  ? "bg-primary border-primary"
                  : "border-muted-foreground/40 group-hover:border-muted-foreground/70"
              )}>
                {chatMode === "manager" && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
              </div>
              <span className="text-[11px] text-muted-foreground font-medium group-hover:text-foreground transition-colors">{tGlobal("chat.planMode")}</span>
            </button>
            <Select
              value={selectedProvider}
              onValueChange={(v) => setSelectedProvider(v as AIProvider)}
              data-testid="select-model-provider"
            >
              <SelectTrigger
                className="h-6 w-auto gap-1 border-0 bg-transparent px-1.5 py-0 text-[10px] font-semibold shadow-none focus:ring-0 focus:ring-offset-0 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors [&>svg]:w-2.5 [&>svg]:h-2.5"
                data-testid="select-model-provider"
              >
                <SelectValue>
                  <span className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors",
                    selectedProvider === "kimi"
                      ? "bg-violet-100 dark:bg-violet-900/40 border-violet-400 dark:border-violet-500 text-violet-700 dark:text-violet-300"
                      : selectedProvider === "minimax"
                        ? "bg-emerald-100 dark:bg-emerald-900/40 border-emerald-400 dark:border-emerald-500 text-emerald-700 dark:text-emerald-300"
                        : selectedProvider === "glm"
                          ? "bg-sky-100 dark:bg-sky-900/40 border-sky-400 dark:border-sky-500 text-sky-700 dark:text-sky-300"
                          : "bg-muted/60 border-muted-foreground/20 text-muted-foreground"
                  )}>
                    {selectedProvider === "kimi" ? "Kimi K2.5" : selectedProvider === "minimax" ? "MiniMax M2.7" : selectedProvider === "glm" ? "GLM-5" : "Doubao"}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" className="min-w-[140px]">
                <SelectItem value="doubao" className="text-xs">Doubao</SelectItem>
                {providers.kimi && <SelectItem value="kimi" className="text-xs">Kimi K2.5</SelectItem>}
                {providers.minimax && <SelectItem value="minimax" className="text-xs">MiniMax M2.7</SelectItem>}
                {providers.glm && <SelectItem value="glm" className="text-xs">GLM-5</SelectItem>}
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-lg shrink-0"
              onClick={handleSmartResponse}
              disabled={isBusy || smartResponseLoading || (
                chatMode === "manager"
                  ? !managerMessages.some(m => m.role === "assistant")
                  : !chatMessages.some(m => m.role === "assistant")
              )}
              title={tGlobal("chat.smartResponse")}
              data-testid="button-smart-response"
            >
              {smartResponseLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Lightbulb className="w-3.5 h-3.5" />
              )}
            </Button>
            {isBusy ? (
              <Button
                size="icon"
                variant="destructive"
                className="h-7 w-7 rounded-lg shrink-0"
                onClick={handleStop}
                data-testid="button-stop-chat"
              >
                <Square className="w-3 h-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-7 w-7 rounded-lg shrink-0"
                onClick={handleCurrentSend}
                disabled={!input.trim() && !(chatMode === "build" && managerPlan && !isExecuting)}
                data-testid="button-send-chat"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
