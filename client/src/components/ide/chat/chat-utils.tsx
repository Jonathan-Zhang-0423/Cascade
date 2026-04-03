import { useLanguageStore } from "@/stores/language-store";
import { tr } from "@/lib/i18n";
import type { ManagerSubTask, ManagerPlan } from "@/stores/ide-store";
import type { ManagerStepPayload } from "./chat-types";
import {
  type ActionLogEntry,
  type PlanCardLang,
  type ParsedCompletion,
  type CodeBlock,
  type Token,
  type ManagerPlanPayload,
  type NormalizedStep,
  planCardStrings,
  PROJECT_NAME_REGEX_GLOBAL,
  PLAIN_FENCE_RE,
  SUMMARY_HEADERS,
} from "./chat-types";

export function detectLanguage(text: string): string {
  const chineseRe = /[\u4e00-\u9fff]/;
  return chineseRe.test(text) ? "Chinese" : "English";
}

export function t(
  lang: PlanCardLang,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let str = planCardStrings[lang]?.[key] || planCardStrings.English[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, String(v));
    }
  }
  return str;
}

export function usePlanCardLang(): PlanCardLang {
  const { lang } = useLanguageStore();
  return lang === "zh" ? "Chinese" : "English";
}

export function normalizeSteps(plan: ManagerPlan | ManagerPlanPayload | null | undefined): NormalizedStep[] {
  if (!plan) return [];
  const raw = plan.steps ?? ("sub_tasks" in plan ? plan.sub_tasks : undefined);
  if (!Array.isArray(raw)) return [];
  return raw.map((t: ManagerSubTask | ManagerStepPayload, i: number) => {
    return {
      step: t.step ?? i + 1,
      sub_task_id: t.sub_task_id ?? "",
      title: t.title ?? ((t.description ?? "").slice(0, 50) || `Step ${i + 1}`),
      description: t.description ?? "",
      acceptance_criteria: t.acceptance_criteria ?? "",
      required_files: Array.isArray(t.required_files) ? t.required_files : [],
    };
  });
}

export function stripProjectNameMarker(text: string): string {
  return text.replace(PROJECT_NAME_REGEX_GLOBAL, "").trim();
}

function stripPlainFences(text: string): string {
  return text.replace(PLAIN_FENCE_RE, "").trim();
}

export function parseCodeBlocks(content: string): Array<string | CodeBlock> {
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

export function extractCodeBlocks(content: string): CodeBlock[] {
  return parseCodeBlocks(content).filter(
    (part): part is CodeBlock => typeof part !== "string",
  );
}

export function parseCompletionSummary(raw: string): ParsedCompletion | null {
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

export function formatRelativeTime(timestamp: number): string {
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

export function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function findTagEnd(code: string, start: number): number {
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

export function tokenizeLine(
  code: string,
  lang: "html" | "css" | "js" | "text",
): Token[] {
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

    if (
      (lang === "js" || lang === "css") &&
      code[i] === "/" &&
      code[i + 1] === "*"
    ) {
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

    if (
      (lang === "js" || lang === "css") &&
      code[i] === "/" &&
      code[i + 1] === "/"
    ) {
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
        while (nameEnd < inner.length && /[a-zA-Z0-9_:-]/.test(inner[nameEnd]))
          nameEnd++;
        if (nameEnd > k) {
          tokens.push({ type: "tag", text: inner.slice(k, nameEnd) });
        }
        k = nameEnd;

        while (k < inner.length) {
          if (inner[k] === " " || inner[k] === "\t" || inner[k] === "\n") {
            let ws = k;
            while (
              ws < inner.length &&
              (inner[ws] === " " || inner[ws] === "\t" || inner[ws] === "\n")
            )
              ws++;
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
        "function",
        "const",
        "let",
        "var",
        "if",
        "else",
        "return",
        "class",
        "import",
        "export",
        "async",
        "await",
        "true",
        "false",
        "null",
        "undefined",
        "new",
        "this",
        "super",
        "for",
        "while",
        "do",
        "switch",
        "case",
        "break",
        "continue",
        "default",
        "try",
        "catch",
        "finally",
        "throw",
        "typeof",
        "instanceof",
        "in",
        "of",
        "from",
        "extends",
        "yield",
        "void",
        "delete",
        "debugger",
        "with",
      ]);
      tokens.push({
        type: keywords.has(word) ? "keyword" : "plain",
        text: word,
      });
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
      const hasOpenBrace =
        lineBeforeWord.includes("{") ||
        lineBeforeWord.trimStart().match(/^[a-z-]+\s*:/);
      if (
        code[afterWord] === ":" &&
        code[afterWord + 1] !== ":" &&
        hasOpenBrace
      ) {
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

export function findSummaryHeader(
  text: string,
): { index: number; length: number } | null {
  for (const header of SUMMARY_HEADERS) {
    const pattern = new RegExp(
      `(^|\\n)${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "m",
    );
    const match = pattern.exec(text);
    if (match) {
      const offset = match[0].startsWith("\n") ? 1 : 0;
      return { index: match.index + offset, length: header.length };
    }
  }
  return null;
}

export function renderBoldMarkdown(str: string) {
  const lines = str.split("\n");
  return lines.map((line, lineIdx) => {
    const parts: Array<{ text: string; bold: boolean }> = [];
    const boldRegex = /\*\*(.+?)\*\*/g;
    let last = 0;
    let m;
    while ((m = boldRegex.exec(line)) !== null) {
      if (m.index > last)
        parts.push({ text: line.slice(last, m.index), bold: false });
      parts.push({ text: m[1], bold: true });
      last = boldRegex.lastIndex;
    }
    if (last < line.length) parts.push({ text: line.slice(last), bold: false });
    if (parts.length === 0) parts.push({ text: "", bold: false });

    return (
      <div key={lineIdx}>
        {parts.map((p, i) =>
          p.bold ? (
            <strong key={i} className="font-semibold text-foreground">
              {p.text}
            </strong>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </div>
    );
  });
}

export function splitSummaryBody(text: string): { body: string; trailing: string } {
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

export function getActionLogColor(type: ActionLogEntry["type"]): string {
  switch (type) {
    case "thinking":
      return "text-blue-400";
    case "file_write":
      return "text-green-400";
    case "file_read":
      return "text-amber-400";
    case "tool_call":
      return "text-purple-400";
    case "step":
      return "text-primary";
    case "narration":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

export function generateCodestart(params: {
  plan: ManagerPlan | ManagerPlanPayload;
  userPrompt: string;
  currentFiles: { path: string; content: string }[];
}): void {
  fetch("/api/generate-codestart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan: params.plan,
      userPrompt: params.userPrompt,
      projectName: undefined,
      currentFiles: params.currentFiles,
    }),
  })
    .then(async (r) => {
      if (!r.ok) return;
      const d = await r.json();
      if (d.content) {
        const { useIDEStore } = await import("@/stores/ide-store");
        useIDEStore
          .getState()
          .updateFileContent("/project/codestart.md", d.content);
      }
    })
    .catch(() => {});
}
