import { useState } from "react";
import {
  useIDEStore,
  type ChatMessage,
} from "@/stores/ide-store";
import { useT } from "@/lib/i18n";
import {
  Check,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CodeBlock } from "./chat-types";
import { THEME_COLORS } from "./chat-types";
import {
  parseCodeBlocks,
  escapeHtml,
  tokenizeLine,
  formatRelativeTime,
  findSummaryHeader,
  renderBoldMarkdown,
  renderMarkdown,
  splitSummaryBody,
  t,
  usePlanCardLang,
} from "./chat-utils";

export function CodeBlockView({
  block,
  applied,
}: {
  block: CodeBlock;
  autoApplied?: boolean;
  applied?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const { openFile, theme } = useIDEStore();
  const tGlobalRef = useT();
  const fileName = block.filePath.split("/").pop() || block.filePath;
  const lineCount = block.code.split("\n").length;
  const MAX_VISIBLE_LINES = 8;

  const colors = THEME_COLORS[theme as keyof typeof THEME_COLORS] || THEME_COLORS["vs-dark"];

  const detectLang = (): "html" | "css" | "js" | "text" => {
    const lang = block.language.toLowerCase();
    if (lang === "html" || fileName.endsWith(".html")) return "html";
    if (lang === "css" || fileName.endsWith(".css")) return "css";
    if (
      lang === "javascript" ||
      lang === "js" ||
      lang === "jsx" ||
      lang === "ts" ||
      lang === "tsx" ||
      fileName.endsWith(".js") ||
      fileName.endsWith(".jsx") ||
      fileName.endsWith(".ts") ||
      fileName.endsWith(".tsx")
    )
      return "js";
    return "text";
  };

  const lang = detectLang();

  const highlightLine = (line: string): string => {
    if (lang === "text") return escapeHtml(line);
    const tokens = tokenizeLine(line, lang);
    return tokens
      .map((tk) => {
        const escaped = escapeHtml(tk.text);
        const colorMap: Record<string, string> = {
          keyword: colors.keyword,
          string: colors.string,
          comment: colors.comment,
          tag: colors.tag,
          property: colors.property,
          number: colors.number,
          attr: colors.attr,
        };
        const c = colorMap[tk.type];
        if (c) return `<span style="color:${c}">${escaped}</span>`;
        return escaped;
      })
      .join("");
  };

  const lines = block.code.split("\n");
  const showAll = !collapsed || lineCount <= MAX_VISIBLE_LINES;
  const visibleLines = showAll ? lines : lines.slice(0, MAX_VISIBLE_LINES);

  // Note: highlightLine uses escapeHtml on all content before wrapping in spans,
  // so the innerHTML is safe from XSS — only pre-escaped content with color spans.
  const renderHighlightedLine = (line: string) => {
    return { __html: highlightLine(line) };
  };

  return (
    <div
      className="my-1.5 overflow-hidden"
      data-testid={`code-block-${block.filePath}`}
    >
      {/* File header line */}
      <div
        className="flex items-center gap-2 font-mono text-[10px] text-[rgba(238,238,246,0.3)] group/code-header cursor-pointer select-none hover:text-[rgba(238,238,246,0.5)] transition-colors"
        onClick={() => setCollapsed((c) => !c)}
        data-testid={`toggle-code-${block.filePath}`}
      >
        <span className="shrink-0">──</span>
        <span className="truncate">{fileName}</span>
        <span className="text-[rgba(238,238,246,0.15)]">{lineCount}L</span>
        {applied && (
          <span className="text-[#34d68a]/60 flex items-center gap-0.5">
            <Check className="w-2.5 h-2.5" />
            {tGlobalRef("chat.applied")}
          </span>
        )}
        <span className="flex-1 border-b border-border/60" />
        <button
          className="opacity-0 group-hover/code-header:opacity-100 text-muted-foreground/70 hover:text-[#4f82ff] transition-all"
          onClick={(e) => { e.stopPropagation(); openFile(block.filePath); }}
          data-testid={`button-open-${block.filePath}`}
        >
          <ExternalLink className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* Code content */}
      <div
        className="overflow-x-auto font-mono text-[11px] leading-[1.6] max-h-[200px] overflow-y-auto mt-0.5"
        style={{ backgroundColor: "transparent", color: colors.foreground }}
      >
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <tbody>
            {visibleLines.map((line, idx) => (
              <tr key={idx} style={{ height: "18px" }}>
                <td
                  className="select-none text-right"
                  style={{
                    padding: "0 6px",
                    color: "rgba(238,238,246,0.15)",
                    width: "32px",
                    minWidth: "32px",
                    userSelect: "none",
                    fontSize: "10px",
                  }}
                >
                  {idx + 1}
                </td>
                <td style={{ padding: "0 8px", whiteSpace: "pre" }}>
                  <code dangerouslySetInnerHTML={renderHighlightedLine(line)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Show more link */}
      {!showAll && (
        <button
          className="font-mono text-[10px] text-[#4f82ff]/60 hover:text-[#4f82ff] transition-colors mt-0.5 pl-[40px]"
          onClick={() => setCollapsed(false)}
        >
          {tGlobalRef("chat.showMore", { n: String(lineCount - MAX_VISIBLE_LINES) })}
        </button>
      )}
    </div>
  );
}

function TextWithSummary({ text }: { text: string }) {
  const match = findSummaryHeader(text);

  if (!match) {
    return <div className="text-[13px] leading-[1.6] text-[rgba(238,238,246,0.8)]">{renderMarkdown(text)}</div>;
  }

  const before = text.slice(0, match.index);
  const headerText = text.slice(match.index, match.index + match.length);
  const after = text.slice(match.index + match.length);
  const { body, trailing } = splitSummaryBody(after);

  return (
    <div>
      {before.trim().length > 0 && (
        <div className="text-[13px] leading-[1.6] text-[rgba(238,238,246,0.8)] mb-1">{renderMarkdown(before)}</div>
      )}
      <div className="mt-1 rounded-md border border-[rgba(52,214,138,0.1)] bg-[rgba(52,214,138,0.02)] px-3 py-2">
        <div className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-[#34d68a]/70 mb-1">
          <Check className="w-3 h-3" />
          {headerText}
        </div>
        <div className="text-[12px] leading-relaxed text-muted-foreground">
          {renderBoldMarkdown(body)}
        </div>
      </div>
      {trailing.trim().length > 0 && (
        <div className="text-[13px] leading-[1.6] text-[rgba(238,238,246,0.8)] mt-1">{renderMarkdown(trailing)}</div>
      )}
    </div>
  );
}

export function MessageContent({
  content,
  autoApplied,
  appliedBlockIndices,
}: {
  content: string;
  autoApplied?: boolean;
  appliedBlockIndices?: Set<number>;
}) {
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

const TRUNCATE_LINES = 15;
const TRUNCATE_CHARS = 600;

function TruncatedText({ content, testId }: { content: string; testId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();

  const lines = content.split("\n");
  const needsTruncation =
    lines.length > TRUNCATE_LINES || content.length > TRUNCATE_CHARS;

  if (!needsTruncation || expanded) {
    return (
      <div>
        <MessageContent content={content} />
        {needsTruncation && (
          <button
            className="font-mono text-[10px] text-[#4f82ff]/60 hover:text-[#4f82ff] transition-colors mt-1"
            onClick={() => setExpanded(false)}
            data-testid={testId ? `button-show-less-${testId}` : "button-show-less"}
          >
            {t("chat.showLess")}
          </button>
        )}
      </div>
    );
  }

  const truncatedLines = lines.slice(0, TRUNCATE_LINES);
  let truncated = truncatedLines.join("\n");
  if (truncated.length > TRUNCATE_CHARS) {
    truncated = truncated.slice(0, TRUNCATE_CHARS);
  }

  return (
    <div className="relative">
      <div className="overflow-hidden">
        <MessageContent content={truncated + "…"} />
      </div>
      <button
        className="font-mono text-[10px] text-[#4f82ff]/60 hover:text-[#4f82ff] transition-colors mt-1"
        onClick={() => setExpanded(true)}
        data-testid={testId ? `button-show-more-${testId}` : "button-show-more"}
      >
        {t("chat.showMoreBtn")}
      </button>
    </div>
  );
}

export function MessageBubble({
  message,
  autoApplied,
  appliedBlockIndices,
}: {
  message: ChatMessage;
  autoApplied?: boolean;
  appliedBlockIndices?: Set<number>;
}) {
  const isAssistant = message.role === "assistant";

  if (isAssistant) {
    const hasCodeBlocks = message.content.includes('```');
    return (
      <div
        className="my-0.5 px-3.5 font-mono text-[12px] leading-[1.6] text-[rgba(238,238,246,0.7)]"
        data-testid={`chat-message-${message.id}`}
      >
        {hasCodeBlocks ? (
          <MessageContent
            content={message.content}
            autoApplied={autoApplied}
            appliedBlockIndices={appliedBlockIndices}
          />
        ) : (
          <TruncatedText content={message.content} testId={message.id} />
        )}
      </div>
    );
  }

  return (
    <div
      className="flex justify-end px-3"
      data-testid={`chat-message-${message.id}`}
    >
      <div className="rounded-md px-3 py-1.5 text-[13px] leading-relaxed max-w-[80%] bg-[#E8E8E6] text-[#1A1A1A] dark:bg-[hsl(220,15%,22%)] dark:text-[hsl(210,20%,88%)]">
        <MessageContent content={message.content} />
      </div>
    </div>
  );
}

export function CheckpointMarker({ message }: { message: ChatMessage }) {
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
      className="flex items-center gap-2 mx-3 my-2 font-mono"
      data-testid={`checkpoint-${message.checkpointId}`}
    >
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.04)]" />
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[9px] text-muted-foreground/40">
          {message.content} · {formatRelativeTime(message.timestamp)}
        </span>
        {isAvailable && (
          <button
            onClick={handleRestore}
            title={tCp("chat.restore")}
            className={cn(
              "inline-flex items-center gap-0.5 text-[9px] transition-colors",
              restored
                ? "text-[#34d68a]/60"
                : "text-muted-foreground/40 hover:text-[#4f82ff]/60",
            )}
            data-testid={`button-restore-${message.checkpointId}`}
          >
            {restored ? (
              <Check className="w-2.5 h-2.5" />
            ) : (
              <RotateCcw className="w-2.5 h-2.5" />
            )}
            {restored ? tCp("chat.restored") : tCp("chat.restore")}
          </button>
        )}
      </div>
      <div className="flex-1 h-px bg-[rgba(255,255,255,0.04)]" />
    </div>
  );
}

export function TypingIndicator({ text }: { text?: string }) {
  const lang = usePlanCardLang();
  return (
    <div
      className="px-3.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/60"
      data-testid="typing-indicator"
    >
      <span className="animate-pulse">⠋</span>
      <span>{text || t(lang, "thinking")}</span>
    </div>
  );
}
