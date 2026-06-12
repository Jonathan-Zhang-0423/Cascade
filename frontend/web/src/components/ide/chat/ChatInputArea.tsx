import { useRef, useEffect, useState } from "react";
import { useIDEStore, type AIProvider } from "@/stores/ide-store";
import { useT } from "@/lib/i18n";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUp, Square, Check, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type AgentStatus } from "./AgentStatusLine";

interface ProviderFlags {
  doubao: boolean;
  kimi: boolean;
  minimax: boolean;
  glm: boolean;
  "deepseek-pro": boolean;
  "deepseek-flash": boolean;
}

interface ChatInputAreaProps {
  input: string;
  setInput: (v: string) => void;
  isBusy: boolean;
  isExecuting: boolean;
  agentStatus: AgentStatus;
  elapsed?: number;
  providers: ProviderFlags;
  smartResponseLoading: boolean;
  polishLoading: boolean;
  onSend: () => void;
  onStop: () => void;
  onSmartResponse: () => void;
  onPolish: () => void;
  onToggleMode: () => void;
}

const STATUS_COLORS: Record<Exclude<AgentStatus, null>, string> = {
  planning: "#4f82ff",
  preparing: "#818cf8",
  thinking: "#818cf8",
  working: "#f59e0b",
  verifying: "#34d68a",
  fixing: "#f97316",
  reconnecting: "#f59e0b",
};

const STATUS_LABELS: Record<Exclude<AgentStatus, null>, string> = {
  planning: "planning",
  preparing: "preparing",
  thinking: "thinking",
  working: "working",
  verifying: "verifying",
  fixing: "fixing",
  reconnecting: "reconnecting",
};

export function ChatInputArea({
  input,
  setInput,
  isBusy,
  isExecuting,
  agentStatus,
  elapsed,
  providers,
  smartResponseLoading,
  polishLoading,
  onSend,
  onStop,
  onSmartResponse,
  onPolish,
  onToggleMode,
}: ChatInputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputBoxRef = useRef<HTMLDivElement>(null);

  const {
    chatMode,
    managerPlan,
    pendingConfirmation,
    selectedProvider,
    setSelectedProvider,
  } = useIDEStore();

  const tGlobal = useT();

  // i18n status labels
  const STATUS_LABELS_I18N: Record<Exclude<AgentStatus, null>, string> = {
    planning: tGlobal("agent.planning"),
    preparing: tGlobal("agent.preparing"),
    thinking: tGlobal("agent.thinking"),
    working: tGlobal("agent.working"),
    verifying: tGlobal("agent.verifying"),
    fixing: tGlobal("agent.fixing"),
    reconnecting: tGlobal("agent.reconnecting"),
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
    el.style.height = Math.min(el.scrollHeight, lineHeight * 8) + "px";
  }, [input]);

  const borderColor = agentStatus
    ? STATUS_COLORS[agentStatus]
    : "var(--panel-divider)";

  return (
    <div className="px-2.5 pb-2.5 pt-1 shrink-0">

      {/* Input box */}
      <div
        ref={inputBoxRef}
        className="rounded-md overflow-hidden"
        style={{
          background: "var(--panel-mid-bg)",
          border: "1px solid var(--panel-divider)",
        }}
      >
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={
            pendingConfirmation
              ? tGlobal("chat.placeholderResponse")
              : chatMode === "manager"
                ? tGlobal("chat.placeholderManager")
                : managerPlan
                  ? tGlobal("chat.placeholderStartBuild")
                  : tGlobal("chat.placeholderDefault")
          }
          className="resize-none !text-[13px] min-h-[38px] max-h-[160px] overflow-y-auto rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent px-3 pt-2.5 pb-1 placeholder:text-muted-foreground/50 placeholder:text-[13px]"
          data-testid="input-chat"
        />

        {/* Toolbar */}
        <div className="flex items-center gap-1.5 px-2 pb-1.5">
          {/* Plan mode toggle */}
          <button
            className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-accent/10 transition-colors"
            onClick={onToggleMode}
            data-testid="toggle-plan-mode"
            title={
              chatMode === "manager"
                ? tGlobal("chat.switchToBuild")
                : tGlobal("chat.switchToPlan")
            }
          >
            <div
              className={cn(
                "w-3 h-3 rounded-sm border flex items-center justify-center shrink-0",
                chatMode === "manager"
                  ? "bg-[#4f82ff] border-[#4f82ff]"
                  : "border-[#999999] dark:border-border/40",
              )}
            >
              {chatMode === "manager" && (
                <Check className="w-2 h-2 text-white" />
              )}
            </div>
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {tGlobal("chat.planLabel")}
            </span>
          </button>

          {/* Polish button */}
          <button
            className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-accent/10 transition-colors disabled:opacity-30 disabled:cursor-default"
            onClick={onPolish}
            disabled={polishLoading || isBusy}
            title={tGlobal("chat.polish")}
            data-testid="button-polish"
          >
            {polishLoading ? (
              <span className="w-3 h-3 rounded-full border border-border border-t-foreground/60 animate-spin shrink-0" />
            ) : (
              <Wand2 className="w-3 h-3 text-muted-foreground/70" />
            )}
            <span className="font-mono text-[10px] text-muted-foreground/70">{tGlobal("chat.suggest")}</span>
          </button>

          <div className="flex-1" />

          {/* Send / Stop button */}
          {isBusy ? (
            <button
              className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[#ef4444] hover:bg-[#dc2626] transition-colors"
              onClick={onStop}
              data-testid="button-stop-chat"
            >
              <Square className="w-2.5 h-2.5 fill-white text-white" />
            </button>
          ) : (
            <button
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors",
                input.trim() || (chatMode === "build" && managerPlan && !isExecuting)
                  ? "bg-[#4f82ff] hover:bg-[#3a6ee8] text-white"
                  : "bg-border/20 text-muted-foreground/50 cursor-default",
              )}
              onClick={onSend}
              disabled={
                !input.trim() &&
                !(chatMode === "build" && managerPlan && !isExecuting)
              }
              data-testid="button-send-chat"
            >
              <ArrowUp className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
