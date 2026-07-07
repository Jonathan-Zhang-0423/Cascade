import { useState, useRef, useEffect, useCallback } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { X, Video, Download, Loader2 } from "lucide-react";

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
import { useVideoTrigger, type VideoTriggerStatus } from "./chat/hooks/useVideoTrigger";

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
    fixCycle,
    completionData,
    clearManagerPlan,
    addManagerMessage,
    messagesReady,
    activeTool,
  } = useIDEStore();

  const tGlobal = useT();
  const { toast } = useToast();

  const [videoStatus, setVideoStatus] = useState<VideoTriggerStatus>({ phase: "idle" });
  const { tryIntercept, reset: resetVideo } = useVideoTrigger({
    projectId: projectId ?? undefined,
    onStatus: setVideoStatus,
  });

  const { manager, build, slot } = useActiveStream();
  const {
    handleManagerSend,
    mgrPreparingPlan,
    mgrLiveThinkingText,
    mgrLiveNarrationText,
    mgrLiveActionLog,
    mgrIsActive,
    autoExecutePlanRef,
    clearLiveState: clearManagerLiveState,
  } = manager;

  const {
    buildPhase,
    liveActionLog,
    liveThinkingText,
    liveNarrationText,
    liveStepNarrations,
    activePlanMessageId,
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

  // Thinking indicator — covers both manager mode (isManagerResponding) and
  // build mode (buildPhase="thinking" before any live content arrives).
  // mountedRef: 挂载后 300ms 内忽略来自 store 的残留 responding 状态，
  // 避免刷新时旧状态短暂触发动画；但用户主动发消息后立即显示 loading。
  const [showThinking, setShowThinking] = useState(false);
  const mountedRef = useRef(false);
  const userTriggeredRef = useRef(false); // 用户主动发消息，跳过 mountedRef 保护
  // Synchronous in-flight guard — prevents duplicate sends from rapid clicks
  // before React re-renders with the updated isManagerResponding state.
  const sendInFlightRef = useRef(false);
  const [sendPending, setSendPending] = useState(false);
  const [mountedTick, setMountedTick] = useState(0); // forces effect re-run after 300ms
  useEffect(() => {
    const id = setTimeout(() => {
      mountedRef.current = true;
      setMountedTick(1); // triggers the showThinking effect to re-evaluate
    }, 300);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!mountedRef.current && !userTriggeredRef.current) return;
    const shouldShow =
      mgrIsActive ||
      isManagerResponding ||
      mgrPreparingPlan ||
      buildPhase === "thinking";
    if (shouldShow) {
      setShowThinking(true);
    } else {
      setShowThinking(false);
    }
  }, [mgrIsActive, isManagerResponding, mgrPreparingPlan, buildPhase, mountedTick]);
  // When chat panel becomes visible again (e.g. user navigates back),
  // re-evaluate showThinking immediately from current store state.
  useEffect(() => {
    if (activeTool !== "chat") return;
    const shouldShow =
      mgrIsActive ||
      isManagerResponding ||
      mgrPreparingPlan ||
      buildPhase === "thinking";
    setShowThinking(shouldShow);
  }, [activeTool, mgrIsActive, isManagerResponding, mgrPreparingPlan, buildPhase]);
  // Hide once actual action log entries arrive (not just thinking tokens) — this
  // ensures the TypingIndicator stays visible until BuildLivePanel has real content,
  // eliminating the 1-3s gap between prompt send and first visible live content.
  useEffect(() => {
    const hasActionContent = mgrLiveActionLog.length > 0 || liveActionLog.length > 0;
    if (!hasActionContent) return;
    const t = setTimeout(() => setShowThinking(false), 50);
    return () => clearTimeout(t);
  }, [mgrLiveActionLog, liveActionLog]);
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

  // ── 自动滚底：实时读 DOM 距底距离，避免 passive scroll 事件与 React commit 的竞态 ──
  const SCROLL_THRESHOLD = 120; // px，距底部多少以内算"在底部"
  const RESUME_THRESHOLD = 30;  // px，距底部这么近时恢复自动滚底
  const userScrolledUp = useRef(false);
  const prevChatLen = useRef(0);
  const userScrolling = useRef(false);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticScroll = useRef(false); // 程序滚动标记，避免误判为用户行为

  // 封装所有程序性滚底，打标记避免触发 userScrolledUp
  const scrollToBottom = (el: HTMLElement) => {
    programmaticScroll.current = true;
    el.scrollTop = el.scrollHeight;
    // 下一个 task 清除标记（scroll 事件是同步的，rAF 后已处理完）
    requestAnimationFrame(() => { programmaticScroll.current = false; });
  };

  // 监听用户主动滚动：上滑时禁止自动滚底，滚回底部时恢复
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      // 程序自己滚的，不算用户行为
      if (programmaticScroll.current) return;

      // 用户正在主动滚动，立即锁定，延长到 300ms 覆盖惯性滚动
      userScrolling.current = true;
      if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
      scrollEndTimer.current = setTimeout(() => {
        userScrolling.current = false;
      }, 300);

      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (dist <= RESUME_THRESHOLD) {
        userScrolledUp.current = false; // 滚回底部，恢复自动滚底
      } else if (dist > SCROLL_THRESHOLD) {
        userScrolledUp.current = true;  // 主动上滑，禁止自动滚底
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    };
  }, []);

  // 挂载时滚到底——刷新后恢复到最新消息位置
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const r = requestAnimationFrame(() => {
      requestAnimationFrame(() => { scrollToBottom(el); });
    });
    return () => cancelAnimationFrame(r);
  }, []); // 只在挂载时执行一次

  // 服务器消息加载完成后再滚一次——覆盖 localStorage 恢复后的 race condition
  useEffect(() => {
    if (!messagesReady) return;
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUp.current = false;
    const r = requestAnimationFrame(() => {
      requestAnimationFrame(() => { scrollToBottom(el); });
    });
    return () => cancelAnimationFrame(r);
  }, [messagesReady]);

  // 内容变化时：只有 AI 正在输出且用户未主动滚动，才跟随滚底
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const curLen = chatMessages.length + managerMessages.length;
    prevChatLen.current = curLen;
    // AI 没在输出，不主动触碰滚动位置
    if (!isAiResponding && !isManagerResponding && !mgrIsActive) return;
    if (userScrolling.current) return;   // 用户正在滚动，绝不抢底
    if (userScrolledUp.current) return;  // 用户已上滑浏览，不打扰
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom > SCROLL_THRESHOLD) return;
    scrollToBottom(el);
  }, [
    chatMessages,
    managerMessages,
    liveActionLog,
    liveNarrationText,
    liveThinkingText,
    mgrLiveThinkingText,
    mgrLiveNarrationText,
    mgrLiveActionLog,
    isAiResponding,
    isManagerResponding,
    mgrIsActive,
  ]);

  useEffect(() => {
    const managerBusy = isManagerResponding || mgrIsActive || mgrPreparingPlan;
    if (managerBusy) {
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
  }, [isManagerResponding, mgrIsActive, mgrPreparingPlan]);

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
    },
    [addChatMessage, setPendingConfirmation, setUserConfirmationInput, slot],
  );

  useEffect(() => { pendingHandled.current = false; }, [projectId]);

  const prevProjectIdRef = useRef<string | null | undefined>(projectId);
  useEffect(() => {
    const prev = prevProjectIdRef.current;
    const curr = projectId;
    if (prev && curr && prev !== curr) {
      if (!slot.manager.isActive) clearManagerLiveState();
      if (!slot.build.isActive) resetBuildLiveState();
    }
    prevProjectIdRef.current = curr;
  }, [projectId, slot, clearManagerLiveState, resetBuildLiveState]);

  useEffect(() => {
    if (pendingPrompt && !pendingHandled.current && !isAiResponding && !isManagerResponding && !mgrIsActive && messagesReady) {
      // Guard: ensure the stream slot has already switched to the current project.
      // useMemo for slot updates in the same render cycle as projectId, but
      // handleManagerSend/handleDirectBuild close over the previous render's slot
      // when pendingPrompt fires on first mount. Verify slot.projectId matches
      // before proceeding to avoid sending on a stale (old-project) instance.
      if (slot.manager.projectId !== projectId || slot.build.projectId !== projectId) return;
      pendingHandled.current = true;
      const prompt = pendingPrompt;
      const mode = pendingPromptMode;
      if (mode === "build") {
        setChatMode("build");
        clearPendingPrompt();
        handleDirectBuild(prompt);
      } else {
        setChatMode("manager");
        clearPendingPrompt();
        handleManagerSend(prompt);
      }
    }
  }, [pendingPrompt, pendingPromptMode, isAiResponding, isManagerResponding, mgrIsActive, messagesReady, projectId, slot, clearPendingPrompt, handleManagerSend, handleDirectBuild, setChatMode]);

  useEffect(() => {
    if (!isManagerResponding && !mgrIsActive && autoExecutePlanRef.current) {
      autoExecutePlanRef.current = false;
      handleExecutePlan();
    }
  }, [isManagerResponding, mgrIsActive, handleExecutePlan, autoExecutePlanRef]);

  const isExecuting = executingTaskIndex !== null || buildPhase !== null;
  const showStandaloneBuildLog =
    activePlanMessageId === null &&
    (buildPhase !== null || liveActionLog.length > 0 || !!liveThinkingText || !!liveNarrationText);

  // Derive a single AgentStatus from all the boolean flags — highest priority wins
  const agentStatus: AgentStatus = (() => {
    if (isReconnecting) return "reconnecting";
    if (mgrIsActive && !mgrLiveActionLog.length && !mgrLiveThinkingText && !mgrLiveNarrationText) return "preparing";
    if (mgrPreparingPlan) return "preparing";
    if (isManagerResponding || mgrIsActive) return "planning";
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
    sendInFlightRef.current = false;
    setSendPending(false);
    setAiResponding(false);
    setManagerResponding(false);
  }, [setAiResponding, setManagerResponding, isExecuting, handleStopExecution, slot]);

  const handleRevisePlan = useCallback((note?: string) => {
    if (sendInFlightRef.current) return;
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

    sendInFlightRef.current = true;
    setSendPending(true);
    handleManagerSend(originalPrompt).finally(() => {
      sendInFlightRef.current = false;
      setSendPending(false);
    });
  }, [managerMessages, clearManagerPlan, addManagerMessage, handleManagerSend, setChatMode]);

  const handleCurrentSend = useCallback(async () => {
    // sendInFlightRef is a synchronous guard checked BEFORE any async state
    // update — prevents duplicate submits from rapid double-clicks while React
    // is still re-rendering with the updated isManagerResponding state.
    if (sendInFlightRef.current) {
      if (input.trim()) toast({ description: tGlobal("chat.busy"), duration: 1500 });
      return;
    }
    if (pendingConfirmation) {
      const trimmed = input.trim();
      if (trimmed) { setInput(""); handleContinueExecution(trimmed); }
      return;
    }
    // ── Video keyword intercept ──────────────────────────────────────────────
    if (input.trim() && tryIntercept(input.trim())) {
      setInput("");
      return;
    }
    // ────────────────────────────────────────────────────────────────────────
    if (chatMode === "build" && managerPlan && !isExecuting && !input.trim()) {
      sendInFlightRef.current = true;
      setSendPending(true);
      handleExecutePlan().finally(() => {
        sendInFlightRef.current = false;
        setSendPending(false);
      });
      return;
    }
    const busy = isAiResponding || isManagerResponding || mgrIsActive || mgrPreparingPlan;
    if (chatMode === "build") {
      if (!input.trim() || busy || isExecuting) {
        if (input.trim()) toast({ description: tGlobal("chat.busy"), duration: 1500 });
        return;
      }
      const text = input;
      setInput("");
      userTriggeredRef.current = true;
      sendInFlightRef.current = true;
      setSendPending(true);
      handleDirectBuild(text).finally(() => {
        sendInFlightRef.current = false;
        setSendPending(false);
      });
      return;
    }
    if (!input.trim() || busy) {
      if (input.trim()) toast({ description: tGlobal("chat.busy"), duration: 1500 });
      return;
    }
    const text = input;
    setInput("");
    userTriggeredRef.current = true;
    sendInFlightRef.current = true;
    setSendPending(true);
    handleManagerSend(undefined, text).finally(() => {
      sendInFlightRef.current = false;
      setSendPending(false);
    });
  }, [handleManagerSend, handleDirectBuild, pendingConfirmation, input, handleContinueExecution, chatMode, managerPlan, isExecuting, handleExecutePlan, toast, tGlobal, isAiResponding, isManagerResponding, mgrIsActive, mgrPreparingPlan]);

  const handleToggleMode = useCallback(() => {
    setChatMode(chatMode === "manager" ? "build" : "manager");
  }, [chatMode, setChatMode]);

  const isBusy = sendPending || isAiResponding || isManagerResponding || mgrIsActive || isExecuting || mgrPreparingPlan;

  return (
    <div className="h-full flex flex-col relative" style={{ background: "var(--panel-mid-bg)" }} data-testid="chat-panel">
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
        {showThinking && (
          <TypingIndicator />
        )}
        {mgrLiveActionLog.length > 0 && (
          <BuildLivePanel
            entries={mgrLiveActionLog}
            thinkingText={mgrLiveThinkingText || undefined}
            narrationText={mgrLiveNarrationText || undefined}
          />
        )}
        {showStandaloneBuildLog && (
          <BuildLivePanel
            entries={liveActionLog}
            thinkingText={liveThinkingText || undefined}
            narrationText={liveNarrationText || undefined}
            thinkingElapsedSec={thinkingElapsedSec}
            isCompleted={!isExecuting && buildPhase === null}
            completionSummary={completionData?.summary || undefined}
            stepNarrations={liveStepNarrations}
          />
        )}

        {/* Video generation status card */}
        {videoStatus.phase !== "idle" && (
          <div className="mx-3 my-2 rounded-md px-3 py-2.5 text-[12px] flex items-start gap-2.5"
            style={{ background: "var(--panel-mid-bg)", border: "1px solid var(--panel-divider)" }}
          >
            <Video className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#4f82ff]" />
            <div className="flex-1 min-w-0">
              {videoStatus.phase === "generating" && (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/60 shrink-0" />
                  <span className="text-muted-foreground/80">正在录制演示视频… {videoStatus.progress > 0 ? `${videoStatus.progress}%` : ""}</span>
                </div>
              )}
              {videoStatus.phase === "done" && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#34d68a]">演示视频已生成</span>
                  <div className="flex items-center gap-2">
                    <a
                      href={videoStatus.downloadUrl}
                      download
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[#4f82ff] hover:bg-[rgba(79,130,255,0.1)] transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      下载
                    </a>
                    <button
                      onClick={resetVideo}
                      className="w-4 h-4 flex items-center justify-center rounded hover:bg-accent/10 text-muted-foreground/50 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
              {videoStatus.phase === "error" && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#ef4444] truncate">{videoStatus.message}</span>
                  <button
                    onClick={resetVideo}
                    className="w-4 h-4 flex items-center justify-center rounded hover:bg-accent/10 text-muted-foreground/50 transition-colors shrink-0"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
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
        />
      </div>
    </div>
  );
}
