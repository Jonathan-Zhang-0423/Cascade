import {
  BookOpen,
  CheckSquare,
  Code,
  Database,
  FilePlus,
  FileSearch,
  FileText,
  GitCompare,
  GitMerge,
  Globe,
  ListChecks,
  PencilLine,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ActionLogEntry } from "./chat-types";

export type ToolTone =
  | "read"
  | "search"
  | "edit"
  | "delete"
  | "terminal"
  | "research"
  | "review"
  | "memory"
  | "control"
  | "capability"
  | "tool";

export interface ToolDisplayMeta {
  name: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  tone: ToolTone;
  controlOnly?: boolean;
}

export interface ToolToneStyle {
  text: string;
  mutedText: string;
  iconText: string;
  iconBg: string;
  border: string;
  bg: string;
  badgeBg: string;
  badgeText: string;
}

const TOOL_DISPLAY: Record<string, ToolDisplayMeta> = {
  read_file: { name: "read_file", label: "读取文件", icon: FileText, tone: "read" },
  read_many_files: { name: "read_many_files", label: "批量读取文件", shortLabel: "批量读取", icon: FileSearch, tone: "read" },
  read_file_range: { name: "read_file_range", label: "读取文件行范围", shortLabel: "读取行范围", icon: FileSearch, tone: "read" },
  file_info: { name: "file_info", label: "查看文件信息", shortLabel: "文件信息", icon: FileText, tone: "read" },
  list_files: { name: "list_files", label: "查看文件列表", shortLabel: "文件列表", icon: ListChecks, tone: "read" },
  grep: { name: "grep", label: "搜索项目文件", shortLabel: "搜索文件", icon: Search, tone: "search" },

  write_file: { name: "write_file", label: "写入文件", icon: FilePlus, tone: "edit" },
  edit_file: { name: "edit_file", label: "编辑文件", icon: PencilLine, tone: "edit" },
  patch_file: { name: "patch_file", label: "补丁修改文件", shortLabel: "补丁修改", icon: GitCompare, tone: "edit" },
  hash_patch_file: { name: "hash_patch_file", label: "按块修改文件", shortLabel: "块级修改", icon: GitMerge, tone: "edit" },
  move_file: { name: "move_file", label: "移动文件", icon: GitMerge, tone: "edit" },
  delete_file: { name: "delete_file", label: "删除文件", icon: Trash2, tone: "delete" },

  ast_search: { name: "ast_search", label: "结构化搜索", shortLabel: "AST 搜索", icon: Code, tone: "search" },
  ast_replace: { name: "ast_replace", label: "结构化替换", shortLabel: "AST 替换", icon: Code, tone: "edit" },
  lsp_diagnostics: { name: "lsp_diagnostics", label: "检查诊断", shortLabel: "LSP 诊断", icon: ShieldCheck, tone: "review" },
  lsp_find_references: { name: "lsp_find_references", label: "查找引用", shortLabel: "引用查询", icon: GitCompare, tone: "search" },
  lsp_goto_definition: { name: "lsp_goto_definition", label: "跳转定义", shortLabel: "定义查询", icon: FileSearch, tone: "search" },

  shell_run: { name: "shell_run", label: "运行命令", icon: Terminal, tone: "terminal" },
  run_tests: { name: "run_tests", label: "运行测试", icon: CheckSquare, tone: "terminal" },

  mcp_search: { name: "mcp_search", label: "联网搜索", icon: Globe, tone: "research" },
  fetch_url: { name: "fetch_url", label: "读取网页", icon: Globe, tone: "research" },
  research: { name: "research", label: "联网调研", icon: Globe, tone: "research" },
  mcp: { name: "mcp", label: "MCP 工具", icon: Database, tone: "tool" },

  update_project_memory: { name: "update_project_memory", label: "更新项目记忆", shortLabel: "项目记忆", icon: BookOpen, tone: "memory" },
  submit_interaction_script: { name: "submit_interaction_script", label: "保存演示脚本", shortLabel: "演示脚本", icon: Zap, tone: "capability" },
  skill: { name: "skill", label: "技能工具", icon: Wrench, tone: "capability" },

  submit_plan: { name: "submit_plan", label: "提交计划", icon: ListChecks, tone: "control", controlOnly: true },
  mark_step_complete: { name: "mark_step_complete", label: "完成步骤", icon: CheckSquare, tone: "control", controlOnly: true },
  finish_build: { name: "finish_build", label: "完成构建", icon: CheckSquare, tone: "control", controlOnly: true },
  request_review: { name: "request_review", label: "请求审查", icon: ShieldCheck, tone: "control", controlOnly: true },
  report_issue: { name: "report_issue", label: "记录审查问题", shortLabel: "记录问题", icon: ShieldCheck, tone: "review", controlOnly: true },
  submit_verdict: { name: "submit_verdict", label: "提交审查结论", shortLabel: "审查结论", icon: ShieldCheck, tone: "review", controlOnly: true },
  submit_review: { name: "submit_review", label: "提交审查结果", shortLabel: "审查结果", icon: ShieldCheck, tone: "review", controlOnly: true },
};

