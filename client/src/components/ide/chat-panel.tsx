import { useState, useRef, useEffect, useCallback } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";

import { normalizeSteps } from "./chat/chat-utils";
import { ActionLogLive } from "./chat/action-log";
import { TypingIndicator } from "./chat/message-components";
import { ChatMessageList } from "./chat/ChatMessageList";
import { ChatInputArea } from "./chat/ChatInputArea";
import { type AgentStatus } from "./chat/AgentStatusLine";
import { useSmartResponse } from "./chat/hooks/useSmartResponse";
import { useAgentStream } from "@/components/ide/AgentStreamProvider";
import { useEditorStream } from "./chat/hooks/useEditorStream";

export type { ActionLogEntry } from "./chat/chat-types";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [autoAppliedMessageIds] = useState<Set<string>>(new Set());
  const [appliedBlockIndices] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingHandled = useRef(false);
  const planningStartRef = useRef<number | null>(null);
  const [planningElapsed, setPlanningElapsed] = useState(0);

  const {
    chatMessages,
    addChatMessage,
    setActiveTool,
    isAiResponding,
    setAiResponding,
    pendingPrompt,
    clearPendingPrompt,
    projectId,
    chatMode,
    setChatMode,
    managerPlan,
    managerMessages,
    taskStatuses,
    taskFailureReasons,
    executingTaskIndex,
    isManagerResponding,
    setManagerResponding,
    pendingConfirmation,
    setPendingConfirmation,
    userConfirmationInput,
    setUserConfirmationInput,
    reviewPhase,
    holisticReview,
    fixCycle,
  } = useIDEStore();

  const tGlobal = useT();
  const { toast } = useToast();

  const { manager, build } = useAgentStream();
  const {
    handleManagerSend,
    mgrPreparingPlan,
    mgrLiveThinkingText,
    mgrLiveNarrationText,
    mgrLiveActionLog,
    autoExecutePlanRef,
    abortRef: mgrAbortRef,
  } = manager;

  const {
    buildPhase,
    liveActionLog,
    liveThinkingText,
    liveNarrationText,
    isReconnecting,
    handleExecutePlan,
    handleStopExecution,
    userConfirmationRef,
  } = build;

  const {
    handleEditorSend,
    editorAbortRef,
    smartResponseLoading,
    setSmartResponseLoading,
    providers,
    setProviders,
  } = useEditorStream();

  const handleSmartResponse = useSmartResponse(
    chatMode,
    chatMessages,
    managerMessages,
    setInput,
    setSmartResponseLoading,
  );

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then(
        (data: {
          doubao?: boolean;
          kimi?: boolean;
          minimax?: boolean;
          glm?: boolean;
        }) => {
          const loaded = {
            doubao: !!data.doubao,
            kimi: !!data.kimi,
            minimax: !!data.minimax,
            glm: !!data.glm,
          };
          setProviders(loaded);
          const current = useIDEStore.getState().selectedProvider;
          const { setSelectedProvider } = useIDEStore.getState();
          if (current === "kimi" && !loaded.kimi) setSelectedProvider("doubao");
          if (current === "minimax" && !loaded.minimax) setSelectedProvider("doubao");
          if (current === "glm" && !loaded.glm) setSelectedProvider("doubao");
        },
      )
      .catch(() => {});
  }, [setProviders]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [
    chatMessages,
    managerMessages,
    liveActionLog,
    liveNarrationText,
    liveThinkingText,
    mgrLiveThinkingText,
    mgrLiveNarrationText,
    mgrLiveActionLog,
  ]);

  useEffect(() => {
    if (isManagerResponding) {
      if (planningStartRef.current === null) {
        planningStartRef.current = Date.now();
        setPlanningElapsed(0);
      }
      const id = setInterval(() => {
        setPlanningElapsed(Math.floor((Date.now() - planningStartRef.current!) / 1000));
      }, 1000);
      return () => clearInterval(id);
    } else {
      planningStartRef.current = null;
      setPlanningElapsed(0);
    }
  }, [isManagerResponding]);

  const handleContinueExecution = useCallback(
    (userInput?: string) => {
      const plan = useIDEStore.getState().managerPlan;
      if (!plan) return;
      const inputText = userInput || useIDEStore.getState().userConfirmationInput || "";
      if (inputText.trim()) {
        addChatMessage({ role: "user", content: inputText.trim() });
        userConfirmationRef.current = inputText.trim();
      } else {
        userConfirmationRef.current = "";
      }
      setPendingConfirmation(null);
      setUserConfirmationInput("");
      for (const s of normalizeSteps(plan)) {
        const key = String(s.step);
        if (useIDEStore.getState().taskStatuses[key] === "needs-input") {
          useIDEStore.getState().updateTaskStatus(key, "pending");
        }
      }
      handleExecutePlan();
    },
    [handleExecutePlan, addChatMessage, setPendingConfirmation, setUserConfirmationInput, userConfirmationRef],
  );

  useEffect(() => { pendingHandled.current = false; }, [projectId]);

  useEffect(() => {
    if (pendingPrompt && !pendingHandled.current && !isAiResponding && !isManagerResponding) {
      pendingHandled.current = true;
      const prompt = pendingPrompt;
      clearPendingPrompt();
      handleManagerSend(prompt);
    }
  }, [pendingPrompt, isAiResponding, isManagerResponding, clearPendingPrompt, handleManagerSend]);

  useEffect(() => {
    if (!isManagerResponding && autoExecutePlanRef.current) {
      autoExecutePlanRef.current = false;
      handleExecutePlan();
    }
  }, [isManagerResponding, handleExecutePlan, autoExecutePlanRef]);

  const isExecuting = executingTaskIndex !== null;

  // Derive a single AgentStatus from all the boolean flags — highest priority wins
  const agentStatus: AgentStatus = (() => {
    if (isReconnecting) return "reconnecting";
    if (mgrPreparingPlan) return "preparing";
    if (isManagerResponding) return "planning";
    if (buildPhase === "thinking") return "thinking";
    if (buildPhase === "working") return "working";
    if (buildPhase === "verifying") return "verifying";
    if (buildPhase === "fixing") return "fixing";
    if (isExecuting) return "working";
    return null;
  })();

  const handleStop = useCallback(() => {
    if (isExecuting) handleStopExecution();
    if (mgrAbortRef.current) { mgrAbortRef.current.abort(); mgrAbortRef.current = null; }
    if (editorAbortRef.current) { editorAbortRef.current.abort(); editorAbortRef.current = null; }
    setAiResponding(false);
    setManagerResponding(false);
  }, [setAiResponding, setManagerResponding, isExecuting, handleStopExecution, mgrAbortRef, editorAbortRef]);

  const handleRevisePlan = useCallback(() => {
    setChatMode("manager");
  }, [setChatMode]);

  const handleCurrentSend = useCallback(async () => {
    if (pendingConfirmation) {
      const trimmed = input.trim();
      if (trimmed) { setInput(""); handleContinueExecution(trimmed); }
      return;
    }
    if (chatMode === "build" && managerPlan && !isExecuting && !input.trim()) {
      handleExecutePlan();
      return;
    }
    const busy = isAiResponding || isManagerResponding;
    if (chatMode === "build") {
      if (!input.trim() || busy) {
        if (input.trim()) toast({ description: tGlobal("chat.busy"), duration: 1500 });
        return;
      }
      setInput("");
      handleEditorSend(input);
      return;
    }
    if (!input.trim() || busy) {
      if (input.trim()) toast({ description: tGlobal("chat.busy"), duration: 1500 });
      return;
    }
    setInput("");
    handleManagerSend(undefined, input);
  }, [handleManagerSend, handleEditorSend, pendingConfirmation, input, handleContinueExecution, chatMode, managerPlan, isExecuting, handleExecutePlan, toast, tGlobal, isAiResponding, isManagerResponding]);

  const handleToggleMode = useCallback(() => {
    setChatMode(chatMode === "manager" ? "build" : "manager");
  }, [chatMode, setChatMode]);

  const isBusy = isAiResponding || isManagerResponding || isExecuting;

  return (
    <div className="h-full flex flex-col" data-testid="chat-panel">
      <div className="flex items-center justify-between gap-2 px-3 h-[34px] border-b border-[rgba(255,255,255,0.04)] shrink-0 text-[11px] font-medium text-[#8888a8]">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground" data-testid="text-chat-title">
            {tGlobal("chat.title")}
          </span>
        </div>
        <Button
          size="icon" variant="ghost" className="h-6 w-6"
          onClick={() => setActiveTool(null)}
          aria-label={tGlobal("chat.close")}
          data-testid="button-close-chat"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-2 space-y-2" ref={scrollRef}>
        <ChatMessageList
          chatMessages={chatMessages}
          managerMessages={managerMessages}
          autoAppliedMessageIds={autoAppliedMessageIds}
          appliedBlockIndices={appliedBlockIndices}
          taskStatuses={taskStatuses}
          taskFailureReasons={taskFailureReasons}
          isExecuting={isExecuting}
          pendingConfirmation={pendingConfirmation}
          userConfirmationInput={userConfirmationInput}
          reviewPhase={reviewPhase}
          holisticReview={holisticReview}
          fixCycle={fixCycle}
          handleExecutePlan={handleExecutePlan}
          handleRevisePlan={handleRevisePlan}
          handleStopExecution={handleStopExecution}
          handleContinueExecution={handleContinueExecution}
          setUserConfirmationInput={setUserConfirmationInput}
        />
        {isAiResponding && chatMessages[chatMessages.length - 1]?.content === "" && chatMode !== "manager" && (
          <TypingIndicator />
        )}
        {!isExecuting && (mgrLiveThinkingText || mgrLiveNarrationText || mgrLiveActionLog.length > 0 ? (
          <div className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden">
            <ActionLogLive
              entries={mgrLiveActionLog}
              thinkingText={mgrLiveThinkingText || undefined}
              narrationText={mgrLiveNarrationText || undefined}
            />
          </div>
        ) : null)}
        {(liveActionLog.length > 0 || !!liveThinkingText || !!liveNarrationText) && (
          <div className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden">
            <ActionLogLive
              entries={liveActionLog}
              thinkingText={liveThinkingText || undefined}
              narrationText={liveNarrationText || undefined}
            />
          </div>
        )}
      </div>
      <ChatInputArea
        input={input}
        setInput={setInput}
        isBusy={isBusy}
        isExecuting={isExecuting}
        agentStatus={agentStatus}
        elapsed={planningElapsed > 0 ? planningElapsed : undefined}
        providers={providers}
        smartResponseLoading={smartResponseLoading}
        onSend={handleCurrentSend}
        onStop={handleStop}
        onSmartResponse={handleSmartResponse}
        onToggleMode={handleToggleMode}
      />
    </div>
  );
}
