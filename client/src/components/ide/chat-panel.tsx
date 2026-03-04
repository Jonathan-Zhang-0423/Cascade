import { useState, useRef, useEffect } from "react";
import { useIDEStore, type ChatMessage } from "@/stores/ide-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Bot, User, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
        {message.content}
      </div>
    </div>
  );
}

export function ChatPanel() {
  const [input, setInput] = useState("");
  const { chatMessages, addChatMessage, setActiveTool } = useIDEStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    addChatMessage({ role: "user", content: trimmed });
    setInput("");

    setTimeout(() => {
      addChatMessage({
        role: "assistant",
        content:
          "Thanks for sharing that idea! I'd love to help you build it. Let me ask a few quick questions so I can understand exactly what you're going for. Could you tell me a bit more about what this should look like? For example, what colors or style do you have in mind?",
      });
    }, 1000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleSend}
            disabled={!input.trim()}
            data-testid="button-send-chat"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
