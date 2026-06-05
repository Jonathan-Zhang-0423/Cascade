import { useState, useRef, useEffect, useCallback } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { X } from "lucide-react";

import { normalizeSteps } from "./chat/chat-utils";
import { BuildLivePanel } from "./chat/BuildLivePanel";
import { TypingIndicator } from "./chat/message-components";
import { ChatMessageList } from "./chat/ChatMessageList";
import { ChatInputArea } from "./chat/ChatInputArea";
import { type AgentStatus } from "./chat/AgentStatusLine";
import { useSmartResponse } from "./chat/hooks/useSmartResponse";
import { usePolishPrompt } from "./chat/hooks/usePolishPrompt";
import { useActiveStream } from "./chat/hooks/useActiveStream";
import { PolishPreview } from "./chat/PolishPreview";

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
    pendingPromptMode,
    clearPendingPrompt,
    projectId,
    chatMode,
    setChatMode,
    reviewEnabled,
    setReviewEnabled,
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
    completionData,
    clearManagerPlan,
    addManagerMessage,
    messagesReady,
  } = useIDEStore();

  const tGlobal = useT();
  const { toast } = useToast();

  const { manager, build, slot } = useActiveStream();
  const {
    handleManagerSend,
    mgrPreparingPlan,
    mgrLiveThinkingText,
    mgrLiveNarrationText,
    mgrLiveActionLog,
    autoExecutePlanRef,
    resetLiveState: resetManagerLiveState,
  } = manager;

  const {
    buildPhase,
    liveActionLog,
    liveThinkingText,
    liveNarrationText,
    isReconnecting,
    thinkingElapsedSec,
    handleExecutePlan,
    handleDirectBuild,
    handleStopExecution,
    resetLiveState: resetBuildLiveState,
  } = build;

  const [smartResponseLoading, setSmartResponseLoading] = useState(false);
  const [polishLoading, setPolishLoading] = useState(false);
  const [polishResult, setPolishResult] = useState<{ original: string; polished: string } | null>(null);
  const [providers, setProviders] = useState<{
    doubao: boolean;
    kimi: boolean;
    minimax: boolean;
    glm: boolean;
    "deepseek-pro": boolean;
    "deepseek-flash": boolean;
  }>({ doubao: true, kimi: false, minimax: false, glm: false, "deepseek-pro": false, "deepseek-flash": false });

  const handleSmartResponse = useSmartResponse(
    chatMode,
    chatMessages,
    managerMessages,
    setInput,
    setSmartResponseLoading,
  );

  const handlePolish = usePolishPrompt(
    chatMode,
    chatMessages,
    managerMessages,
    input,
    setPolishLoading,
    setPolishResult,
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
          "deepseek-pro"?: boolean;
          "deepseek-flash"?: boolean;
        }) => {
          const loaded = {
            doubao: !!data.doubao,
            kimi: !!data.kimi,
            minimax: !!data.minimax,
            glm: !!data.glm,
            "deepseek-pro": !!data["deepseek-pro"],
            "deepseek-flash": !!data["deepseek-flash"],
          };
          setProviders(loaded);
          const current = useIDEStore.getState().selectedProvider;
          const { setSelectedProvider } = useIDEStore.getState();
          if (current === "kimi" && !loaded.kimi) setSelectedProvider("doubao");
          if (current === "minimax" && !loaded.minimax) setSelectedProvider("doubao");
          if (current === "glm" && !loaded.glm) setSelectedProvider("doubao");
          if (current === "deepseek-pro" && !loaded["deepseek-pro"]) setSelectedProvider("doubao");
          if (current === "deepseek-flash" && !loaded["deepseek-flash"]) setSelectedProvider("doubao");
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
      const inputText = userInput || useIDEStore.getState().userConfirmationInput || "";
      if (inputText.trim()) {
        addChatMessage({ role: "user", content: inputText.trim() });
      }
      setPendingConfirmation(null);
      setUserConfirmationInput("");
      if (plan) {
        for (const s of normalizeSteps(plan)) {
          const key = String(s.step);
          if (useIDEStore.getState().taskStatuses[key] === "needs-input") {
            useIDEStore.getState().updateTaskStatus(key, "pending");
          }
        }
      }
      // POST input to the running session — do NOT restart the build
      const sessionId = slot.build.currentSessionId;
      if (sessionId) {
        fetch(`/api/build-session/${sessionId}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userInput: inputText.trim() }),
        }).catch(() => {});
      }
    },
    [addChatMessage, setPendingConfirmation, setUserConfirmationInput, slot],
  );

  useEffect(() => { pendingHandled.current = false; }, [projectId]);

  const prevProjectIdRef = useRef<string | null | undefined>(projectId);
  useEffect(() => {
    const prev = prevProjectIdRef.current;
    const curr = projectId;
    if (prev && curr && prev !== curr) {
      resetManagerLiveState();
      resetBuildLiveState();
    }
    prevProjectIdRef.current = curr;
  }, [projectId, resetManagerLiveState, resetBuildLiveState]);

  useEffect(() => {
    if (pendingPrompt && !pendingHandled.current && !isAiResponding && !isManagerResponding && messagesReady) {
      pendingHandled.current = true;
      const prompt = pendingPrompt;
      const mode = pendingPromptMode;
      clearPendingPrompt();
      if (mode === "build") {
        handleDirectBuild(prompt);
      } else {
        handleManagerSend(prompt);
      }
    }
  }, [pendingPrompt, pendingPromptMode, isAiResponding, isManagerResponding, messagesReady, clearPendingPrompt, handleManagerSend, handleDirectBuild]);

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
    slot.manager.abort();
    setAiResponding(false);
    setManagerResponding(false);
  }, [setAiResponding, setManagerResponding, isExecuting, handleStopExecution, slot]);

  const handleRevisePlan = useCallback((note?: string) => {
    const firstUserMsg = managerMessages.find((m) => m.role === "user");
    const originalPrompt = firstUserMsg?.content?.trim() || "";
    if (!originalPrompt) {
      setChatMode("manager");
      return;
    }

    clearManagerPlan();

    const trimmedNote = note?.trim();
    if (trimmedNote) {
      addManagerMessage({
        role: "user",
        content: `[重新规划] ${trimmedNote}`,
      });
    }

    handleManagerSend(originalPrompt);
  }, [managerMessages, clearManagerPlan, addManagerMessage, handleManagerSend, setChatMode]);

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
      if (!input.trim() || busy || isExecuting) {
        if (input.trim()) toast({ description: tGlobal("chat.busy"), duration: 1500 });
        return;
      }
      const text = input;
      setInput("");
      handleDirectBuild(text);
      return;
    }
    if (!input.trim() || busy) {
      if (input.trim()) toast({ description: tGlobal("chat.busy"), duration: 1500 });
      return;
    }
    setInput("");
    handleManagerSend(undefined, input);
  }, [handleManagerSend, handleDirectBuild, pendingConfirmation, input, handleContinueExecution, chatMode, managerPlan, isExecuting, handleExecutePlan, toast, tGlobal, isAiResponding, isManagerResponding]);

  const handleToggleMode = useCallback(() => {
    setChatMode(chatMode === "manager" ? "build" : "manager");
  }, [chatMode, setChatMode]);

  const handleToggleReview = useCallback(() => {
    setReviewEnabled(!reviewEnabled);
  }, [reviewEnabled, setReviewEnabled]);

  const isBusy = isAiResponding || isManagerResponding || isExecuting;

  return (
    <div className="h-full flex flex-col bg-[#08080e] relative group/panel" data-testid="chat-panel">
      <button
        className="absolute top-2 right-2 z-10 w-5 h-5 flex items-center justify-center rounded text-[#484860] hover:text-[#8888a8] hover:bg-[rgba(255,255,255,0.04)] opacity-0 group-hover/panel:opacity-100 transition-opacity"
        onClick={() => setActiveTool(null)}
        aria-label={tGlobal("chat.close")}
        data-testid="button-close-chat"
      >
        <X className="w-3 h-3" />
      </button>
      <div className="flex-1 min-h-0 overflow-y-auto py-3 space-y-1" ref={scrollRef}>
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
          liveNarrationText={liveNarrationText}
          completionData={completionData}
          handleExecutePlan={handleExecutePlan}
          handleRevisePlan={handleRevisePlan}
          handleStopExecution={handleStopExecution}
          handleContinueExecution={handleContinueExecution}
          setUserConfirmationInput={setUserConfirmationInput}
        />
        {isAiResponding && chatMessages[chatMessages.length - 1]?.content === "" && chatMode !== "manager" && (
          <TypingIndicator />
        )}
        {(isManagerResponding || mgrPreparingPlan || !isExecuting) && (mgrLiveThinkingText || mgrLiveNarrationText || mgrLiveActionLog.length > 0) && (
          <BuildLivePanel
            entries={mgrLiveActionLog}
            thinkingText={mgrLiveThinkingText || undefined}
            narrationText={mgrLiveNarrationText || undefined}
          />
        )}
        {(liveActionLog.length > 0 || !!liveThinkingText || !!liveNarrationText) && (
          <BuildLivePanel
            entries={liveActionLog}
            thinkingText={liveThinkingText || undefined}
            narrationText={liveNarrationText || undefined}
            thinkingElapsedSec={thinkingElapsedSec}
            isCompleted={!isExecuting && buildPhase === null}
          />
        )}
      </div>
      <div className="relative shrink-0">
        {polishResult && (
          <PolishPreview
            original={polishResult.original}
            polished={polishResult.polished}
            onAccept={(text) => { setInput(text); setPolishResult(null); }}
            onReject={() => setPolishResult(null)}
          />
        )}
        <ChatInputArea
          input={input}
          setInput={setInput}
          isBusy={isBusy}
          isExecuting={isExecuting}
          agentStatus={agentStatus}
          elapsed={planningElapsed > 0 ? planningElapsed : undefined}
          providers={providers}
          smartResponseLoading={smartResponseLoading}
          polishLoading={polishLoading}
          onSend={handleCurrentSend}
          onStop={handleStop}
          onSmartResponse={handleSmartResponse}
          onPolish={handlePolish}
          onToggleMode={handleToggleMode}
          onToggleReview={handleToggleReview}
        />
      </div>
    </div>
  );
}
