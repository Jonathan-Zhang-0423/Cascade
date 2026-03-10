import { useState, useRef, useEffect, useCallback } from "react";
import { useIDEStore, type ChatMessage, type ManagerPlan, type ManagerSubTask, type VerificationResult, type ChatMode, flattenFiles } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Sparkles, X, Check, FileCode, Loader2, Square, ChevronRight, ChevronDown, ChevronUp, History, RotateCcw, ExternalLink, ClipboardList, Zap, Play, CircleDot, CheckCircle2, XCircle, Circle, AlertTriangle, StopCircle, Search, HelpCircle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

function normalizeSteps(plan: any): ManagerSubTask[] {
  const raw = plan?.steps ?? plan?.sub_tasks;
  if (!Array.isArray(raw)) return [];
  return raw.map((t: any, i: number) => ({
    step: t.step ?? i + 1,
    sub_task_id: t.sub_task_id ?? "",
    title: t.title ?? t.description?.slice(0, 50) ?? `Step ${i + 1}`,
    description: t.description ?? "",
    acceptance_criteria: t.acceptance_criteria ?? "",
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

function parseCodeBlocks(content: string): Array<string | CodeBlock> {
  const parts: Array<string | CodeBlock> = [];
  const regex = /```(\w*)\s+file="([^"]+)"\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    parts.push({
      language: match[1] || "text",
      filePath: match[2],
      code: match[3].trimEnd(),
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
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
  let lastBulletIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      lastBulletIdx = i;
    }
  }

  if (lastBulletIdx === -1) {
    return { body: text, trailing: "" };
  }

  const body = lines.slice(0, lastBulletIdx + 1).join("\n");
  const trailing = lines.slice(lastBulletIdx + 1).join("\n");
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
      <div className="rounded-full px-3.5 py-1.5 text-[13px] leading-relaxed bg-muted text-foreground max-w-[85%]">
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
  return (
    <div className="px-3 flex items-center gap-1.5" data-testid="typing-indicator">
      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{text || "Thinking..."}</span>
    </div>
  );
}

function StepItem({ task, status, verification }: {
  task: ManagerSubTask;
  status?: "pending" | "running" | "done" | "failed" | "verifying" | "needs-input";
  verification?: VerificationResult;
}) {
  const s = status || "pending";
  const icons: Record<string, JSX.Element> = {
    pending: <Circle className="w-3 h-3 text-muted-foreground/40" />,
    running: <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />,
    verifying: <Search className="w-3 h-3 text-amber-400 animate-pulse" />,
    done: <CheckCircle2 className="w-3 h-3 text-green-500" />,
    failed: <XCircle className="w-3 h-3 text-red-500" />,
    "needs-input": <HelpCircle className="w-3 h-3 text-yellow-500" />,
  };

  const matchPercent = verification?.requirement_match_percent;

  return (
    <div className="py-1" data-testid={`step-${task.step}`}>
      <div className="flex items-center gap-2">
        <div className="shrink-0">{icons[s] || icons.pending}</div>
        <span className={cn(
          "text-[12px] leading-snug flex-1",
          s === "done" ? "text-muted-foreground line-through" :
          s === "failed" ? "text-red-400" :
          s === "running" ? "text-foreground font-medium" :
          s === "verifying" ? "text-amber-400 font-medium" :
          s === "needs-input" ? "text-yellow-500" :
          "text-foreground/80"
        )}>
          {task.title}
        </span>
        {matchPercent != null && s === "done" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 font-medium" data-testid={`match-${task.step}`}>
            {matchPercent}%
          </span>
        )}
        {s === "verifying" && (
          <span className="text-[10px] text-amber-400">Verifying...</span>
        )}
      </div>
      {verification?.error_summary && s === "failed" && (
        <p className="text-[10px] text-red-400/80 pl-5 mt-0.5 leading-snug">{verification.error_summary}</p>
      )}
    </div>
  );
}

function TaskPlanCard({
  plan,
  taskStatuses,
  verificationResults,
  onExecute,
  isExecuting,
  onStop,
  onContinue,
}: {
  plan: ManagerPlan;
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "verifying" | "needs-input">;
  verificationResults?: Record<string, VerificationResult>;
  onExecute?: () => void;
  isExecuting?: boolean;
  onStop?: () => void;
  onContinue?: () => void;
}) {
  const steps = normalizeSteps(plan);
  const doneCount = steps.filter((t) => taskStatuses[String(t.step)] === "done").length;
  const total = steps.length;
  const allDone = doneCount === total && total > 0;
  const hasNeedsInput = steps.some((t) => taskStatuses[String(t.step)] === "needs-input");
  const isVerifying = steps.some((t) => taskStatuses[String(t.step)] === "verifying");

  return (
    <div className="mx-3 my-1 rounded-lg border border-border/40 bg-card/50 overflow-hidden" data-testid="task-plan-card">
      <div className="px-3 pt-2.5 pb-1.5">
        <p className="text-[13px] text-foreground leading-snug">{plan.summary || (plan as any).user_requirement || ""}</p>
      </div>

      <div className="px-3 pb-2 space-y-0">
        {steps.map((task: ManagerSubTask) => {
          const key = task.sub_task_id || String(task.step);
          return (
            <StepItem
              key={task.step}
              task={task}
              status={taskStatuses[String(task.step)]}
              verification={verificationResults?.[key]}
            />
          );
        })}
      </div>

      {doneCount > 0 && (
        <div className="px-3 pb-2 flex items-center gap-1.5">
          {allDone && <ShieldCheck className="w-3 h-3 text-green-500" />}
          <span className="text-[10px] text-muted-foreground">
            {allDone ? "All steps verified ✓" : `${doneCount}/${total} steps done`}
          </span>
        </div>
      )}

      {isVerifying && (
        <div className="px-3 pb-2 flex items-center gap-1.5">
          <Search className="w-3 h-3 text-amber-400 animate-pulse" />
          <span className="text-[10px] text-amber-400">Verifier is checking...</span>
        </div>
      )}

      {(() => {
        const inputs: string[] = plan.needs_input || (plan as any).user_confirmation_needed || [];
        return inputs.length > 0 && inputs[0] !== "" ? (
          <div className="px-3 pb-2">
            <div className="flex items-center gap-1 mb-0.5">
              <AlertTriangle className="w-3 h-3 text-yellow-500" />
              <span className="text-[10px] font-medium text-yellow-500">Needs your input:</span>
            </div>
            {inputs.map((item, i) => (
              <p key={i} className="text-[11px] text-foreground/70 pl-4 leading-snug">• {item}</p>
            ))}
          </div>
        ) : null;
      })()}

      {onExecute && !allDone && (
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
              Stop
            </Button>
          ) : hasNeedsInput && onContinue ? (
            <Button
              size="sm"
              className="w-full h-7 text-[11px]"
              onClick={onContinue}
              data-testid="button-continue-execution"
            >
              <Play className="w-3 h-3 mr-1" />
              Continue
            </Button>
          ) : (
            <Button
              size="sm"
              className="w-full h-7 text-[11px]"
              onClick={onExecute}
              data-testid="button-execute-plan"
            >
              <Play className="w-3 h-3 mr-1" />
              Execute Plan
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ManagerMessageBubble({
  message,
  taskStatuses,
  verificationResults,
  onExecute,
  isExecuting,
  onStop,
  onContinue,
}: {
  message: { role: string; content: string; plan?: ManagerPlan };
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "verifying" | "needs-input">;
  verificationResults?: Record<string, VerificationResult>;
  onExecute?: () => void;
  isExecuting?: boolean;
  onStop?: () => void;
  onContinue?: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end px-3">
        <div className="rounded-full px-3.5 py-1.5 text-[13px] leading-relaxed bg-muted text-foreground max-w-[85%]">
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
        verificationResults={verificationResults}
        onExecute={onExecute}
        isExecuting={isExecuting}
        onStop={onStop}
        onContinue={onContinue}
      />
    );
  }

  return (
    <div className="px-3 text-[13px] leading-relaxed text-foreground">
      <p className="text-muted-foreground/70 italic">{message.content}</p>
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
    verificationResults,
    executingTaskIndex,
    setExecutingTaskIndex,
    isManagerResponding,
    setManagerResponding,
    clearManagerPlan,
  } = useIDEStore();
  const { renameProject } = useProjectStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingHandled = useRef(false);
  const projectNameExtracted = useRef(false);
  const executionAbortRef = useRef(false);
  const [autoAppliedMessageIds, setAutoAppliedMessageIds] = useState<Set<string>>(new Set());
  const [appliedBlockIndices, setAppliedBlockIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages, managerMessages]);

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

  const handleManagerSend = useCallback(async (overrideMessage?: string) => {
    const trimmed = overrideMessage?.trim() || input.trim();
    if (!trimmed || isManagerResponding) return;

    addManagerMessage({ role: "user", content: trimmed });
    if (!overrideMessage) setInput("");

    const allFiles = flattenFiles(files);
    const fileContext = allFiles.map((f) => ({
      path: f.path,
      content: f.content || "",
    }));

    const currentMsgs = useIDEStore.getState().managerMessages;
    const messagesForApi = currentMsgs.map((m) => ({
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

      if (data.error && !data.plan) {
        addManagerMessage({ role: "assistant", content: data.raw || data.error });
      } else if (data.plan) {
        clearManagerPlan();
        setManagerPlan(data.plan);
        for (const t of normalizeSteps(data.plan)) {
          updateTaskStatus(String(t.step), "pending");
        }
        addManagerMessage({ role: "assistant", content: "", plan: data.plan });
      }
    } catch (error: any) {
      addManagerMessage({ role: "assistant", content: "Failed to reach the Manager Agent. Please try again." });
    } finally {
      setManagerResponding(false);
    }
  }, [input, isManagerResponding, files, addManagerMessage, setManagerResponding, setManagerPlan, updateTaskStatus]);

  const executeSubTask = useCallback(async (
    description: string,
    title: string,
    managerContext?: { sub_task_id: string; acceptance_criteria: string }
  ): Promise<boolean> => {
    let prompt = description;

    if (managerContext && (managerContext.sub_task_id || managerContext.acceptance_criteria)) {
      const contextLines: string[] = [];
      contextLines.push(`[Manager Mode] You are executing subtask ${managerContext.sub_task_id || title}: ${title}`);
      contextLines.push(`Task description: ${description}`);
      if (managerContext.acceptance_criteria) {
        contextLines.push(`Acceptance criteria: ${managerContext.acceptance_criteria}`);
      }
      contextLines.push("");
      contextLines.push("Please implement the above subtask. Focus only on this specific task and ensure the acceptance criteria are met.");
      prompt = contextLines.join("\n");
    }

    const allFiles = flattenFiles(useIDEStore.getState().files);
    const fileContext = allFiles.map((f) => ({
      path: f.path,
      content: f.content || "",
    }));

    const editorMessages = [{ role: "user" as const, content: prompt }];

    if (managerContext) {
      addChatMessage({ role: "assistant", content: `**Working on:** ${title}` });
    } else {
      addChatMessage({ role: "user", content: prompt });
    }
    addChatMessage({ role: "assistant", content: "" });
    setAiResponding(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: editorMessages, files: fileContext }),
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
                updateLastAssistantMessage(stripProjectNameMarker(accumulated));

                const currentBlocks = extractCodeBlocks(stripProjectNameMarker(accumulated));
                if (currentBlocks.length > appliedBlockCount.current) {
                  for (let bi = appliedBlockCount.current; bi < currentBlocks.length; bi++) {
                    await applyCodeBlock(currentBlocks[bi]);
                    refreshPreview();
                  }
                  appliedBlockCount.current = currentBlocks.length;
                }
              }
            } catch {}
          }
        }
      }

      const finalBlocks = extractCodeBlocks(stripProjectNameMarker(accumulated));
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

  const MAX_RETRIES_PER_STEP = 2;

  const verifySubTask = useCallback(async (
    task: ManagerSubTask,
    editorOutput: string,
  ): Promise<VerificationResult | null> => {
    const allFiles = flattenFiles(useIDEStore.getState().files);
    const fileContext = allFiles.map((f) => ({ path: f.path, content: f.content || "" }));

    try {
      const resp = await fetch("/api/verifier-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sub_task_id: task.sub_task_id || `T001-${String(task.step).padStart(2, "0")}`,
          task_description: task.description,
          acceptance_criteria: task.acceptance_criteria || task.title,
          files: fileContext,
          editor_output: editorOutput,
        }),
      });
      const data = await resp.json();
      if (data.verification) return data.verification as VerificationResult;
      return null;
    } catch {
      return null;
    }
  }, []);

  const requestReplan = useCallback(async (
    task: ManagerSubTask,
    verificationResult: VerificationResult | null,
  ) => {
    const allFiles = flattenFiles(useIDEStore.getState().files);
    const fileContext = allFiles.map((f) => ({ path: f.path, content: f.content || "" }));

    const suggestion = verificationResult?.suggestion || "";
    const errorSummary = verificationResult?.error_summary || "Unknown error";
    const feedbackMsg = `Step ${task.step} ("${task.title}") failed verification.\nError: ${errorSummary}${suggestion ? `\nSuggestion: ${suggestion}` : ""}\nPlease adjust the plan.`;
    addManagerMessage({ role: "user", content: feedbackMsg });

    const currentMsgs = useIDEStore.getState().managerMessages;
    const messagesForApi = currentMsgs.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.plan ? JSON.stringify(m.plan) : m.content,
    }));

    try {
      const resp = await fetch("/api/manager-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesForApi, files: fileContext }),
      });
      const data = await resp.json();
      if (data.plan) {
        clearManagerPlan();
        setManagerPlan(data.plan);
        for (const t of normalizeSteps(data.plan)) {
          updateTaskStatus(String(t.step), "pending");
        }
        addManagerMessage({ role: "assistant", content: "", plan: data.plan });
      }
    } catch {}
  }, [addManagerMessage, setManagerPlan, updateTaskStatus, clearManagerPlan]);

  const handleExecutePlan = useCallback(async () => {
    const plan = useIDEStore.getState().managerPlan;
    if (!plan) return;

    const normalizedSteps = normalizeSteps(plan);
    const updateVerificationResult = useIDEStore.getState().updateVerificationResult;

    executionAbortRef.current = false;

    for (let i = 0; i < normalizedSteps.length; i++) {
      if (executionAbortRef.current) break;

      const task = normalizedSteps[i];
      const key = String(task.step);
      const currentStatus = useIDEStore.getState().taskStatuses[key];
      if (currentStatus === "done") continue;

      let retries = 0;
      let stepPassed = false;

      while (retries <= MAX_RETRIES_PER_STEP && !stepPassed && !executionAbortRef.current) {
        setExecutingTaskIndex(i);
        updateTaskStatus(key, "running");

        const success = await executeSubTask(task.description, task.title, {
          sub_task_id: task.sub_task_id || "",
          acceptance_criteria: task.acceptance_criteria || "",
        });

        if (executionAbortRef.current) {
          updateTaskStatus(key, "pending");
          break;
        }

        if (!success) {
          updateTaskStatus(key, "failed");
          await requestReplan(task, null);
          break;
        }

        updateTaskStatus(key, "verifying");

        const lastAssistant = useIDEStore.getState().chatMessages
          .filter(m => m.role === "assistant")
          .pop();
        const editorOutput = lastAssistant?.content || "";

        const verification = await verifySubTask(task, editorOutput);

        if (executionAbortRef.current) {
          updateTaskStatus(key, "pending");
          break;
        }

        if (verification) {
          updateVerificationResult(task.sub_task_id || key, verification);

          const allPassed = verification.verification_items?.every(
            (item) => item.result === "pass" || item.result === "warning"
          );
          const matchPercent = verification.requirement_match_percent ?? 100;

          if (verification.user_confirmation_needed?.length > 0 &&
              verification.user_confirmation_needed[0] !== "") {
            updateTaskStatus(key, "needs-input");
            addManagerMessage({
              role: "assistant",
              content: `Step ${task.step} needs your input:\n${verification.user_confirmation_needed.map(item => `• ${item}`).join("\n")}`,
            });
            setExecutingTaskIndex(null);
            return;
          }

          if (allPassed && matchPercent >= 70) {
            updateTaskStatus(key, "done");
            stepPassed = true;
          } else {
            retries++;
            if (retries > MAX_RETRIES_PER_STEP) {
              updateTaskStatus(key, "failed");
              await requestReplan(task, verification);
              setExecutingTaskIndex(null);
              return;
            }
            updateTaskStatus(key, "failed");
            const retryMsg = `Retrying step ${task.step} (attempt ${retries + 1}/${MAX_RETRIES_PER_STEP + 1}). Issues: ${verification.error_summary || "Verification checks did not pass."}`;
            addManagerMessage({ role: "assistant", content: retryMsg });
          }
        } else {
          retries++;
          if (retries > MAX_RETRIES_PER_STEP) {
            updateTaskStatus(key, "failed");
            await requestReplan(task, null);
            setExecutingTaskIndex(null);
            return;
          }
          updateTaskStatus(key, "failed");
          addManagerMessage({ role: "assistant", content: `Verifier could not validate step ${task.step}. Retrying (attempt ${retries + 1}/${MAX_RETRIES_PER_STEP + 1})...` });
        }
      }

      if (!stepPassed && !executionAbortRef.current) break;
    }

    const finalStatuses = useIDEStore.getState().taskStatuses;
    const allDone = normalizedSteps.every(t => finalStatuses[String(t.step)] === "done");
    if (allDone) {
      addManagerMessage({ role: "assistant", content: "All steps completed and verified! Your project is ready. 🎉" });
    }

    setExecutingTaskIndex(null);
  }, [executeSubTask, verifySubTask, requestReplan, setExecutingTaskIndex, updateTaskStatus, addManagerMessage, setManagerPlan]);

  const handleStopExecution = useCallback(() => {
    executionAbortRef.current = true;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setAiResponding(false);
    setExecutingTaskIndex(null);
  }, [setAiResponding, setExecutingTaskIndex]);

  const handleContinueExecution = useCallback(() => {
    const plan = useIDEStore.getState().managerPlan;
    if (!plan) return;
    const steps = normalizeSteps(plan);
    for (const t of steps) {
      const key = String(t.step);
      if (useIDEStore.getState().taskStatuses[key] === "needs-input") {
        updateTaskStatus(key, "pending");
      }
    }
    handleExecutePlan();
  }, [handleExecutePlan, updateTaskStatus]);

  const handleSend = useCallback(async (overrideMessage?: string) => {
    const trimmed = overrideMessage?.trim() || input.trim();
    if (!trimmed || isAiResponding) return;

    addChatMessage({ role: "user", content: trimmed });
    if (!overrideMessage) setInput("");

    const allFiles = flattenFiles(files);
    const fileContext = allFiles.map((f) => ({
      path: f.path,
      content: f.content || "",
    }));

    const messagesForApi = [
      ...chatMessages
        .filter((m) => m.id !== "welcome" && m.role !== "checkpoint")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: trimmed },
    ];

    setAiResponding(true);
    addChatMessage({ role: "assistant", content: "" });
    projectNameExtracted.current = false;
    setAppliedBlockIndices(new Set());

    const controller = new AbortController();
    abortRef.current = controller;
    const appliedBlockCount = { current: 0 };
    const appliedIndices = new Set<number>();
    let anyBlockApplied = false;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesForApi, files: fileContext }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        updateLastAssistantMessage(
          `Sorry, something went wrong: ${err.error || "Unknown error"}. Please try again!`
        );
        setAiResponding(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        updateLastAssistantMessage("Sorry, couldn't read the response. Please try again!");
        setAiResponding(false);
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      let streamDone = false;

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

                if (!projectNameExtracted.current) {
                  const nameMatch = accumulated.match(PROJECT_NAME_REGEX);
                  if (nameMatch && projectId) {
                    projectNameExtracted.current = true;
                    renameProject(projectId, nameMatch[1].trim());
                  }
                }

                updateLastAssistantMessage(stripProjectNameMarker(accumulated));

                const currentBlocks = extractCodeBlocks(stripProjectNameMarker(accumulated));
                if (currentBlocks.length > appliedBlockCount.current) {
                  for (let bi = appliedBlockCount.current; bi < currentBlocks.length; bi++) {
                    const block = currentBlocks[bi];
                    anyBlockApplied = true;
                    await applyCodeBlock(block);
                    appliedIndices.add(bi);
                    setAppliedBlockIndices(new Set(appliedIndices));
                    refreshPreview();
                  }
                  appliedBlockCount.current = currentBlocks.length;
                }
              }
              if (parsed.error) {
                accumulated += `\n\nError: ${parsed.error}`;
                updateLastAssistantMessage(stripProjectNameMarker(accumulated));
              }
            } catch {
            }
          }
        }
      }

      if (anyBlockApplied) {
        const currentMessages = useIDEStore.getState().chatMessages;
        const lastAssistantMsg = [...currentMessages].reverse().find((m) => m.role === "assistant");
        if (lastAssistantMsg) {
          setAutoAppliedMessageIds((prev) => new Set(prev).add(lastAssistantMsg.id));
        }

        const checkpointLabel = trimmed.length > 40 ? trimmed.slice(0, 40) + "..." : trimmed;
        createCheckpoint(checkpointLabel);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        updateLastAssistantMessage(
          "Sorry, I had trouble connecting. Please check your connection and try again!"
        );
      }
    } finally {
      setAiResponding(false);
      abortRef.current = null;
    }
  }, [input, isAiResponding, chatMessages, files, addChatMessage, updateLastAssistantMessage, setAiResponding, projectId, renameProject, refreshPreview, createCheckpoint, applyCodeBlock]);

  useEffect(() => {
    pendingHandled.current = false;
  }, [projectId]);

  useEffect(() => {
    if (pendingPrompt && !pendingHandled.current && !isAiResponding) {
      pendingHandled.current = true;
      const prompt = pendingPrompt;
      handleSend(prompt).then(() => {
        clearPendingPrompt();
      });
    }
  }, [pendingPrompt, isAiResponding, clearPendingPrompt, handleSend]);

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

  const handleCurrentSend = useCallback(() => {
    if (chatMode === "manager") {
      handleManagerSend();
    } else {
      handleSend();
    }
  }, [chatMode, handleManagerSend, handleSend]);

  const handleCurrentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleCurrentSend();
    }
  };

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
                  verificationResults={verificationResults}
                  onExecute={isLastPlan ? handleExecutePlan : undefined}
                  isExecuting={isLastPlan ? isExecuting : undefined}
                  onStop={isLastPlan ? handleStopExecution : undefined}
                  onContinue={isLastPlan ? handleContinueExecution : undefined}
                />
              );
            }
          });
        })()}
        {isAiResponding && chatMessages[chatMessages.length - 1]?.content === "" && (
          <TypingIndicator />
        )}
        {isManagerResponding && (
          <TypingIndicator text="Planning..." />
        )}
      </div>
      <div className="p-2.5 border-t border-border/50 shrink-0 text-[13px]">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleCurrentKeyDown}
            placeholder={chatMode === "manager" ? "Describe your project requirements..." : "Describe what you want to build..."}
            className="resize-none text-[13px] min-h-[36px] max-h-[100px] bg-muted/30 border-border/30"
            rows={1}
            data-testid="input-chat"
          />
          {isBusy ? (
            <Button
              size="icon"
              variant="destructive"
              className="h-9 w-9 shrink-0"
              onClick={handleStop}
              data-testid="button-stop-chat"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={handleCurrentSend}
              disabled={!input.trim()}
              data-testid="button-send-chat"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center mt-1.5">
          <div className="relative" ref={modeDropdownRef}>
            <button
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-[13px] font-medium"
              onClick={() => setModeDropdownOpen((v) => !v)}
              data-testid="dropdown-chat-mode"
            >
              {chatMode === "build" ? (
                <Zap className="w-3 h-3" />
              ) : (
                <ClipboardList className="w-3 h-3" />
              )}
              <span>{chatMode === "build" ? "Build" : "Manager"}</span>
              {modeDropdownOpen ? (
                <ChevronUp className="w-2.5 h-2.5" />
              ) : (
                <ChevronDown className="w-2.5 h-2.5" />
              )}
            </button>
            {modeDropdownOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-36 rounded-md border border-border bg-popover shadow-md py-1 z-50">
                <button
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors text-left",
                    chatMode === "build" ? "text-primary bg-primary/5" : "text-foreground hover:bg-muted/50"
                  )}
                  onClick={() => { setChatMode("build"); setModeDropdownOpen(false); }}
                  data-testid="option-build-mode"
                >
                  <Zap className="w-3 h-3" />
                  <div>
                    <div className="font-medium">Build</div>
                    <div className="text-[9px] text-muted-foreground">Code directly</div>
                  </div>
                  {chatMode === "build" && <Check className="w-3 h-3 ml-auto" />}
                </button>
                <button
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors text-left",
                    chatMode === "manager" ? "text-primary bg-primary/5" : "text-foreground hover:bg-muted/50"
                  )}
                  onClick={() => { setChatMode("manager"); setModeDropdownOpen(false); }}
                  data-testid="option-manager-mode"
                >
                  <ClipboardList className="w-3 h-3" />
                  <div>
                    <div className="font-medium">Manager</div>
                    <div className="text-[9px] text-muted-foreground">Plan & execute</div>
                  </div>
                  {chatMode === "manager" && <Check className="w-3 h-3 ml-auto" />}
                </button>
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/40 ml-auto">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