export const TOOL_TONE_STYLE: Record<ToolTone, ToolToneStyle> = {
  read: {
    text: "text-[#818cf8]",
    mutedText: "text-[#818cf8]/70",
    iconText: "text-[#818cf8]",
    iconBg: "bg-[rgba(129,140,248,0.1)]",
    border: "border-[rgba(129,140,248,0.15)]",
    bg: "bg-[rgba(129,140,248,0.05)]",
    badgeBg: "bg-[rgba(129,140,248,0.1)]",
    badgeText: "text-[#818cf8]",
  },
  search: {
    text: "text-sky-300",
    mutedText: "text-sky-300/65",
    iconText: "text-sky-300",
    iconBg: "bg-sky-400/10",
    border: "border-sky-400/15",
    bg: "bg-sky-400/5",
    badgeBg: "bg-sky-400/10",
    badgeText: "text-sky-300",
  },
  edit: {
    text: "text-[#5fe8a0]",
    mutedText: "text-[#5fe8a0]/70",
    iconText: "text-[#5fe8a0]",
    iconBg: "bg-[rgba(52,214,138,0.15)]",
    border: "border-[rgba(52,214,138,0.25)]",
    bg: "bg-[rgba(52,214,138,0.08)]",
    badgeBg: "bg-[rgba(52,214,138,0.15)]",
    badgeText: "text-[#5fe8a0]",
  },
  delete: {
    text: "text-red-300",
    mutedText: "text-red-300/65",
    iconText: "text-red-300",
    iconBg: "bg-red-400/10",
    border: "border-red-400/20",
    bg: "bg-red-400/5",
    badgeBg: "bg-red-400/10",
    badgeText: "text-red-300",
  },
  terminal: {
    text: "text-amber-300",
    mutedText: "text-amber-300/65",
    iconText: "text-amber-300",
    iconBg: "bg-amber-400/10",
    border: "border-amber-400/20",
    bg: "bg-amber-400/5",
    badgeBg: "bg-amber-400/10",
    badgeText: "text-amber-300",
  },
  research: {
    text: "text-cyan-300",
    mutedText: "text-cyan-300/65",
    iconText: "text-cyan-300",
    iconBg: "bg-cyan-400/10",
    border: "border-cyan-400/20",
    bg: "bg-cyan-400/5",
    badgeBg: "bg-cyan-400/10",
    badgeText: "text-cyan-300",
  },
  review: {
    text: "text-violet-300",
    mutedText: "text-violet-300/65",
    iconText: "text-violet-300",
    iconBg: "bg-violet-400/10",
    border: "border-violet-400/20",
    bg: "bg-violet-400/5",
    badgeBg: "bg-violet-400/10",
    badgeText: "text-violet-300",
  },
  memory: {
    text: "text-emerald-300",
    mutedText: "text-emerald-300/65",
    iconText: "text-emerald-300",
    iconBg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
    bg: "bg-emerald-400/5",
    badgeBg: "bg-emerald-400/10",
    badgeText: "text-emerald-300",
  },
  control: {
    text: "text-muted-foreground/70",
    mutedText: "text-muted-foreground/50",
    iconText: "text-muted-foreground/55",
    iconBg: "bg-border/20",
    border: "border-border/20",
    bg: "bg-border/20",
    badgeBg: "bg-border/30",
    badgeText: "text-muted-foreground/70",
  },
  capability: {
    text: "text-fuchsia-300",
    mutedText: "text-fuchsia-300/65",
    iconText: "text-fuchsia-300",
    iconBg: "bg-fuchsia-400/10",
    border: "border-fuchsia-400/20",
    bg: "bg-fuchsia-400/5",
    badgeBg: "bg-fuchsia-400/10",
    badgeText: "text-fuchsia-300",
  },
  tool: {
    text: "text-foreground/80",
    mutedText: "text-muted-foreground/60",
    iconText: "text-muted-foreground/65",
    iconBg: "bg-border/20",
    border: "border-border/20",
    bg: "bg-border/20",
    badgeBg: "bg-border/30",
    badgeText: "text-muted-foreground/70",
  },
};

