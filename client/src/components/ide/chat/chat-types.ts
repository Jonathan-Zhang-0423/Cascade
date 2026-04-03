import type { LLMEventSource } from "@/stores/llm-monitor-store";

export interface ActionLogEntry {
  type:
    | "thinking"
    | "tool_call"
    | "file_read"
    | "file_write"
    | "step"
    | "narration";
  label: string;
  detail: string;
  timestamp: number;
  filePath?: string;
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
  "editor_token",
  "code_applied",
  "reviewing",
  "review_passed",
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
