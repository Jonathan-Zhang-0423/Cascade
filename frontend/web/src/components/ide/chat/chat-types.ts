import type { LLMEventSource } from "@/stores/llm-monitor-store";
import type { ManagerPlan, HolisticReviewResult } from "@/stores/ide-store";

export interface ActionLogEntry {
  type:
    | "thinking"
    | "tool_call"
    | "terminal_command"
    | "file_read"
    | "file_write"
    | "step"
    | "narration";
  label: string;
  detail: string;
  timestamp: number;
  filePath?: string;
  precedingNarration?: string;
}

export interface NarrationSegment {
  id: string;
  narration: string;
  actions: ActionLogEntry[];
  isLive: boolean;
}

export interface ParsedCompletion {
  headline: string;
  fileChanges: string[];
  specialNotes: string;
}

export interface CodeBlock {
  language: string;
  filePath: string;
  code: string;
}

export interface Token {
  type: string;
  text: string;
}

export type PlanCardLang = "Chinese" | "English";

export const KNOWN_MGR_EVENT_TYPES: Set<string> = new Set([
  "thinking_token",
  "raw_token",
  "manager_token",
  "communicator_token",
  "communicator_narration_starting",
  "communicator_error",
  "plan_preparing",
  "plan_ready",
  "manager_done",
  "manager_error",
  "action_log",
]);

export const MGR_SOURCE_MAP: Record<string, LLMEventSource> = {
  communicator_token: "communicator",
  communicator_narration_starting: "communicator",
  communicator_error: "communicator",
};

export const KNOWN_BUILD_EVENT_TYPES: Set<string> = new Set([
  "thinking_token",
  "narration_token",
  "communicator_token",
  "action_log",
  "step_starting",
  "step_completed",
  "step_failed",
  "step_cancelled",
  "code_applied",
  "reviewing",
  "review_passed",
  "review_skipped",
  "bugs_found",
  "fixing",
  "needs_input",
  "all_complete",
  "build_error",
  "done",
]);

export const BUILD_SOURCE_MAP: Record<string, LLMEventSource> = {
  narration_token: "communicator",
  communicator_token: "communicator",
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

export const KNOWN_REVIEW_EVENT_TYPES: Set<string> = new Set([
  "thinking_token",
  "narration_token",
  "communicator_token",
  "action_log",
  "code_applied",
  "review_started",
  "review_round",
  "review_fixing",
  "review_report",
  "review_passed",
  "review_done",
  "review_error",
  "done",
]);

export const REVIEW_SOURCE_MAP: Record<string, LLMEventSource> = {
  thinking_token: "verifier",
  narration_token: "verifier",
  communicator_token: "verifier",
  action_log: "verifier",
  code_applied: "editor",
  review_started: "verifier",
  review_round: "verifier",
  review_fixing: "editor",
  review_report: "verifier",
  review_passed: "verifier",
  review_done: "verifier",
  review_error: "verifier",
  done: "verifier",
};

export interface ManagerSseEvent {
  type: string;
  eventId?: number;
  replay?: boolean;
  sessionId?: string;
  token?: string;
  plan?: ManagerPlan;
  autoExecute?: boolean;
  label?: string;
  detail?: string;
  filePath?: string;
  actionType?: ActionLogEntry["type"];
  [key: string]: unknown;
}

export function validateManagerEvent(raw: { type: string; [key: string]: unknown }): ManagerSseEvent {
  return raw as ManagerSseEvent;
}

export function validateBuildEvent(raw: { type: string; [key: string]: unknown }): BuildSseEvent {
  return raw as BuildSseEvent;
}

export interface ReviewReportRemaining {
  blocking: Array<{ type: string; severity: string; description: string; file: string }>;
  advisories: Array<{ type: string; severity: string; description: string; file: string }>;
}

export interface ReviewSseEvent {
  type: string;
  eventId?: number;
  replay?: boolean;
  token?: string;
  label?: string;
  detail?: string;
  message?: string;
  filePath?: string;
  code?: string;
  language?: string;
  actionType?: ActionLogEntry["type"];
  strictness?: "lenient" | "balanced" | "strict";
  round?: number;
  maxRounds?: number;
  status?: "passed" | "stalled" | "exhausted";
  rounds?: number;
  summary?: string;
  requirementMatchPercent?: number;
  fixedCount?: number;
  remaining?: ReviewReportRemaining;
  review?: HolisticReviewResult;
  [key: string]: unknown;
}

export function validateReviewEvent(raw: { type: string; [key: string]: unknown }): ReviewSseEvent {
  return raw as ReviewSseEvent;
}

export interface EditorSseEvent {
  type: string;
  eventId?: number;
  token?: string;
  filePath?: string;
  code?: string;
  [key: string]: unknown;
}

export function validateEditorEvent(raw: { type: string; [key: string]: unknown }): EditorSseEvent {
  return raw as EditorSseEvent;
}

export interface ManagerPlanPayload {
  summary?: string;
  steps?: ManagerStepPayload[];
  sub_tasks?: ManagerStepPayload[];
  project_name?: string;
  needs_input?: string[];
  overview?: string;
  what_and_why?: string;
  done_looks_like?: string;
  out_of_scope?: string;
  relevant_files?: string[];
  narrated_what_and_why?: string;
  narrated_done_looks_like?: string;
  narrated_out_of_scope?: string;
  [key: string]: unknown;
}

export interface ManagerStepPayload {
  step?: number;
  sub_task_id?: string;
  title?: string;
  description?: string;
  acceptance_criteria?: string;
  required_files?: string[];
  [key: string]: unknown;
}

export interface BuildSseEvent {
  type: string;
  eventId?: number;
  replay?: boolean;
  token?: string;
  label?: string;
  detail?: string;
  message?: string;
  filePath?: string;
  code?: string;
  language?: string;
  actionType?: ActionLogEntry["type"];
  stepNumber?: number;
  stepTitle?: string;
  totalSteps?: number;
  reason?: string;
  review?: HolisticReviewResult;
  fixCycle?: number;
  items?: string[];
  changedFiles?: string[];
  summary?: string;
  summaryText?: string;
  content?: string;
  [key: string]: unknown;
}

export interface NormalizedStep {
  step: number;
  sub_task_id: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  required_files: string[];
}

export const PROJECT_NAME_REGEX = /\[\[PROJECT_NAME:([^\]]+)\]\]/;
export const PROJECT_NAME_REGEX_GLOBAL = /\[\[PROJECT_NAME:[^\]]+\]\]/g;

