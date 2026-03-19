import { useState, useRef, useEffect, useCallback } from "react";
import { useIDEStore, type ChatMessage, type ManagerPlan, type ManagerSubTask, type VerificationResult, type HolisticReviewResult, type ReviewPhase, type ChatMode, flattenFiles } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowUp, Send, Sparkles, Lightbulb, X, Check, FileCode, Loader2, Square, ChevronRight, ChevronDown, ChevronUp, History, RotateCcw, ExternalLink, ClipboardList, Zap, Play, CircleDot, CheckCircle2, XCircle, Circle, AlertTriangle, StopCircle, Search, HelpCircle, ShieldCheck, Maximize2, Hammer, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";

function detectLanguage(text: string): string {
  const chineseRe = /[\u4e00-\u9fff]/;
  return chineseRe.test(text) ? "Chinese" : "English";
}

type PlanCardLang = "Chinese" | "English";

const planCardStrings: Record<PlanCardLang, Record<string, string>> = {
  Chinese: {
    startBuilding: "开始构建",
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
  },
  English: {
    startBuilding: "Start building",
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

function detectPlanCardLang(): PlanCardLang {
  const msgs = useIDEStore.getState().managerMessages;
  const firstUserMsg = msgs.find((m) => m.role === "user");
  if (firstUserMsg) {
    return detectLanguage(firstUserMsg.content) as PlanCardLang;
  }
  return "English";
}

function parsePlanLocalization(text: string): { summary?: string; stepTitles?: string[] } | null {
  const lines = text.split("\n");
  let summary: string | undefined;
  const stepTitles: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const summaryMatch = trimmed.match(/^\[PLAN[_ ]SUMMARY\]\s*(.+)/i);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }
    const stepMatch = trimmed.match(/^\[STEP[_ ](\d+)\]\s*(.+)/i);
    if (stepMatch) {
      stepTitles[parseInt(stepMatch[1]) - 1] = stepMatch[2].trim();
    }
  }

  if (!summary && stepTitles.length === 0) return null;
  return { summary, stepTitles: stepTitles.length > 0 ? stepTitles : undefined };
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
  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
              Applied
            </span>
          )}
          <button
            className="inline-flex items-center gap-1 text-primary/70 hover:text-primary hover:bg-primary/10 px-2 py-1 rounded transition-all text-[10px] font-medium"
            onClick={(e) => { e.stopPropagation(); openFile(block.filePath); }}
            data-testid={`button-open-${block.filePath}`}
          >
            <ExternalLink className="w-3 h-3" />
            <span>Open</span>
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
                Restored
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 underline underline-offset-2">
                <RotateCcw className="w-2.5 h-2.5" />
                Restore
              </span>
            )}
          </span>
        </>
      )}
    </div>
  );
}

function TypingIndicator({ text }: { text?: string }) {
  const lang = detectPlanCardLang();
  return (
    <div className="px-3 flex items-center gap-1.5" data-testid="typing-indicator">
      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{text || t(lang, "thinking")}</span>
    </div>
  );
}

