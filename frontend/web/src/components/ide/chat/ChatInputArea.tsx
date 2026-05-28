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
import { ArrowUp, Square, Check, Sparkles } from "lucide-react";
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
  onSend: () => void;
  onStop: () => void;
  onSmartResponse: () => void;
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
  onSend,
  onStop,
  onSmartResponse,
  onToggleMode,
}: ChatInputAreaProps) {
  const [inputFocused, setInputFocused] = useState(false);
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

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
    el.style.height = Math.min(el.scrollHeight, lineHeight * 8) + "px";
  }, [input]);

  const borderColor = agentStatus
    ? STATUS_COLORS[agentStatus]
    : inputFocused
      ? "rgba(79,130,255,0.4)"
      : "rgba(255,255,255,0.08)";

  return (
    <div className="px-2.5 pb-2.5 pt-1 shrink-0">
      {/* Status line — only when agent is active */}
      {agentStatus && (
        <div
          className="flex items-center gap-1.5 px-1 pb-1.5 font-mono text-[10px]"
          style={{ color: STATUS_COLORS[agentStatus] }}
        >
          <span
            className="w-[5px] h-[5px] rounded-full shrink-0"
            style={{
              backgroundColor: STATUS_COLORS[agentStatus],
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
          <span>{STATUS_LABELS[agentStatus]}</span>
          {typeof elapsed === "number" && elapsed >= 2 && (
            <span style={{ opacity: 0.5 }}>· {elapsed}s</span>
          )}
        </div>
      )}

      {/* Input box */}
      <div
        ref={inputBoxRef}
        onFocus={() => setInputFocused(true)}
        onBlur={() => {
          setTimeout(() => {
            if (!inputBoxRef.current?.contains(document.activeElement)) {
              setInputFocused(false);
            }
          }, 0);
        }}
        className="rounded-md overflow-hidden transition-colors"
        style={{
          background: "#0a0a12",
          border: "1px solid rgba(255,255,255,0.05)",
          borderLeft: `3px solid ${borderColor}`,
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
            chatMode === "manager" && pendingConfirmation
              ? tGlobal("chat.placeholderResponse")
              : chatMode === "manager"
                ? tGlobal("chat.placeholderManager")
                : managerPlan
                  ? tGlobal("chat.placeholderStartBuild")
                  : tGlobal("chat.placeholderDefault")
          }
          className="resize-none !text-[13px] min-h-[38px] max-h-[160px] overflow-y-auto rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent px-3 pt-2.5 pb-1"
          data-testid="input-chat"
        />

        {/* Toolbar */}
        <div className="flex items-center gap-1.5 px-2 pb-1.5">
          {/* Plan mode toggle */}
          <button
            className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors"
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
                  : "border-[rgba(255,255,255,0.15)]",
              )}
            >
              {chatMode === "manager" && (
                <Check className="w-2 h-2 text-white" />
              )}
            </div>
            <span className="font-mono text-[10px] text-[rgba(238,238,246,0.4)]">
              plan
            </span>
          </button>

          {/* Provider selector */}
          <Select
            value={selectedProvider}
            onValueChange={(v) => setSelectedProvider(v as AIProvider)}
          >
            <SelectTrigger
              className="h-5 w-auto gap-0.5 border-0 bg-transparent px-1 py-0 text-[9px] font-mono shadow-none focus:ring-0 focus:ring-offset-0 text-[rgba(238,238,246,0.35)] hover:text-[rgba(238,238,246,0.6)] transition-colors [&>svg]:w-2 [&>svg]:h-2"
              data-testid="select-model-provider"
            >
              <SelectValue>
                <span className="font-mono text-[9px]">
                  {selectedProvider === "kimi"
                    ? "kimi"
                    : selectedProvider === "minimax"
                      ? "minimax"
                      : selectedProvider === "glm"
                        ? "glm"
                        : selectedProvider === "deepseek-pro"
                          ? "deepseek-pro"
                          : selectedProvider === "deepseek-flash"
                            ? "deepseek-flash"
                            : "doubao"}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end" className="min-w-[100px]">
              <SelectItem value="doubao" className="text-xs font-mono">
                doubao
              </SelectItem>
              {providers.kimi && (
                <SelectItem value="kimi" className="text-xs font-mono">
                  kimi
                </SelectItem>
              )}
              {providers.minimax && (
                <SelectItem value="minimax" className="text-xs font-mono">
                  minimax
                </SelectItem>
              )}
              {providers.glm && (
                <SelectItem value="glm" className="text-xs font-mono">
                  glm
                </SelectItem>
              )}
              {providers["deepseek-pro"] && (
                <SelectItem value="deepseek-pro" className="text-xs font-mono">
                  deepseek-pro
                </SelectItem>
              )}
              {providers["deepseek-flash"] && (
                <SelectItem value="deepseek-flash" className="text-xs font-mono">
                  deepseek-flash
                </SelectItem>
              )}
            </SelectContent>
          </Select>

          {/* Smart Response button */}
          <button
            className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors disabled:opacity-30 disabled:cursor-default"
            onClick={onSmartResponse}
            disabled={smartResponseLoading || isBusy}
            title="Smart Response — let AI suggest a reply"
          >
            {smartResponseLoading ? (
              <span className="w-3 h-3 rounded-full border border-[rgba(238,238,246,0.3)] border-t-[rgba(238,238,246,0.7)] animate-spin shrink-0" />
            ) : (
              <Sparkles className="w-3 h-3 text-[rgba(238,238,246,0.4)]" />
            )}
            <span className="font-mono text-[10px] text-[rgba(238,238,246,0.4)]">suggest</span>
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
                  : "bg-[rgba(255,255,255,0.06)] text-[rgba(238,238,246,0.25)] cursor-default",
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