export const PREVIEW_STEP_COUNT = 10;

export const PLAIN_FENCE_RE = /```[\w]*\n[\s\S]*?```/g;

export const SUMMARY_HEADERS = [
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

export const THEME_COLORS = {
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

export const planCardStrings: Record<PlanCardLang, Record<string, string>> = {
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
    reviewSkipped: "已跳过审查",
    issuesFound: "发现 {n} 个问题",
    issuesFoundGeneric: "发现问题",
    fixingIssues: "修复问题中（第 {n}/3 轮）...",
    reviewCode: "代码审查",
    reviewInProgress: "正在审查...",
    reviewFixing: "正在修复...",
    reviewAdvisories: "建议（不阻塞）：",
    strictness_lenient: "宽松",
    strictness_balanced: "均衡",
    strictness_strict: "严格",
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
    regeneratePlan: "重新规划",
    regenerateTitle: "重新规划",
    regenerateModeSimple: "直接重生成（用原始需求重新规划）",
    regenerateModeWithNote: "加点说明再重生成",
    regenerateNotePlaceholder: "这一版的问题是…\n比如：太复杂了，去掉排行榜功能",
    regenerateConfirm: "重新生成",
    cancel: "取消",
    runReview: "代码审查",
    reviewStrictness: "审查严格度",
    strictnessLenient: "宽松",
    strictnessBalanced: "平衡",
    strictnessStrict: "严格",
    reviewRound: "审查中（第 {n}/{max} 轮）...",
    reviewFixing: "修复中（第 {n} 轮）...",
    reviewReportPassed: "审查通过 ✓",
    reviewReportRemaining: "审查完成 · 仍有 {n} 项待处理",
    reviewReportClean: "未发现需要处理的问题",
    reviewAdvisories: "建议（不阻塞）",
    reviewFixedCount: "已修复 {n} 项",
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
    reviewSkipped: "Review skipped",
    issuesFound: "{n} issues found",
    issuesFoundGeneric: "Issues found",
    fixingIssues: "Fixing issues (cycle {n}/3)...",
    reviewCode: "Review code",
    reviewInProgress: "Reviewing...",
    reviewFixing: "Fixing...",
    reviewAdvisories: "Advisories (non-blocking):",
    strictness_lenient: "Lenient",
    strictness_balanced: "Balanced",
    strictness_strict: "Strict",
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
    regeneratePlan: "Regenerate",
    regenerateTitle: "Regenerate plan",
    regenerateModeSimple: "Just regenerate (use the original request)",
    regenerateModeWithNote: "Regenerate with a note",
    regenerateNotePlaceholder: "What was wrong with this plan?\ne.g. Too complex, drop the leaderboard feature.",
    regenerateConfirm: "Regenerate",
    cancel: "Cancel",
    runReview: "Review code",
    reviewStrictness: "Review strictness",
    strictnessLenient: "Lenient",
    strictnessBalanced: "Balanced",
    strictnessStrict: "Strict",
    reviewRound: "Reviewing (round {n}/{max})...",
    reviewFixing: "Fixing (round {n})...",
    reviewReportPassed: "Review passed ✓",
    reviewReportRemaining: "Review done · {n} item(s) remain",
    reviewReportClean: "No issues that need action",
    reviewAdvisories: "Advisories (non-blocking)",
    reviewFixedCount: "Fixed {n} item(s)",
  },
};
