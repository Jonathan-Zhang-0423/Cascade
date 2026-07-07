import { useLanguageStore } from "@/stores/language-store";
import { tr } from "@/lib/i18n";
import type { ManagerSubTask, ManagerPlan } from "@/stores/ide-store";
import type { ManagerStepPayload } from "./chat-types";
import {
  type ActionLogEntry,
  type PlanCardLang,
  type ParsedCompletion,
  type CodeBlock,
  type ManagerPlanPayload,
  type NormalizedStep,
  planCardStrings,
  PROJECT_NAME_REGEX_GLOBAL,
  PLAIN_FENCE_RE,
  SUMMARY_HEADERS,
} from "./chat-types";

// Syntax-highlight tokenizer extracted to its own module (single
// responsibility). Re-exported here so existing importers keep working.
export { escapeHtml, findTagEnd, tokenizeLine } from "./syntax-highlight";

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

/**
 * Build the message history sent to the manager agent, compressing any
 * completed build round into a compact summary so the planner focuses on the
 * NEW request while still preserving what the previous round implemented.
 *
 * A "completed round" = everything up to and including the most recent message
 * carrying a `buildResult`. Messages after it (the user's new request) are kept
 * verbatim. Pure function — unit-tested in chat-utils.test.ts.
 */
export function buildManagerHistory(
  messages: Array<{ role: string; content: string; buildResult?: unknown; typing?: boolean }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  // Detect the completed-round boundary on the RAW list FIRST. The buildResult
  // marker message carries empty content, so filtering by `content` before this
  // step would drop it and silently skip compression — that was the original
  // bug where the previous round's plan leaked into the next request.
  const lastBuildIdx = messages.reduce((acc, m, i) => (m.buildResult ? i : acc), -1);

  const keep = (m: { role: string; content: string; typing?: boolean }) =>
    (m.role === "user" || m.role === "assistant") && !!m.content && !m.typing;

  if (lastBuildIdx < 0) {
    return messages.filter(keep).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }

  const afterBuild = messages.slice(lastBuildIdx + 1).filter(keep);
  const previousUserMsgs = messages.slice(0, lastBuildIdx + 1).filter((m) => m.role === "user" && !!m.content);
  const lastPrevUserMsg = previousUserMsgs[previousUserMsgs.length - 1];
  const roundSummary = summarizeCompletedRound(messages[lastBuildIdx]?.buildResult, lastPrevUserMsg?.content);

  return [
    { role: "assistant", content: roundSummary },
    ...afterBuild.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter(Boolean)
    : [];
}

function truncateForHistory(value: string, limit: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

function summarizeCompletedRound(buildResult: unknown, previousUserRequest?: string): string {
  const br = (buildResult && typeof buildResult === "object") ? buildResult as Record<string, unknown> : {};
  const completionData = (br.completionData && typeof br.completionData === "object")
    ? br.completionData as Record<string, unknown>
    : {};
  const changedFiles = [
    ...asStringArray(completionData.changedFiles),
    ...asStringArray(br.changedFiles),
  ].filter((file, index, all) => all.indexOf(file) === index);
  const summary = asString(completionData.summary) || asString(br.summary);
  const segments = Array.isArray(br.segments) ? br.segments as Array<Record<string, unknown>> : [];
  const stepSummaries = segments
    .map((seg) => asString(seg.narration) || asString(seg.stepLabel))
    .filter(Boolean)
    .slice(0, 5);
  const actionLog = Array.isArray(br.actionLog) ? br.actionLog as Array<Record<string, unknown>> : [];
  const touchedFiles = actionLog
    .map((entry) => asString(entry.filePath) || asString(entry.label))
    .filter((label) => label.includes("/") || /\.[a-z0-9]+$/i.test(label))
    .filter((file, index, all) => all.indexOf(file) === index)
    .slice(0, 8);
  const files = changedFiles.length > 0 ? changedFiles : touchedFiles;

  const parts = ["[Previous round completed]"];
  if (previousUserRequest) {
    parts.push(`User requested: "${truncateForHistory(previousUserRequest, 240)}".`);
  } else {
    parts.push("A build was executed successfully.");
  }
  if (summary) {
    parts.push(`Build summary: ${truncateForHistory(summary, 400)}.`);
  } else {
    parts.push("The build was executed successfully.");
  }
  if (files.length > 0) {
    parts.push(`Changed/touched files: ${files.slice(0, 8).join(", ")}.`);
  }
  if (stepSummaries.length > 0) {
    parts.push(`Implemented steps: ${stepSummaries.map((s) => truncateForHistory(s, 160)).join(" | ")}.`);
  }
  parts.push("Preservation constraint: treat the completed work, changed files, and existing user-facing behavior as part of the current project. Future plans must build on top of them and must not delete, rewrite, or regress prior features unless the user explicitly asks.");
  parts.push("Follow-up discipline: for the next request, plan an incremental delta, name the files likely to be touched, inspect current implementations before editing, and avoid full-file rewrites when a targeted patch can preserve existing behavior.");
  parts.push("Now the user has a new request — focus on it while preserving the existing project.");
  return parts.join(" ");
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

function renderInlineMarkdown(line: string): React.ReactNode[] {
  const tokens: Array<{ type: "text" | "bold" | "italic" | "code"; content: string }> = [];
  let i = 0;
  let current = "";

  while (i < line.length) {
    if (line[i] === "`" && line[i + 1] !== "`") {
      if (current) tokens.push({ type: "text", content: current });
      current = "";
      let j = i + 1;
      while (j < line.length && line[j] !== "`") {
        current += line[j];
        j++;
      }
      if (j < line.length) {
        tokens.push({ type: "code", content: current });
        current = "";
        i = j + 1;
      } else {
        current = "`" + current;
        i++;
      }
      continue;
    }

    if (line[i] === "*" && line[i + 1] === "*" && line[i + 2] !== "*") {
      if (current) tokens.push({ type: "text", content: current });
      current = "";
      let j = i + 2;
      while (j < line.length - 1) {
        if (line[j] === "*" && line[j + 1] === "*") {
          tokens.push({ type: "bold", content: current });
          current = "";
          i = j + 2;
          break;
        }
        current += line[j];
        j++;
      }
      if (j >= line.length - 1 && current) {
        tokens.push({ type: "text", content: "**" + current });
        current = "";
        i = line.length;
      }
      continue;
    }

    if ((line[i] === "*" || line[i] === "_") && line[i + 1] !== "*" && line[i + 1] !== "_") {
      const marker = line[i];
      if (current) tokens.push({ type: "text", content: current });
      current = "";
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === marker) {
          tokens.push({ type: "italic", content: current });
          current = "";
          i = j + 1;
          break;
        }
        current += line[j];
        j++;
      }
      if (j >= line.length && current) {
        tokens.push({ type: "text", content: marker + current });
        current = "";
        i = line.length;
      }
      continue;
    }

    current += line[i];
    i++;
  }

  if (current) tokens.push({ type: "text", content: current });

  return tokens.map((token, idx) => {
    switch (token.type) {
      case "bold":
        return (
          <strong key={idx} className="font-semibold text-foreground">
            {token.content}
          </strong>
        );
      case "italic":
        return (
          <em key={idx} className="italic text-foreground/80">
            {token.content}
          </em>
        );
      case "code":
        return (
          <code key={idx} className="font-mono text-[11px] bg-border/20 px-1 py-0.5 rounded text-[#a8c4ff]">
            {token.content}
          </code>
        );
      default:
        return <span key={idx}>{token.content}</span>;
    }
  });
}

export function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      elements.push(<hr key={`hr-${i}`} className="border-border/20 my-2" />);
      i++;
      continue;
    }

    const h1Match = trimmed.match(/^# +(.+)$/);
    if (h1Match) {
      elements.push(
        <h1 key={`h1-${i}`} className="text-[14px] font-semibold text-inherit mt-3 mb-1">
          {renderInlineMarkdown(h1Match[1])}
        </h1>
      );
      i++;
      continue;
    }

    const h2Match = trimmed.match(/^## +(.+)$/);
    if (h2Match) {
      elements.push(
        <h2 key={`h2-${i}`} className="text-[13px] font-semibold text-inherit/90 mt-2.5 mb-0.5">
          {renderInlineMarkdown(h2Match[1])}
        </h2>
      );
      i++;
      continue;
    }

    const h3Match = trimmed.match(/^### +(.+)$/);
    if (h3Match) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-[12px] font-medium text-inherit/75 uppercase tracking-wide mt-2 mb-0.5">
          {renderInlineMarkdown(h3Match[1])}
        </h3>
      );
      i++;
      continue;
    }

    if (trimmed.match(/^[-*] +/)) {
      const ulItems: string[] = [];
      while (i < lines.length && lines[i].trim().match(/^[-*] +/)) {
        ulItems.push(lines[i].trim().slice(2));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="ml-4 list-disc text-[13px] leading-[1.6] mb-1">
          {ulItems.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    const olMatch = trimmed.match(/^\d+\. +/);
    if (olMatch) {
      const olItems: string[] = [];
      while (i < lines.length && lines[i].trim().match(/^\d+\. +/)) {
        olItems.push(lines[i].trim().replace(/^\d+\. +/, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="ml-4 list-decimal text-[13px] leading-[1.6] mb-1">
          {olItems.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    elements.push(
      <p key={`p-${i}`} className="text-[13px] leading-[1.65] text-inherit mb-1">
        {renderInlineMarkdown(trimmed)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0">{elements}</div>;
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
    case "file_delete":
      return "text-red-400";
    case "tool_call":
      return "text-purple-400";
    case "research":
      return "text-cyan-400";
    case "step":
      return "text-primary";
    case "narration":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}