function baseFileName(path?: string): string {
  if (!path) return "";
  return path.split("/").pop() || path;
}

function inferToolNameFromLabel(label: string, type?: ActionLogEntry["type"]): string | undefined {
  const raw = label.trim();
  if (!raw) return undefined;
  if (TOOL_DISPLAY[raw]) return raw;
  const lower = raw.toLowerCase();
  if (TOOL_DISPLAY[lower]) return lower;

  if (lower === "shell") return "shell_run";
  if (lower === "tests") return "run_tests";
  if (lower === "skill") return "skill";
  if (lower === "ast search") return "ast_search";
  if (lower === "mcp search") return "mcp_search";
  if (lower === "fetch url") return "fetch_url";
  if (lower === "research" || lower === "research complete") return "research";
  if (lower.startsWith("mcp:")) return "mcp";
  if (lower.startsWith("info:")) return "file_info";
  if (lower.endsWith(" lines")) return "read_file_range";
  if (lower.startsWith("lsp: find references")) return "lsp_find_references";
  if (lower.startsWith("lsp: goto definition")) return "lsp_goto_definition";
  if (lower.startsWith("lsp:")) return "lsp_diagnostics";

  if (type === "file_delete") return "delete_file";
  if (type === "code_applied") return "write_file";
  if (type === "terminal_command") return "shell_run";
  return undefined;
}

export function getToolNameForAction(entry: Pick<ActionLogEntry, "type" | "label">): string | undefined {
  return inferToolNameFromLabel(entry.label || "", entry.type);
}

export function getToolDisplayMeta(nameOrLabel: string | undefined, type?: ActionLogEntry["type"]): ToolDisplayMeta | undefined {
  const inferred = inferToolNameFromLabel(nameOrLabel || "", type);
  return inferred ? TOOL_DISPLAY[inferred] : undefined;
}

export function getActionToolMeta(entry: Pick<ActionLogEntry, "type" | "label">): ToolDisplayMeta {
  const explicit = getToolDisplayMeta(entry.label, entry.type);
  if (explicit) return explicit;
  if (entry.type === "file_read") return TOOL_DISPLAY.read_file;
  if (entry.type === "file_write") return TOOL_DISPLAY.write_file;
  if (entry.type === "file_delete") return TOOL_DISPLAY.delete_file;
  if (entry.type === "code_applied") return TOOL_DISPLAY.write_file;
  if (entry.type === "research") return TOOL_DISPLAY.research;
  if (entry.type === "code_review") return TOOL_DISPLAY.submit_review;
  if (entry.type === "capabilities") return { name: "capabilities", label: "激活能力", icon: Zap, tone: "capability" };
  if (entry.type === "plan" || entry.type === "step") return TOOL_DISPLAY.submit_plan;
  if (entry.type === "terminal_command") return TOOL_DISPLAY.shell_run;
  return { name: "unknown", label: entry.label || "工具调用", icon: Wrench, tone: "tool" };
}

export function getActionToneStyle(entry: Pick<ActionLogEntry, "type" | "label">): ToolToneStyle {
  return TOOL_TONE_STYLE[getActionToolMeta(entry).tone] ?? TOOL_TONE_STYLE.tool;
}

export function isControlOnlyToolLabel(label: string): boolean {
  return Boolean(getToolDisplayMeta(label)?.controlOnly);
}

export function isProjectFileAction(entry: Pick<ActionLogEntry, "type" | "label" | "filePath">): boolean {
  if (!entry.filePath) return false;
  const toolName = getToolNameForAction(entry);
  if (toolName === "shell_run" || toolName === "run_tests" || toolName === "mcp" || toolName === "research") return false;
  return entry.type === "file_read" || entry.type === "file_write" || entry.type === "file_delete" || entry.type === "code_applied";
}

