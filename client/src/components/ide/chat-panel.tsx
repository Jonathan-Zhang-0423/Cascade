import { useState, useRef, useEffect } from "react";
import { useIDEStore, type ChatMessage } from "@/stores/ide-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

function MessageBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={cn("flex gap-2.5 px-4", isAssistant ? "flex-row" : "flex-row-reverse")}
      data-testid={`chat-message-${message.id}`}
    >
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          isAssistant
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        {isAssistant ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
      </div>
      <div
        className={cn(
          "rounded-xl px-3.5 py-2.5 text-sm leading-relaxed max-w-[85%]",
          isAssistant
            ? "bg-card text-card-foreground border border-card-border"
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
  const { chatMessages, addChatMessage } = useIDEStore();
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
    <div className="h-full flex flex-col bg-sidebar" data-testid="chat-panel">
      <div className="flex items-center gap-2 px-3 h-10 border-b border-sidebar-border shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Vibe Agent
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-4 space-y-4" ref={scrollRef}>
        {chatMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      <div className="p-3 border-t border-sidebar-border shrink-0">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build..."
            className="resize-none text-sm min-h-[40px] max-h-[120px] bg-background border-border/50"
            rows={1}
            data-testid="input-chat"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim()}
            data-testid="button-send-chat"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
