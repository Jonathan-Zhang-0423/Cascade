import { useRef, useEffect, useState } from "react";
import { useIDEStore, type AIProvider } from "@/stores/ide-store";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowUp,
  Lightbulb,
  Check,
  Loader2,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BuildPhaseIndicator, type BuildPhase } from "./BuildPhaseIndicator";

interface ProviderFlags {
  doubao: boolean;
  kimi: boolean;
  minimax: boolean;
  glm: boolean;
}

interface ChatInputAreaProps {
  input: string;
  setInput: (v: string) => void;
  isBusy: boolean;
  isExecuting: boolean;
  isReconnecting: boolean;
  buildPhase: BuildPhase;
  providers: ProviderFlags;
  smartResponseLoading: boolean;
  onSend: () => void;
  onStop: () => void;
  onSmartResponse: () => void;
  onToggleMode: () => void;
}

export function ChatInputArea({
  input,
  setInput,
  isBusy,
  isExecuting,
  isReconnecting,
  buildPhase,
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
    chatMessages,
    managerMessages,
  } = useIDEStore();

  const tGlobal = useT();

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
    el.style.height = Math.min(el.scrollHeight, lineHeight * 10) + "px";
  }, [input]);

  const hasAssistantMsg =
    chatMode === "manager"
      ? managerMessages.some((m) => m.role === "assistant")
      : chatMessages.some((m) => m.role === "assistant");

  return (
    <div className="px-2 pb-2 pt-1.5 border-t border-border/50 shrink-0">
      {isReconnecting && (
        <div
          className="flex items-center gap-1.5 px-1 pb-1.5"
          data-testid="reconnecting-indicator"
        >
          <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
          <span className="text-[11px] text-amber-500">
            Reconnecting to build...
          </span>
        </div>
      )}
      {(isBusy || isExecuting) && buildPhase && !isReconnecting && (
        <div className="flex items-center gap-1.5 px-1 pb-1.5">
          <BuildPhaseIndicator phase={buildPhase} />
        </div>
      )}
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
        className={cn(
          "rounded-xl border bg-background overflow-hidden transition-[border-color,box-shadow]",
          inputFocused
            ? "border-[#4f82ff] ring-2 ring-[rgba(79,130,255,0.25)]"
            : "border-[rgba(255,255,255,0.07)]",
        )}
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
          className="resize-none text-[13px] min-h-[60px] overflow-y-auto rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent px-3 pt-3 pb-1"
          data-testid="input-chat"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <button
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-muted/50 transition-colors group"
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
                "w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors shrink-0",
                chatMode === "manager"
                  ? "bg-primary border-primary"
                  : "border-muted-foreground/40 group-hover:border-muted-foreground/70",
              )}
            >
              {chatMode === "manager" && (
                <Check className="w-2.5 h-2.5 text-primary-foreground" />
              )}
            </div>
            <span className="text-[11px] text-muted-foreground font-medium group-hover:text-foreground transition-colors">
              {tGlobal("chat.planMode")}
            </span>
          </button>
          <Select
            value={selectedProvider}
            onValueChange={(v) => setSelectedProvider(v as AIProvider)}
            data-testid="select-model-provider"
          >
            <SelectTrigger
              className="h-6 w-auto gap-1 border-0 bg-transparent px-1.5 py-0 text-[10px] font-semibold shadow-none focus:ring-0 focus:ring-offset-0 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors [&>svg]:w-2.5 [&>svg]:h-2.5"
              data-testid="select-model-provider"
            >
              <SelectValue>
                <span
                  className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors",
                    selectedProvider === "kimi"
                      ? "bg-violet-100 dark:bg-violet-900/40 border-violet-400 dark:border-violet-500 text-violet-700 dark:text-violet-300"
                      : selectedProvider === "minimax"
                        ? "bg-emerald-100 dark:bg-emerald-900/40 border-emerald-400 dark:border-emerald-500 text-emerald-700 dark:text-emerald-300"
                        : selectedProvider === "glm"
                          ? "bg-sky-100 dark:bg-sky-900/40 border-sky-400 dark:border-sky-500 text-sky-700 dark:text-sky-300"
                          : "bg-muted/60 border-muted-foreground/20 text-muted-foreground",
                  )}
                >
                  {selectedProvider === "kimi"
                    ? "Kimi K2.5"
                    : selectedProvider === "minimax"
                      ? "MiniMax M2.7"
                      : selectedProvider === "glm"
                        ? "GLM-5"
                        : "Doubao"}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end" className="min-w-[140px]">
              <SelectItem value="doubao" className="text-xs">
                Doubao
              </SelectItem>
              {providers.kimi && (
                <SelectItem value="kimi" className="text-xs">
                  Kimi K2.5
                </SelectItem>
              )}
              {providers.minimax && (
                <SelectItem value="minimax" className="text-xs">
                  MiniMax M2.7
                </SelectItem>
              )}
              {providers.glm && (
                <SelectItem value="glm" className="text-xs">
                  GLM-5
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-lg shrink-0"
            onClick={onSmartResponse}
            disabled={isBusy || smartResponseLoading || !hasAssistantMsg}
            title={tGlobal("chat.smartResponse")}
            data-testid="button-smart-response"
          >
            {smartResponseLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Lightbulb className="w-3.5 h-3.5" />
            )}
          </Button>
          {isBusy ? (
            <Button
              size="icon"
              variant="destructive"
              className="h-7 w-7 rounded-lg shrink-0"
              onClick={onStop}
              data-testid="button-stop-chat"
            >
              <Square className="w-3 h-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-7 w-7 rounded-lg shrink-0 bg-gradient-to-br from-[#5585ff] to-[#2a5ce0] hover:from-[#6693ff] hover:to-[#3b6de8] border-0 shadow-[0_1px_6px_rgba(79,130,255,0.30),inset_0_1px_0_rgba(255,255,255,0.12)]"
              onClick={onSend}
              disabled={
                !input.trim() &&
                !(chatMode === "build" && managerPlan && !isExecuting)
              }
              data-testid="button-send-chat"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
