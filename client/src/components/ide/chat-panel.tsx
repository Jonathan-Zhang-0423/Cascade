import { useState, useRef, useEffect, useCallback } from "react";
import { useIDEStore, type ChatMessage, flattenFiles } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Sparkles, X, Check, FileCode, Loader2, Square, ChevronRight, ChevronDown, History, RotateCcw, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

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

function CodeBlockView({ block }: { block: CodeBlock; autoApplied?: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  const { openFile } = useIDEStore();
  const fileName = block.filePath.split("/").pop() || block.filePath;
  const lineCount = block.code.split("\n").length;

  return (
    <div className="my-1 rounded-md border border-border/40 overflow-hidden inline-block max-w-full" data-testid={`code-block-${block.filePath}`}>
      <div
        className="flex items-center gap-1.5 px-2 py-1 bg-muted/40 cursor-pointer select-none hover:bg-muted/60 transition-colors text-[11px] text-muted-foreground"
        onClick={() => setCollapsed((c) => !c)}
        data-testid={`toggle-code-${block.filePath}`}
      >
        {collapsed ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
        <FileCode className="w-3 h-3 shrink-0" />
        <span>{fileName}</span>
        <span className="text-muted-foreground/50">{lineCount} lines</span>
        <button
          className="ml-auto inline-flex items-center gap-0.5 text-primary/70 hover:text-primary transition-colors"
          onClick={(e) => { e.stopPropagation(); openFile(block.filePath); }}
          data-testid={`button-open-${block.filePath}`}
        >
          <ExternalLink className="w-3 h-3" />
          <span>Open</span>
        </button>
      </div>
      {!collapsed && (
        <pre className="p-2.5 overflow-x-auto text-[11px] leading-relaxed bg-background/50 border-t border-border/30 max-h-[200px] overflow-y-auto">
          <code>{block.code}</code>
        </pre>
      )}
    </div>
  );
}

function MessageContent({ content, autoApplied }: { content: string; autoApplied?: boolean }) {
  const parts = parseCodeBlocks(content);

  if (parts.length === 1 && typeof parts[0] === "string") {
    return <span className="whitespace-pre-wrap">{parts[0]}</span>;
  }

  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i} className="whitespace-pre-wrap">
            {part}
          </span>
        ) : (
          <CodeBlockView key={i} block={part} autoApplied={autoApplied} />
        )
      )}
    </>
  );
}

function MessageBubble({ message, autoApplied }: { message: ChatMessage; autoApplied?: boolean }) {
  const isAssistant = message.role === "assistant";

  if (isAssistant) {
    return (
      <div
        className="px-3 text-[13px] leading-relaxed text-foreground"
        data-testid={`chat-message-${message.id}`}
      >
        <MessageContent content={message.content} autoApplied={autoApplied} />
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

function TypingIndicator() {
  return (
    <div className="px-3 flex items-center gap-1.5" data-testid="typing-indicator">
      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
      <span className="text-xs text-muted-foreground">Thinking...</span>
    </div>
  );
}

export function ChatPanel() {
  const [input, setInput] = useState("");
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
  } = useIDEStore();
  const { renameProject } = useProjectStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingHandled = useRef(false);
  const projectNameExtracted = useRef(false);
  const [autoAppliedMessageIds, setAutoAppliedMessageIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

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

    const controller = new AbortController();
    abortRef.current = controller;

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

      const finalContent = stripProjectNameMarker(accumulated);
      const codeBlocks = extractCodeBlocks(finalContent);
      if (codeBlocks.length > 0) {
        for (const block of codeBlocks) {
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
        }

        const currentMessages = useIDEStore.getState().chatMessages;
        const lastAssistantMsg = [...currentMessages].reverse().find((m) => m.role === "assistant");
        if (lastAssistantMsg) {
          setAutoAppliedMessageIds((prev) => new Set(prev).add(lastAssistantMsg.id));
        }

        refreshPreview();

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
  }, [input, isAiResponding, chatMessages, files, addChatMessage, updateLastAssistantMessage, setAiResponding, projectId, renameProject, refreshPreview, createCheckpoint]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setAiResponding(false);
  }, [setAiResponding]);

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
      <div className="flex-1 min-h-0 overflow-y-auto py-2 space-y-3" ref={scrollRef}>
        {chatMessages.map((msg) =>
          msg.role === "checkpoint" ? (
            <CheckpointMarker key={msg.id} message={msg} />
          ) : (
            <MessageBubble
              key={msg.id}
              message={msg}
              autoApplied={autoAppliedMessageIds.has(msg.id)}
            />
          )
        )}
        {isAiResponding && chatMessages[chatMessages.length - 1]?.content === "" && (
          <TypingIndicator />
        )}
      </div>
      <div className="p-2.5 border-t border-border/50 shrink-0 text-[13px]">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build..."
            className="resize-none text-[13px] min-h-[36px] max-h-[100px] bg-muted/30 border-border/30"
            rows={1}
            data-testid="input-chat"
          />
          {isAiResponding ? (
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
              onClick={() => handleSend()}
              disabled={!input.trim()}
              data-testid="button-send-chat"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