function StepItem({ task, status, isCompleted }: {
  task: ManagerSubTask;
  status?: "pending" | "running" | "done" | "failed" | "needs-input" | "bug";
  isCompleted?: boolean;
}) {
  const s = status || "pending";
  const icons: Record<string, JSX.Element> = {
    pending: <Circle className="w-3 h-3 text-muted-foreground/40" />,
    running: <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />,
    done: <CheckCircle2 className={cn("w-3 h-3", isCompleted ? "text-muted-foreground/40" : "text-green-500")} />,
    failed: <XCircle className="w-3 h-3 text-red-500" />,
    "needs-input": <HelpCircle className="w-3 h-3 text-yellow-500" />,
    bug: <AlertTriangle className="w-3 h-3 text-orange-500" />,
  };

  return (
    <div className="py-1" data-testid={`step-${task.step}`}>
      <div className="flex items-center gap-2">
        <div className="shrink-0">{icons[s] || icons.pending}</div>
        <span className={cn(
          "text-[12px] leading-snug flex-1",
          isCompleted ? "text-muted-foreground/50 line-through" :
          s === "done" ? "text-muted-foreground line-through" :
          s === "failed" ? "text-red-400" :
          s === "running" ? "text-foreground font-medium" :
          s === "needs-input" ? "text-yellow-500" :
          s === "bug" ? "text-orange-500" :
          "text-foreground/80"
        )}>
          {task.title}
        </span>
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
  if (phase === "idle") return null;

  const issueCount = review ? (review.bugs?.length || 0) + (review.missing_features?.length || 0) + (review.regressions?.length || 0) : 0;

  const configs: Record<string, { icon: JSX.Element; text: string; color: string }> = {
    building: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      text: t(lang, "building"),
      color: "text-blue-400",
    },
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
  onExecute,
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
  plan: ManagerPlan;
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "needs-input" | "bug">;
  onExecute?: () => void;
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
  const lang = detectPlanCardLang();
  const steps = normalizeSteps(plan);
  const doneCount = steps.filter((s) => taskStatuses[String(s.step)] === "done").length;
  const total = steps.length;
  const allDone = doneCount === total && total > 0;
  const hasNeedsInput = steps.some((s) => taskStatuses[String(s.step)] === "needs-input");
  const phase = reviewPhase || "idle";
  const hasReviewConfirmation = !!(pendingConfirmation?.stepKey === "review" && phase === "review_failed");
  const showConfirmation = hasNeedsInput || hasReviewConfirmation;
  const isFullyComplete = phase === "review_passed" && allDone;

  return (
    <div className={cn("mx-3 my-1 rounded-lg border overflow-hidden", isFullyComplete ? "border-green-500/30 bg-card/30" : "border-border/40 bg-card/50")} data-testid="task-plan-card">
      <div className="px-3 pt-2.5 pb-1.5">
        <p className={cn("text-[13px] leading-snug", isFullyComplete ? "text-muted-foreground" : "text-foreground")}>{plan.summary || (plan as any).user_requirement || ""}</p>
      </div>

      <div className="px-3 pb-2 space-y-0">
        {steps.map((task: ManagerSubTask) => (
          <StepItem
            key={task.step}
            task={task}
            status={taskStatuses[String(task.step)]}
            isCompleted={isFullyComplete}
          />
        ))}
      </div>

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
              onClick={() => onContinueWithInput("Looks good, proceed as planned")}
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
          ) : showConfirmation ? null : (
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
  );
}

const PREVIEW_STEP_COUNT = 10;

function PlanReviewCard({
  plan,
  onBuildNow,
  onRevise,
  onDismiss,
}: {
  plan: ManagerPlan;
  onBuildNow: () => void;
  onRevise: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const steps = normalizeSteps(plan);
  const visibleSteps = expanded ? steps : steps.slice(0, PREVIEW_STEP_COUNT);
  const hasMore = steps.length > PREVIEW_STEP_COUNT;

  return (
    <>
      <div className="mx-3 my-1 rounded-lg border border-primary/30 bg-card/60 overflow-hidden shadow-sm" data-testid="plan-review-card">
        <div className="px-3 pt-2.5 pb-1.5 flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <ClipboardList className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <p className="text-[13px] font-medium text-foreground leading-snug">{plan.summary}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setModalOpen(true)}
              className="p-1 rounded hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
              title="View full plan"
              data-testid="button-expand-plan"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
            <button
              onClick={onDismiss}
              className="p-1 rounded hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
              title="Dismiss"
              data-testid="button-dismiss-review"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="relative px-3 pb-2">
          <div className="space-y-0">
            {visibleSteps.map((step) => (
              <div key={step.step} className="flex items-start gap-2 py-1">
                <div className="w-4 h-4 rounded-full border border-border/60 bg-muted/40 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[9px] text-muted-foreground font-medium">{step.step}</span>
                </div>
                <span className="text-[12px] text-foreground/80 leading-snug">{step.title}</span>
              </div>
            ))}
          </div>

          {hasMore && !expanded && (
            <div className="relative mt-1">
              <div className="space-y-0">
                {steps.slice(PREVIEW_STEP_COUNT, PREVIEW_STEP_COUNT + 2).map((step) => (
                  <div key={step.step} className="flex items-start gap-2 py-1 blur-[2px] select-none pointer-events-none opacity-50">
                    <div className="w-4 h-4 rounded-full border border-border/60 bg-muted/40 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] text-muted-foreground font-medium">{step.step}</span>
                    </div>
                    <span className="text-[12px] text-foreground/80 leading-snug">{step.title}</span>
                  </div>
                ))}
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-card/90 pointer-events-none" />
              </div>
              <button
                onClick={() => setExpanded(true)}
                className="flex items-center gap-1 mt-1 text-[11px] text-primary hover:text-primary/80 transition-colors"
                data-testid="button-expand-steps"
              >
                <ChevronDown className="w-3 h-3" />
                Show all {steps.length} steps
              </button>
            </div>
          )}

          {expanded && hasMore && (
            <button
              onClick={() => setExpanded(false)}
              className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-collapse-steps"
            >
              <ChevronUp className="w-3 h-3" />
              Collapse
            </button>
          )}
        </div>

        <div className="px-3 py-2 border-t border-border/30 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1.5"
            onClick={onRevise}
            data-testid="button-revise-plan"
          >
            <PenLine className="w-3 h-3" />
            Revise Plan
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            className="h-7 text-[11px] gap-1.5"
            onClick={onBuildNow}
            data-testid="button-build-now"
          >
            <Hammer className="w-3 h-3" />
            Build Now
          </Button>
        </div>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid="dialog-full-plan">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold leading-snug">{plan.summary}</DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-3">
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
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => { setModalOpen(false); onRevise(); }}
              data-testid="button-revise-plan-modal"
            >
              <PenLine className="w-3 h-3" />
              Revise Plan
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => { setModalOpen(false); onBuildNow(); }}
              data-testid="button-build-now-modal"
            >
              <Hammer className="w-3 h-3" />
              Build Now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ManagerMessageBubble({
  message,
  taskStatuses,
  onExecute,
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
  message: { role: string; content: string; plan?: ManagerPlan; source?: "communicator" | "manager_raw" };
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "needs-input" | "bug">;
  onExecute?: () => void;
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
        onExecute={onExecute}
        isExecuting={isExecuting}
        onStop={onStop}
        onContinueWithInput={onContinueWithInput}
        pendingConfirmation={pendingConfirmation}
        confirmationInput={confirmationInput}
        onConfirmationInputChange={onConfirmationInputChange}
        reviewPhase={reviewPhase}
        holisticReview={holisticReview}
        fixCycle={fixCycle}
      />
    );
  }

  if (message.source === "manager_raw") {
    return null;
  }

  return (
    <div className="px-3 text-[13px] leading-relaxed text-foreground" data-testid="plan-message-bubble">
      <div className="flex items-start gap-2">
        <div className="shrink-0 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
          <ClipboardList className="w-3 h-3 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-medium text-primary/70 block mb-0.5">Plan</span>
          <p className="text-foreground/90 whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
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
    updateTaskStatus,
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
  } = useIDEStore();
  const { renameProject } = useProjectStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingHandled = useRef(false);
  const executionAbortRef = useRef(false);
  const preBuildSnapshotRef = useRef<{ path: string; content: string }[] | null>(null);
  const autoExecutePlanRef = useRef(false);
  const [autoAppliedMessageIds] = useState<Set<string>>(new Set());
  const [appliedBlockIndices] = useState<Set<number>>(new Set());
  const [showPlanReview, setShowPlanReview] = useState(false);
  const [smartResponseLoading, setSmartResponseLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const inputBoxRef = useRef<HTMLDivElement>(null);

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
  }, [chatMessages, managerMessages, showPlanReview]);

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
      .filter((m) => m.role === "user" || m.plan || (m.role === "assistant" && m.source !== "communicator"))
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.plan ? JSON.stringify(m.plan) : m.content,
      }));

    setManagerResponding(true);

    try {
      const response = await fetch("/api/manager-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesForApi, files: fileContext }),
      });

      const data = await response.json();

      if (projectId) {
        const nameFromField = data.project_name?.trim();
        const nameFromMarker = data.message ? data.message.match(PROJECT_NAME_REGEX)?.[1]?.trim() : undefined;
        const detectedName = nameFromField || nameFromMarker;
        if (detectedName) {
          renameProject(projectId, detectedName);
        }
      }

      if (data.error && !data.plan && !data.message) {
        addManagerMessage({ role: "assistant", content: "Hmm, I had a little trouble understanding that. Could you try rephrasing your request? 🤔", source: "communicator" });
      } else if (data.message) {
        addManagerMessage({ role: "assistant", content: stripProjectNameMarker(data.message), source: "communicator" });
      } else if (data.plan) {
        clearManagerPlan();
        const steps = normalizeSteps(data.plan);
        for (const t of steps) {
          updateTaskStatus(String(t.step), "pending");
        }

        const userLang = detectLanguage(trimmed);
        const communicatorResponse = await callCommunicator({
          event: "plan_created",
          userLanguage: userLang,
          planSummary: data.plan.summary || "",
          totalSteps: steps.length,
          stepTitles: steps.map((s) => s.title),
        });

        const localized = parsePlanLocalization(communicatorResponse);
        const displayPlan = { ...data.plan };
        if (localized?.summary) {
          displayPlan.summary = localized.summary;
        }
        const rawSteps = displayPlan.steps || (displayPlan as any).sub_tasks;
        if (localized?.stepTitles && Array.isArray(rawSteps)) {
          const localizedSteps = rawSteps.map((step: any, i: number) => ({
            ...step,
            title: localized.stepTitles?.[i] || step.title,
          }));
          if (displayPlan.steps) {
            displayPlan.steps = localizedSteps;
          } else {
            (displayPlan as any).sub_tasks = localizedSteps;
          }
        }

        if (communicatorResponse) {
          const friendlyLines = communicatorResponse
            .split("\n")
            .filter((l) => !l.trim().match(/^\[PLAN[_ ]SUMMARY\]/i) && !l.trim().match(/^\[STEP[_ ]\d+\]/i))
            .map((l) => l.trim())
            .filter(Boolean)
            .join("\n");
          const msgs = useIDEStore.getState().managerMessages;
          const lastIdx = msgs.length - 1;
          if (lastIdx >= 0 && msgs[lastIdx].source === "communicator") {
            if (friendlyLines) {
              useIDEStore.setState({
                managerMessages: [
                  ...msgs.slice(0, lastIdx),
                  { ...msgs[lastIdx], content: friendlyLines },
                ],
              });
            } else {
              useIDEStore.setState({
                managerMessages: msgs.slice(0, lastIdx),
              });
            }
          }
        }

        setManagerPlan(displayPlan);
        addManagerMessage({ role: "assistant", content: "", plan: displayPlan });

        if (chatMode === "build") {
          autoExecutePlanRef.current = true;
        }
      }
    } catch (error: any) {
      addManagerMessage({ role: "assistant", content: "Oops, I couldn't connect to the team right now. Please try again in a moment! 🔄", source: "communicator" });
    } finally {
      setManagerResponding(false);
    }
  }, [input, isManagerResponding, isAiResponding, files, addManagerMessage, setManagerResponding, setManagerPlan, updateTaskStatus, callCommunicator, projectId, renameProject, chatMode]);

  const executeSubTask = useCallback(async (
    description: string,
    title: string,
    managerContext?: { sub_task_id: string; acceptance_criteria: string; required_files?: string[] }
  ): Promise<boolean> => {
    let prompt = description;

    if (managerContext && (managerContext.sub_task_id || managerContext.acceptance_criteria)) {
      const contextLines: string[] = [];
      contextLines.push(`[Plan Mode] You are executing subtask ${managerContext.sub_task_id || title}: ${title}`);
      contextLines.push(`Task description: ${description}`);
      if (managerContext.acceptance_criteria) {
        contextLines.push(`Acceptance criteria: ${managerContext.acceptance_criteria}`);
      }
      if (userConfirmationRef.current) {
        contextLines.push("");
        contextLines.push(`User's response to confirmation items: ${userConfirmationRef.current}`);
        userConfirmationRef.current = "";
      }
      contextLines.push("");
      contextLines.push("IMPORTANT: You are modifying existing project files. You MUST preserve ALL existing content. Only add, modify, or remove what is specifically described in this task. When outputting a file, include the COMPLETE file with all its original content plus your changes — never omit or rewrite existing code that is not part of this task.");
      contextLines.push("");
      contextLines.push("Please implement the above subtask. Focus only on this specific task and ensure the acceptance criteria are met.");
      prompt = contextLines.join("\n");
    }

    const allFiles = flattenFiles(useIDEStore.getState().files);

    let fileContext: { path: string; content: string }[];
    const requiredFiles = managerContext?.required_files;
    if (requiredFiles && requiredFiles.length > 0) {
      const requiredSet = new Set(requiredFiles);
      const matched = allFiles.filter((f) => requiredSet.has(f.path));
      fileContext = matched.map((f) => ({ path: f.path, content: f.content || "" }));
    } else {
      fileContext = allFiles.map((f) => ({ path: f.path, content: f.content || "" }));
    }

    const editorMessages = [{ role: "user" as const, content: prompt }];

    if (!managerContext) {
      addChatMessage({ role: "user", content: prompt });
    }
    addChatMessage({ role: "assistant", content: "", ...(managerContext ? { hidden: true } : {}) });
    setAiResponding(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: editorMessages,
          files: fileContext,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        updateLastAssistantMessage("Failed to execute subtask.");
        return false;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        updateLastAssistantMessage("Could not read response.");
        return false;
      }

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      let streamDone = false;
      const appliedBlockCount = { current: 0 };
      let lastUIUpdate = 0;
      let uiUpdatePending = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith("data: ")) {
            const data = trimmedLine.slice(6).trim();
            if (data === "[DONE]") {
              streamDone = true;
              break;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                accumulated += parsed.content;
                uiUpdatePending = true;

                const now = performance.now();

                if (now - lastUIUpdate > 16) {
                  updateLastAssistantMessage(stripProjectNameMarker(accumulated));
                  lastUIUpdate = now;
                  uiUpdatePending = false;
                }

                const hasCodeFence = parsed.content.includes("```");
                if (hasCodeFence) {
                  const currentBlocks = extractCodeBlocks(stripProjectNameMarker(accumulated));
                  if (currentBlocks.length > appliedBlockCount.current) {
                    for (let bi = appliedBlockCount.current; bi < currentBlocks.length; bi++) {
                      await applyCodeBlock(currentBlocks[bi]);
                      refreshPreview();
                    }
                    appliedBlockCount.current = currentBlocks.length;
                  }
                }
              }
            } catch {}
          }
        }
      }

      if (uiUpdatePending) {
        updateLastAssistantMessage(stripProjectNameMarker(accumulated));
      }

      const finalBlocks = extractCodeBlocks(stripProjectNameMarker(accumulated));
      for (let bi = appliedBlockCount.current; bi < finalBlocks.length; bi++) {
        await applyCodeBlock(finalBlocks[bi]);
        refreshPreview();
      }
      if (finalBlocks.length > 0) {
        createCheckpoint(title);
      }

      return true;
    } catch (error: any) {
      if (error.name === "AbortError") return false;
      updateLastAssistantMessage("Error executing subtask.");
      return false;
    } finally {
      setAiResponding(false);
      abortRef.current = null;
    }
  }, [addChatMessage, updateLastAssistantMessage, setAiResponding, refreshPreview, createCheckpoint, applyCodeBlock]);

  const MAX_FIX_CYCLES = 3;

  const performHolisticReview = useCallback(async (
    userRequest: string,
    planSteps: ManagerSubTask[],
    filesBefore: { path: string; content: string }[],
    userFeedback?: string,
  ): Promise<HolisticReviewResult | null> => {
    const allFiles = flattenFiles(useIDEStore.getState().files);
    const filesAfter = allFiles.map((f) => ({ path: f.path, content: f.content || "" }));

    try {
      const body: Record<string, unknown> = {
        user_request: userRequest,
        plan_steps: planSteps.map((s) => ({
          step: s.step,
          title: s.title,
          description: s.description,
          acceptance_criteria: s.acceptance_criteria || "",
        })),
        files_before: filesBefore,
        files_after: filesAfter,
      };
      if (userFeedback) body.user_feedback = userFeedback;

      const resp = await fetch("/api/verifier-holistic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (data.review) return data.review as HolisticReviewResult;
      return null;
    } catch {
      return null;
    }
  }, []);

  const requestFixPlan = useCallback(async (
    reviewResult: HolisticReviewResult,
    userRequest: string,
  ): Promise<ManagerPlan | null> => {
    const allFiles = flattenFiles(useIDEStore.getState().files);
    const fileContext = allFiles.map((f) => ({ path: f.path, content: f.content || "" }));

    try {
      const resp = await fetch("/api/manager-fix-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: fileContext,
          bug_report: {
            bugs: reviewResult.bugs || [],
            missing_features: reviewResult.missing_features || [],
            regressions: reviewResult.regressions || [],
            summary: reviewResult.summary || "",
            suggestion: reviewResult.suggestion || "",
          },
          original_request: userRequest,
        }),
      });
      const data = await resp.json();
      if (data.plan) return data.plan as ManagerPlan;
      return null;
    } catch {
      return null;
    }
  }, []);

  const handleExecutePlan = useCallback(async () => {
    const plan = useIDEStore.getState().managerPlan;
    if (!plan) return;

    setChatMode("build");

    const normalizedSteps = normalizeSteps(plan);

    const firstUserMsg = useIDEStore.getState().managerMessages.find(m => m.role === "user");
    const userRequest = firstUserMsg?.content || "";
    const userLang = firstUserMsg ? detectLanguage(userRequest) : "English";

    executionAbortRef.current = false;

    const allStepsDone = normalizedSteps.every(
      t => useIDEStore.getState().taskStatuses[String(t.step)] === "done" ||
           useIDEStore.getState().taskStatuses[String(t.step)] === "bug"
    );
    const isResume = allStepsDone && preBuildSnapshotRef.current !== null;

    if (!isResume) {
      preBuildSnapshotRef.current = flattenFiles(useIDEStore.getState().files)
        .map((f) => ({ path: f.path, content: f.content || "" }));
    }
    const filesBeforeBuild = preBuildSnapshotRef.current!;

    setReviewPhase("building");
    setFixCycle(0);
    setHolisticReview(null);

    await callCommunicator({
      event: "build_starting",
      userLanguage: userLang,
      totalSteps: normalizedSteps.length,
      planSummary: plan.summary,
    });

    for (let i = 0; i < normalizedSteps.length; i++) {
      if (executionAbortRef.current) break;

      const task = normalizedSteps[i];
      const key = String(task.step);
      const currentStatus = useIDEStore.getState().taskStatuses[key];
      if (currentStatus === "done") continue;

      setExecutingTaskIndex(i);
      updateTaskStatus(key, "running");

      await callCommunicator({
        event: "step_starting",
        userLanguage: userLang,
        stepNumber: task.step,
        stepTitle: task.title,
        stepDescription: task.description,
        totalSteps: normalizedSteps.length,
      });

      const success = await executeSubTask(task.description, task.title, {
        sub_task_id: task.sub_task_id || "",
        acceptance_criteria: task.acceptance_criteria || "",
        required_files: task.required_files,
      });

      if (executionAbortRef.current) {
        updateTaskStatus(key, "pending");
        setReviewPhase("idle");
        break;
      }

      if (success) {
        updateTaskStatus(key, "done");
        await callCommunicator({
          event: "step_completed",
          userLanguage: userLang,
          stepNumber: task.step,
          stepTitle: task.title,
        });
      } else {
        updateTaskStatus(key, "failed");
      }
    }

    if (executionAbortRef.current) {
      setExecutingTaskIndex(null);
      return;
    }

    const buildStatuses = useIDEStore.getState().taskStatuses;
    const allBuilt = normalizedSteps.every(t => buildStatuses[String(t.step)] === "done");

    if (!allBuilt) {
      setReviewPhase("idle");
      setExecutingTaskIndex(null);
      return;
    }

    await callCommunicator({
      event: "build_complete",
      userLanguage: userLang,
      totalSteps: normalizedSteps.length,
    });

    let currentCycle = 0;
    let currentPlanSteps = normalizedSteps;
    let passed = false;

    while (currentCycle < MAX_FIX_CYCLES && !passed && !executionAbortRef.current) {
      currentCycle++;
      setFixCycle(currentCycle);
      setReviewPhase("reviewing");

      await callCommunicator({
        event: "reviewing",
        userLanguage: userLang,
      });

      const feedback = userConfirmationRef.current || undefined;
      if (feedback) userConfirmationRef.current = "";
      const review = await performHolisticReview(userRequest, currentPlanSteps, filesBeforeBuild, feedback);

      if (executionAbortRef.current) {
        setReviewPhase("idle");
        break;
      }

      if (!review) {
        setReviewPhase("review_failed");
        await callCommunicator({
          event: "bugs_found",
          userLanguage: userLang,
          bugCount: 0,
          reviewSummary: "Review failed due to an error. Treating as inconclusive.",
          fixCycle: currentCycle,
          maxFixCycles: MAX_FIX_CYCLES,
        });
        break;
      }

      setHolisticReview(review);

      if (review.user_confirmation_needed?.length > 0 &&
          review.user_confirmation_needed[0] !== "") {
        setPendingConfirmation({ stepKey: "review", items: review.user_confirmation_needed });
        await callCommunicator({
          event: "needs_input",
          userLanguage: userLang,
          confirmationItems: review.user_confirmation_needed,
        });
        setReviewPhase("review_failed");
        setExecutingTaskIndex(null);
        return;
      }

      if (review.overall_status === "pass") {
        setReviewPhase("review_passed");
        passed = true;
        for (const step of currentPlanSteps) {
          const key = String(step.step);
          if (useIDEStore.getState().taskStatuses[key] === "bug") {
            updateTaskStatus(key, "done");
          }
        }
        await callCommunicator({
          event: "review_passed",
          userLanguage: userLang,
          reviewSummary: review.summary,
        });
        break;
      }

      setReviewPhase("review_failed");

      for (const step of currentPlanSteps) {
        const key = String(step.step);
        if (useIDEStore.getState().taskStatuses[key] === "done") {
          updateTaskStatus(key, "bug");
        }
      }

      const issueCount = (review.bugs?.length || 0) + (review.missing_features?.length || 0) + (review.regressions?.length || 0);

      await callCommunicator({
        event: "bugs_found",
        userLanguage: userLang,
        bugCount: issueCount,
        reviewSummary: review.summary,
        fixCycle: currentCycle,
        maxFixCycles: MAX_FIX_CYCLES,
      });

      setReviewPhase("fixing");

      await callCommunicator({
        event: "fixing",
        userLanguage: userLang,
        fixCycle: currentCycle,
        maxFixCycles: MAX_FIX_CYCLES,
      });

      const fixPlan = await requestFixPlan(review, userRequest);

      if (!fixPlan || !fixPlan.steps || fixPlan.steps.length === 0) {
        setReviewPhase("review_failed");
        break;
      }

      const fixSteps = normalizeSteps(fixPlan);

      for (let i = 0; i < fixSteps.length; i++) {
        if (executionAbortRef.current) break;

        const fixTask = fixSteps[i];

        await callCommunicator({
          event: "step_starting",
          userLanguage: userLang,
          stepNumber: fixTask.step,
          stepTitle: fixTask.title,
          stepDescription: fixTask.description,
          totalSteps: fixSteps.length,
        });

        const fixSuccess = await executeSubTask(fixTask.description, fixTask.title, {
          sub_task_id: fixTask.sub_task_id || "",
          acceptance_criteria: fixTask.acceptance_criteria || "",
          required_files: fixTask.required_files,
        });

        if (fixSuccess) {
          await callCommunicator({
            event: "step_completed",
            userLanguage: userLang,
            stepNumber: fixTask.step,
            stepTitle: fixTask.title,
          });
        }
      }

      currentPlanSteps = [...normalizedSteps, ...fixSteps];
    }

    if (passed) {
      preBuildSnapshotRef.current = null;
      await callCommunicator({
        event: "all_complete",
        userLanguage: userLang,
        totalSteps: normalizedSteps.length,
      });
    }

    setExecutingTaskIndex(null);
  }, [executeSubTask, performHolisticReview, requestFixPlan, setExecutingTaskIndex, updateTaskStatus, callCommunicator, setReviewPhase, setHolisticReview, setFixCycle, setPendingConfirmation, setChatMode]);

  const handleStopExecution = useCallback(() => {
    executionAbortRef.current = true;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setAiResponding(false);
    setExecutingTaskIndex(null);
    setReviewPhase("idle");
  }, [setAiResponding, setExecutingTaskIndex, setReviewPhase]);

  const userConfirmationRef = useRef<string>("");

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
      executionAbortRef.current = true;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setAiResponding(false);
    setManagerResponding(false);
  }, [setAiResponding, setManagerResponding, isExecuting]);

  const handleToggleMode = useCallback(() => {
    const next = chatMode === "manager" ? "build" : "manager";
    if (next === "build" && managerPlan && !isExecuting) {
      setChatMode("build");
      setShowPlanReview(true);
    } else {
      setChatMode(next);
      setShowPlanReview(false);
    }
  }, [chatMode, managerPlan, isExecuting, setChatMode]);

  const handleRevisePlan = useCallback(() => {
    setChatMode("manager");
    setShowPlanReview(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [setChatMode]);

  const handleBuildNow = useCallback(() => {
    setShowPlanReview(false);
    handleExecutePlan();
  }, [handleExecutePlan]);

  const handleCurrentSend = useCallback(() => {
    if (pendingConfirmation) {
      const trimmed = input.trim();
      if (trimmed) {
        setInput("");
        handleContinueExecution(trimmed);
      }
      return;
    }
    handleManagerSend();
  }, [handleManagerSend, pendingConfirmation, input, handleContinueExecution]);

  const handleCurrentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleCurrentSend();
    }
  };

  const handleSmartResponse = useCallback(async () => {
    const msgs = chatMode === "manager"
      ? managerMessages.filter(m => !m.hidden).map(m => ({ role: m.role, content: m.content }))
      : chatMessages.filter(m => m.role !== "checkpoint" && !m.hidden).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

    if (msgs.length === 0) return;

    setSmartResponseLoading(true);
    try {
      const res = await fetch("/api/smart-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, mode: chatMode }),
      });
      const data = await res.json();
      if (data.suggestion) {
        setInput(data.suggestion);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    } catch {
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
          <span className="text-xs font-medium text-foreground">
            AI Chat
          </span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setActiveTool(null)}
          aria-label="Close panel"
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

          return merged.map((item) => {
            if (item.kind === "chat") {
              const { msg, idx } = item;
              if (msg.hidden) return null;
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
              const isLastPlan = msg.plan && msg.id === lastPlanMsgId;
              return (
                <ManagerMessageBubble
                  key={`m-${msg.id}`}
                  message={msg}
                  taskStatuses={taskStatuses}
                  onExecute={isLastPlan ? handleExecutePlan : undefined}
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
              );
            }
          });
        })()}
        {showPlanReview && managerPlan && (
          <PlanReviewCard
            plan={managerPlan}
            onBuildNow={handleBuildNow}
            onRevise={handleRevisePlan}
            onDismiss={() => setShowPlanReview(false)}
          />
        )}
        {isAiResponding && chatMessages[chatMessages.length - 1]?.content === "" && chatMode !== "manager" && (
          <TypingIndicator />
        )}
        {isManagerResponding && (
          <TypingIndicator text={t(detectPlanCardLang(), "planning")} />
        )}
      </div>
      <div className="px-2 pb-2 pt-1.5 border-t border-border/50 shrink-0">
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
            placeholder={chatMode === "manager" && pendingConfirmation ? "Type your response to continue..." : chatMode === "manager" ? "Ask questions, brainstorm, or describe what to build..." : "Describe what you want to build..."}
            className="resize-none text-[13px] min-h-[60px] overflow-y-auto rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent px-3 pt-3 pb-1"
            data-testid="input-chat"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <button
              className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-muted/50 transition-colors group"
              onClick={handleToggleMode}
              data-testid="toggle-plan-mode"
              title={chatMode === "manager" ? "Switch to Build mode" : "Switch to Plan mode"}
            >
              <div className={cn(
                "w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors shrink-0",
                chatMode === "manager"
                  ? "bg-primary border-primary"
                  : "border-muted-foreground/40 group-hover:border-muted-foreground/70"
              )}>
                {chatMode === "manager" && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
              </div>
              <span className="text-[11px] text-muted-foreground font-medium group-hover:text-foreground transition-colors">Plan</span>
            </button>
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
              title="Smart Response — let AI suggest a reply"
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
                disabled={!input.trim()}
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
