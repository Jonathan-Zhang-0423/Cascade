import { useState } from "react";
import {
  useIDEStore,
  type ChatMessage,
} from "@/stores/ide-store";
import { useT } from "@/lib/i18n";
import {
  ChevronRight,
  ChevronDown,
  FileCode,
  Check,
  ExternalLink,
  History,
  RotateCcw,
} from "lucide-react";
import { CascadeLoader } from "./CascadeLoader";
import { cn } from "@/lib/utils";
import type { CodeBlock } from "./chat-types";
import { THEME_COLORS } from "./chat-types";
import {
  parseCodeBlocks,
  parseCompletionSummary,
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
      .map((t) => {
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
      })
      .join("");
  };

  return (
    <div
      className="w-full my-1 rounded-lg border border-border/50 overflow-hidden"
      data-testid={`code-block-${block.filePath}`}
    >
      <div
        className="flex items-center gap-2 px-3.5 py-2.5 bg-gradient-to-r from-[rgba(255,255,255,0.05)] to-[rgba(255,255,255,0.02)] cursor-pointer select-none hover:from-[rgba(255,255,255,0.08)] hover:to-[rgba(255,255,255,0.04)] transition-all text-[11px] text-[#8888a8] font-medium"
        onClick={() => setCollapsed((c) => !c)}
        data-testid={`toggle-code-${block.filePath}`}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {collapsed ? (
            <ChevronRight className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 shrink-0" />
          )}
          <FileCode className="w-3 h-3 shrink-0" />
          <span className="truncate text-foreground/80">{fileName}</span>
          <span className="shrink-0 text-[#484860]">
            {lineCount}L
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {applied && (
            <span
              className="inline-flex items-center gap-0.5 text-green-500/80 text-[10px] font-medium"
              data-testid={`applied-${block.filePath}`}
            >
              <Check className="w-3 h-3" />
              {tGlobalRef("chat.applied")}
            </span>
          )}
          <button
            className="inline-flex items-center gap-1 text-primary/70 hover:text-primary hover:bg-primary/10 px-2 py-1 rounded transition-all text-[10px] font-medium"
            onClick={(e) => {
              e.stopPropagation();
              openFile(block.filePath);
            }}
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
                    <code
                      dangerouslySetInnerHTML={{ __html: highlightLine(line) }}
                    />
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

function TextWithSummary({ text }: { text: string }) {
  const match = findSummaryHeader(text);

  if (!match) {
    return <div className="text-[13px] leading-[1.65] text-foreground/90">{renderMarkdown(text)}</div>;
  }

  const before = text.slice(0, match.index);
  const headerText = text.slice(match.index, match.index + match.length);
  const after = text.slice(match.index + match.length);
  const { body, trailing } = splitSummaryBody(after);

  return (
    <div>
      {before.trim().length > 0 && (
        <div className="text-[13px] leading-[1.65] text-foreground/90 mb-1">{renderMarkdown(before)}</div>
      )}
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
      {trailing.trim().length > 0 && (
        <div className="text-[13px] leading-[1.65] text-foreground/90 mt-1">{renderMarkdown(trailing)}</div>
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

  const lines = content.split("\n");
  const needsTruncation =
    lines.length > TRUNCATE_LINES || content.length > TRUNCATE_CHARS;

  if (!needsTruncation || expanded) {
    return (
      <div>
        <MessageContent content={content} />
        {needsTruncation && (
          <button
            className="text-[11px] text-primary/70 hover:text-primary transition-colors mt-1"
            onClick={() => setExpanded(false)}
            data-testid={testId ? `button-show-less-${testId}` : "button-show-less"}
          >
            Show less
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
        className="text-[11px] text-primary/70 hover:text-primary transition-colors mt-1"
        onClick={() => setExpanded(true)}
        data-testid={testId ? `button-show-more-${testId}` : "button-show-more"}
      >
        Show more
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
        className="px-3 text-[13px] leading-[1.65] text-foreground"
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
      <div className="rounded-lg px-3.5 py-1.5 text-[13px] leading-relaxed bg-[#1a1a2e] text-foreground max-w-[85%]">
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
      className="mx-2 my-1 px-3 py-2 rounded-lg border-l-4 border-l-[#4f82ff] bg-[rgba(79,130,255,0.02)] border border-[rgba(79,130,255,0.1)]"
      data-testid={`checkpoint-${message.checkpointId}`}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <History className="w-3.5 h-3.5 shrink-0 text-[#8888a8]" />
          <span className="text-[12px] font-medium text-foreground/80 truncate">
            {message.content}
          </span>
        </div>
        <span className="text-[10px] text-[#8888a8]/60 shrink-0">
          {formatRelativeTime(message.timestamp)}
        </span>
      </div>
      {isAvailable && (
        <button
          onClick={handleRestore}
          title={tCp("chat.restore")}
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-all text-[11px] font-medium",
            restored
              ? "bg-green-500/15 text-green-500 border border-green-500/30"
              : "bg-[rgba(79,130,255,0.12)] text-[#4f82ff] border border-[#4f82ff]/40 hover:bg-[rgba(79,130,255,0.18)] hover:border-[#4f82ff]/60",
          )}
          data-testid={`button-restore-${message.checkpointId}`}
        >
          {restored ? (
            <>
              <Check className="w-3.5 h-3.5" />
              {tCp("chat.restored")}
            </>
          ) : (
            <>
              <RotateCcw className="w-3.5 h-3.5" />
              {tCp("chat.restore")}
            </>
          )}
        </button>
      )}
    </div>
  );
}

export function TypingIndicator({ text }: { text?: string }) {
  const lang = usePlanCardLang();
  return (
    <div
      className="px-3 flex items-center gap-1.5"
      data-testid="typing-indicator"
    >
      <CascadeLoader className="text-[#8888a8]" />
      <span className="text-xs text-[#8888a8]">
        {text || t(lang, "thinking")}
      </span>
    </div>
  );
}

export function BuildCompletionCard({
  changedFiles,
  summary,
  userLang,
  headline: _headline,
}: {
  changedFiles: string[];
  summary?: string;
  userLang?: string;
  headline?: string;
}) {
  const parsed = summary ? parseCompletionSummary(summary) : null;

  return (
    <div
      className="mx-3 mt-2 mb-1 rounded-lg border border-[rgba(52,214,138,0.25)] bg-[#051410] overflow-hidden shadow-lg"
      style={{ animation: "fade-up 150ms ease" }}
      data-testid="build-completion-card"
    >
      <div className="px-3 py-3 border-b border-[rgba(52,214,138,0.08)]">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0"
            style={{
              background: "#1a6640",
              border: "1px solid rgba(52,214,138,0.35)",
              boxShadow: "0 0 16px rgba(52,214,138,0.4)",
              animation: "checkmark-bounce 400ms var(--transition-spring)"
            }}
          >
            <svg width="12" height="12" viewBox="0 0 11 11" fill="none">
              <polyline points="2,5.5 4.5,8 9,2.5" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span
            className="text-[16px] font-bold text-[#22c55e] tracking-[-0.01em] leading-snug"
            data-testid="completion-headline"
          >
            Done
          </span>
        </div>
        {summary && (
          <div className="text-[13px] text-foreground/90 leading-relaxed">
            {renderMarkdown(summary)}
          </div>
        )}
      </div>

      {(parsed?.fileChanges.length || changedFiles.length) > 0 && (
        <div className="px-3 py-2.5 border-l-2 border-l-[#34d68a] bg-[rgba(52,214,138,0.02)]">
          <div className="flex items-center gap-2 mb-1.5">
            <FileCode className="w-3.5 h-3.5 text-[#34d68a] shrink-0" />
            <p className="text-[10px] font-semibold text-[#34d68a] uppercase tracking-wide">
              Files Changed
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {parsed?.fileChanges.map((change, i) => (
              <span
                key={`parsed-${i}`}
                className="bg-[rgba(52,214,138,0.12)] border border-[rgba(52,214,138,0.25)] rounded px-2 py-0.5 text-[11px] font-mono text-[#22c55e] hover:bg-[rgba(52,214,138,0.18)] transition-colors cursor-default"
                data-testid={`file-change-${i}`}
              >
                {change}
              </span>
            ))}
            {changedFiles.map((f, i) => (
              <span
                key={`file-${i}`}
                className="bg-[rgba(52,214,138,0.12)] border border-[rgba(52,214,138,0.25)] rounded px-2 py-0.5 text-[11px] font-mono text-[#22c55e] hover:bg-[rgba(52,214,138,0.18)] transition-colors cursor-default"
                data-testid={`changed-file-${i}`}
              >
                {f.split("/").pop() || f}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="px-3 py-2 border-t border-[rgba(52,214,138,0.12)] hover:bg-[rgba(52,214,138,0.04)] transition-colors">
        <div className="flex items-center gap-1.5">
          <p className="text-[12px] text-[#8888a8]">What should we build next?</p>
          <ChevronRight className="w-3 h-3 text-[#34d68a]/60 shrink-0" />
        </div>
      </div>
    </div>
  );
}