export function getActionDisplayLabel(entry: Pick<ActionLogEntry, "type" | "label" | "filePath" | "detail">): string {
  const meta = getActionToolMeta(entry);
  const file = baseFileName(entry.filePath);
  const raw = (entry.label || "").trim();
  const toolName = getToolNameForAction(entry);

  if (entry.type === "file_read") {
    if (toolName === "grep" || toolName === "ast_search" || toolName?.startsWith("lsp_")) return meta.label;
    if (toolName === "read_many_files") return meta.label;
    if (toolName === "file_info") return file ? `${file} 信息` : meta.label;
    if (toolName === "read_file_range") return file ? `${file} 行范围` : meta.label;
    return file || raw || meta.label;
  }

  if (entry.type === "file_write" || entry.type === "code_applied") {
    if (toolName === "shell_run" || toolName === "run_tests") return meta.label;
    return file || raw || meta.label;
  }

  if (entry.type === "file_delete") return file || raw || meta.label;
  if (entry.type === "research") return meta.label;
  return meta.shortLabel || meta.label || raw;
}

export function getActionVerbLabel(entry: Pick<ActionLogEntry, "type" | "label">): string | null {
  const meta = getActionToolMeta(entry);
  if (entry.type === "file_read") {
    if (meta.tone === "search") return "搜索";
    if (meta.tone === "review") return "检查";
    return "已读取";
  }
  if (entry.type === "file_write" || entry.type === "code_applied") {
    if (meta.name === "shell_run") return "命令";
    if (meta.name === "run_tests") return "测试";
    return "已写入";
  }
  if (entry.type === "file_delete") return "已删除";
  if (entry.type === "research") return "调研";
  if (entry.type === "tool_call") return meta.shortLabel || meta.label;
  return null;
}

export function describeActionForTimeline(entry: ActionLogEntry): string {
  const meta = getActionToolMeta(entry);
  const file = baseFileName(entry.filePath);
  const toolName = getToolNameForAction(entry);

  if (entry.type === "file_read") {
    if (toolName === "grep") return `搜索了项目文件${entry.detail ? `：${entry.detail}` : ""}`;
    if (toolName === "read_many_files") return `批量读取文件${entry.detail ? `：${entry.detail}` : ""}`;
    if (toolName === "read_file_range") return `读取了 ${file || "文件"} 的行范围${entry.detail ? `（${entry.detail}）` : ""}`;
    if (toolName === "file_info") return `查看了 ${file || "文件"} 信息`;
    if (toolName === "ast_search") return `执行了结构化搜索${entry.detail ? `：${entry.detail}` : ""}`;
    if (toolName === "lsp_diagnostics") return `检查了 ${file || "文件"} 的诊断`;
    if (toolName === "lsp_find_references") return "查找了符号引用";
    if (toolName === "lsp_goto_definition") return "查询了符号定义";
    return `读取了 ${file || entry.label || "文件"}`;
  }

  if (entry.type === "file_write" || entry.type === "code_applied") {
    if (toolName === "shell_run") return `执行命令：${entry.detail || entry.label}`;
    if (toolName === "run_tests") return `运行测试：${entry.detail || entry.label}`;
    if (toolName === "move_file") return `移动了 ${entry.detail || file || "文件"}`;
    return `${entry.type === "code_applied" ? "应用了" : "编辑了"} ${file || entry.label || "文件"}`;
  }

  if (entry.type === "file_delete") return `删除了 ${file || entry.label || "文件"}`;
  if (entry.type === "research") {
    if (toolName === "fetch_url") return `读取网页：${entry.detail || entry.label}`;
    if (toolName === "mcp_search") return `联网搜索：${entry.detail || entry.label}`;
    return entry.label.toLowerCase().includes("complete") ? `研究完成：${entry.detail || ""}`.trim() : `联网调研：${entry.detail || entry.label}`;
  }
  if (entry.type === "tool_call") return meta.name === "mcp" ? `调用 ${entry.label}` : meta.label;
  if (entry.type === "terminal_command") return `执行命令：${entry.label}`;
  if (entry.type === "code_review") return entry.label || "代码审查";
  if (entry.type === "capabilities") return entry.label || "能力激活";
  if (entry.type === "plan") return entry.label || "任务计划";
  return entry.label || meta.label || "";
}
