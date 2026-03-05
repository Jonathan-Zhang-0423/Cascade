import { useState, useRef, useEffect, useCallback } from "react";
import { useIDEStore, type ChatMessage, flattenFiles } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Bot, User, Sparkles, X, Check, Copy, FileCode, Loader2, Square } from "lucide-react";
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

function CodeBlockView({ block }: { block: CodeBlock }) {
  const [applied, setApplied] = useState(false);
  const { updateFileContent, files, addFile, openFile } = useIDEStore();

  const handleApply = () => {
    const allFiles = flattenFiles(files);
    const exists = allFiles.some((f) => f.path === block.filePath);

    if (exists) {
      updateFileContent(block.filePath, block.code);
    } else {
      const lastSlash = block.filePath.lastIndexOf("/");
      const parentPath = block.filePath.substring(0, lastSlash);
      const fileName = block.filePath.substring(lastSlash + 1);
      addFile(parentPath, fileName, "file");
      setTimeout(() => {
        updateFileContent(block.filePath, block.code);
      }, 50);
    }

    openFile(block.filePath);
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(block.code);
  };

  return (
    <div className="my-2 rounded-md border border-border/50 overflow-hidden" data-testid={`code-block-${block.filePath}`}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border/50">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileCode className="w-3 h-3" />
          <span>{block.filePath}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={handleCopy}
            data-testid={`button-copy-${block.filePath}`}
          >
            <Copy className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            variant={applied ? "outline" : "default"}
            className="h-5 px-2 text-[10px] gap-1"
            onClick={handleApply}
            disabled={applied}
            data-testid={`button-apply-${block.filePath}`}
          >
            {applied ? (
              <>
                <Check className="w-3 h-3" />
                Applied
              </>
            ) : (
              "Apply"
            )}
          </Button>
        </div>
      </div>
      <pre className="p-3 overflow-x-auto text-[12px] leading-relaxed bg-background/50">
        <code>{block.code}</code>
      </pre>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
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
          <CodeBlockView key={i} block={part} />
        )
      )}
    </>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={cn("flex gap-2.5 px-3", isAssistant ? "flex-row" : "flex-row-reverse")}
      data-testid={`chat-message-${message.id}`}
    >
      <div
        className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          isAssistant
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        {isAssistant ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
      </div>
      <div
        className={cn(
          "rounded-lg px-3 py-2 text-[13px] leading-relaxed max-w-[85%]",
          isAssistant
            ? "bg-muted/50 text-foreground"
            : "bg-primary text-primary-foreground"
        )}
      >
        <MessageContent content={message.content} />
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5 px-3" data-testid="typing-indicator">
      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-primary/10 text-primary">
        <Bot className="w-3.5 h-3.5" />
      </div>
      <div className="rounded-lg px-3 py-2 bg-muted/50 flex items-center gap-1.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Thinking...</span>
      </div>
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
  } = useIDEStore();
  const { renameProject } = useProjectStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingHandled = useRef(false);
  const projectNameExtracted = useRef(false);

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
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content })),
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
  }, [input, isAiResponding, chatMessages, files, addChatMessage, updateLastAssistantMessage, setAiResponding, projectId, renameProject]);

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

      <div className="flex-1 min-h-0 overflow-y-auto py-3 space-y-3" ref={scrollRef}>
        {chatMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isAiResponding && chatMessages[chatMessages.length - 1]?.content === "" && (
          <TypingIndicator />
        )}
      </div>

      <div className="p-2.5 border-t border-border/50 shrink-0">
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
              onClick={handleSend}
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
