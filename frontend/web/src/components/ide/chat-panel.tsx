import { useState, useRef, useEffect, useCallback } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { X, Video, ImageIcon, Download, Loader2, Sparkles, Check } from "lucide-react";

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
import { useAigc } from "./aigc/AigcProvider";

export type { ActionLogEntry } from "./chat/chat-types";

const POSTER_STYLE_PRESETS = ["赛博朋克", "极简商务", "二次元", "水彩", "油画", "扁平插画风"];

/** Card sub-view shown after screenshot — user picks/enters a poster style. */
function PosterStyleInput({
  screenshotUrl,
  onSubmit,
  onCancel,
}: {
  screenshotUrl?: string;
  onSubmit: (style: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-2.5">
      {screenshotUrl && (
        <img src={screenshotUrl} alt="App 截图"
          className="w-full max-h-48 object-contain rounded-lg border border-border/40 opacity-80" />
      )}
      <p className="text-[11.5px] text-muted-foreground/70">选择或输入海报风格：</p>
      <div className="flex flex-wrap gap-1.5">
        {POSTER_STYLE_PRESETS.map((p) => (
          <button key={p} type="button"
            onClick={() => setValue(p)}
            className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-mono transition-colors border",
              value === p
                ? "bg-[rgba(79,130,255,0.2)] text-[#4f82ff] border-[rgba(79,130,255,0.4)]"
                : "bg-transparent text-muted-foreground/70 border-border/60 hover:border-[rgba(79,130,255,0.3)]",
            )}>
            {p}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="如：赛博朋克霓虹风、深色背景、加 CascadeAI 标题"
        className="w-full px-2.5 py-1.5 rounded-md text-[12px] bg-transparent border border-border/60 focus:border-[rgba(79,130,255,0.5)] outline-none text-foreground placeholder:text-muted-foreground/40"
        onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onSubmit(value); }}
      />
      <div className="flex items-center gap-2">
        <button type="button" disabled={!value.trim()}
          onClick={() => onSubmit(value)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors disabled:opacity-40"
          style={{ background: "rgba(52,214,138,0.15)", color: "#34d68a", border: "1px solid rgba(52,214,138,0.3)" }}>
          生成
        </button>
        <button type="button" onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">
          <X className="w-3 h-3" />取消
        </button>
      </div>
    </div>
  );
}

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

  // AIGC state lives in AigcProvider (above the desktop/mobile split in
  // pages/ide.tsx) so the card + in-flight EventSource survive shell switches.
  const { mediaStatus, tryIntercept, resetMedia, submitStyle } = useAigc();

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
    liveStepNarrations,
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
      isManagerResponding ||
      mgrPreparingPlan ||
      buildPhase === "thinking";
    if (shouldShow) {
      setShowThinking(true);
    } else {
      setShowThinking(false);
    }
  }, [isManagerResponding, mgrPreparingPlan, buildPhase, mountedTick]);
  // When chat panel becomes visible again (e.g. user navigates back),
  // re-evaluate showThinking immediately from current store state.
  useEffect(() => {
    if (activeTool !== "chat") return;
    const shouldShow =
      isManagerResponding ||
      mgrPreparingPlan ||
      buildPhase === "thinking";
    setShowThinking(shouldShow);
  }, [activeTool]);
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
    if (!isAiResponding && !isManagerResponding) return;
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
  }, [pendingPrompt, pendingPromptMode, isAiResponding, isManagerResponding, messagesReady, projectId, slot, clearPendingPrompt, handleManagerSend, handleDirectBuild, setChatMode]);

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
    handleManagerSend(originalPrompt).finally(() => { sendInFlightRef.current = false; });
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
    // ── Media keyword intercept (poster/video) ───────────────────────────────
    if (input.trim()) {
      const intercepted = await tryIntercept(input.trim());
      if (intercepted) {
        setInput("");
        return;
      }
    }
    // ────────────────────────────────────────────────────────────────────────
    if (chatMode === "build" && managerPlan && !isExecuting && !input.trim()) {
      sendInFlightRef.current = true;
      handleExecutePlan().finally(() => { sendInFlightRef.current = false; });
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
      userTriggeredRef.current = true;
      sendInFlightRef.current = true;
      handleDirectBuild(text).finally(() => { sendInFlightRef.current = false; });
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
    handleManagerSend(undefined, text).finally(() => { sendInFlightRef.current = false; });
  }, [handleManagerSend, handleDirectBuild, pendingConfirmation, input, handleContinueExecution, chatMode, managerPlan, isExecuting, handleExecutePlan, toast, tGlobal, isAiResponding, isManagerResponding]);

  const handleToggleMode = useCallback(() => {
    setChatMode(chatMode === "manager" ? "build" : "manager");
  }, [chatMode, setChatMode]);

  const isBusy = isAiResponding || isManagerResponding || isExecuting;

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
        {(isManagerResponding || mgrPreparingPlan) && (mgrLiveThinkingText || mgrLiveNarrationText || mgrLiveActionLog.length > 0) && (
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
            completionSummary={completionData?.summary || undefined}
            stepNarrations={liveStepNarrations}
          />
        )}

        {/* ── AIGC media card — rebuilt in TaskPlanCard visual language ── */}
        {mediaStatus.phase !== "idle" && (() => {
          const isRunning = mediaStatus.phase === "classifying" || mediaStatus.phase === "generating";
          const isDone = mediaStatus.phase === "done";
          const isError = mediaStatus.phase === "error";
          const taskType = isRunning && mediaStatus.phase === "generating" ? mediaStatus.type : (isDone ? mediaStatus.type : "poster");
          const typeLabel = taskType === "video" ? "演示视频" : "宣传海报";
          // Fixed step checklist (PlanCard-style). currentStep drives per-step status.
          const currentStep = "currentStep" in mediaStatus ? mediaStatus.currentStep : -1;
          const stepList = taskType === "video"
            ? ["录制视频", "完成"]
            : ["截取 App 画面", "选择风格", "生成海报", "质量检测", "完成"];
          // Terminal media state — distinguish real media vs finished-but-no-media.
          const posterUrl = isDone && mediaStatus.type === "poster" && "downloadUrl" in mediaStatus ? mediaStatus.downloadUrl : undefined;
          const videoUrl = isDone && mediaStatus.type === "video" && "downloadUrl" in mediaStatus ? mediaStatus.downloadUrl : undefined;
          const noMedia = isDone && "noMedia" in mediaStatus && !!mediaStatus.noMedia;
          const isAwaitingStyle = mediaStatus.phase === "awaiting_style";
          const screenshotUrl = isAwaitingStyle && "screenshotUrl" in mediaStatus ? mediaStatus.screenshotUrl : undefined;
          const statusIcon = isDone
            ? <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0 text-[#34d68a] text-[13px]">✓</span>
            : isRunning
              ? <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0 text-[#4f82ff] text-[13px] animate-pulse">●</span>
              : isError
                ? <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0 text-[#ef4444] text-[13px]">✗</span>
                : <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0 text-[#f5a623] text-[13px]">✎</span>;
          const statusBadge = isDone
            ? { text: "已完成", color: "#34d68a", bg: "rgba(52,214,138,0.15)" }
            : isRunning
              ? { text: "生成中", color: "#4f82ff", bg: "rgba(79,130,255,0.15)" }
              : isError
                ? { text: "失败", color: "#ef4444", bg: "rgba(239,68,68,0.15)" }
                : { text: "待选风格", color: "#f5a623", bg: "rgba(245,166,35,0.15)" };

          return (
            <div
              className={cn(
                "mx-2.5 my-1 rounded-[14px] border overflow-visible",
                isDone ? "border-[rgba(52,214,138,0.15)]" : isError ? "border-[rgba(239,68,68,0.2)]" : "border-border",
              )}
              style={{ background: "var(--panel-mid-bg)", boxShadow: "0 2px 16px rgba(0,0,0,0.18)" }}
            >
              {/* Header */}
              <div className="px-4 pt-3 pb-2.5 flex items-center gap-2 border-b border-border/60">
                {statusIcon}
                <span className="font-mono text-[12.5px] font-semibold text-foreground flex-1 min-w-0 truncate flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-[#4f82ff]" />
                  多媒体创作
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono shrink-0"
                  style={{ color: statusBadge.color, background: statusBadge.bg }}>
                  {typeLabel} · {statusBadge.text}
                </span>
              </div>

              {/* Body */}
              <div className="px-4 py-3 space-y-2.5">
                {/* Fixed step checklist — PlanCard-aligned typography; status icon on the RIGHT */}
                {stepList.length > 0 && (
                  <div className="space-y-0">
                    {stepList.map((label, i) => {
                      const isFailed = isError && i === currentStep;
                      const isDoneStep = i < currentStep || (isDone && i <= currentStep);
                      const isActive = !isFailed && !isDoneStep && i === currentStep && (isRunning || isAwaitingStyle);
                      const isPending = i > currentStep;
                      return (
                        <div key={i} className="flex items-start gap-2 py-[3px] font-mono text-[11.5px] leading-[1.4]">
                          <span className="w-[14px] text-right text-[10px] text-muted-foreground/40 shrink-0 pt-px">{i + 1}</span>
                          <span className={cn(
                            "flex-1 min-w-0",
                            isFailed ? "text-[#ef4444]" : isActive ? "text-[#4f82ff]" : isDoneStep ? "text-foreground/80" : "text-muted-foreground/40",
                          )}>{label}</span>
                          {isFailed
                            ? <span className="w-3 h-3 shrink-0 mt-[2px] text-[#ef4444] text-[11px] leading-3 text-center">✗</span>
                            : isDoneStep
                              ? <Check className="w-3 h-3 shrink-0 mt-[2px] text-[#34d68a]" />
                              : isActive
                                ? <Loader2 className="w-3 h-3 animate-spin shrink-0 mt-[2px] text-[#4f82ff]" />
                                : <span className="w-3 h-3 shrink-0 mt-[2px] text-muted-foreground/20 text-[10px] leading-3 text-center">○</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {isAwaitingStyle && (
                  <PosterStyleInput
                    screenshotUrl={screenshotUrl}
                    onSubmit={submitStyle}
                    onCancel={resetMedia}
                  />
                )}

                {isRunning && (
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground/80">
                    {mediaStatus.phase === "classifying" ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" />识别意图
                      </span>
                    ) : null}
                    {mediaStatus.phase === "generating" && mediaStatus.type === "video" && "progress" in mediaStatus && (mediaStatus as { progress?: number }).progress
                      ? <span className="text-[#4f82ff]">{(mediaStatus as { progress?: number }).progress}%</span>
                      : null}
                    <button onClick={resetMedia}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground/60 hover:text-[#ef4444] transition-colors ml-auto shrink-0">
                      <X className="w-3 h-3" />取消
                    </button>
                  </div>
                )}

                {posterUrl && (
                  <div className="space-y-2.5">
                    <img src={posterUrl} alt="Generated poster"
                      className="w-full rounded-lg object-cover max-h-72 border border-border/40" />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent("media-preview-open", { detail: { url: posterUrl, type: "image" } }))}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors"
                        style={{ background: "rgba(52,214,138,0.15)", color: "#34d68a", border: "1px solid rgba(52,214,138,0.3)" }}>
                        预览
                      </button>
                      <a href={posterUrl} download="cascade-poster.png"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors"
                        style={{ background: "rgba(79,130,255,0.15)", color: "#4f82ff", border: "1px solid rgba(79,130,255,0.3)" }}>
                        <Download className="w-3 h-3" />下载海报
                      </a>
                      <button onClick={resetMedia}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">
                        <X className="w-3 h-3" />关闭
                      </button>
                    </div>
                  </div>
                )}

                {videoUrl && (
                  <div className="space-y-2.5">
                    <video src={videoUrl} controls autoPlay loop muted className="w-full rounded-lg border border-border/40" />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent("media-preview-open", { detail: { url: videoUrl, type: "video" } }))}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors"
                        style={{ background: "rgba(52,214,138,0.15)", color: "#34d68a", border: "1px solid rgba(52,214,138,0.3)" }}>
                        预览
                      </button>
                      <a href={videoUrl} download
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors"
                        style={{ background: "rgba(79,130,255,0.15)", color: "#4f82ff", border: "1px solid rgba(79,130,255,0.3)" }}>
                        <Download className="w-3 h-3" />下载视频
                      </a>
                      <button onClick={resetMedia}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors">
                        <X className="w-3 h-3" />关闭
                      </button>
                    </div>
                  </div>
                )}

                {/* Finished but produced no media — KEEP the card visible with the step log */}
                {noMedia && (
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-muted-foreground/80">生成已结束，未产出媒体。</span>
                    <button onClick={resetMedia}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors shrink-0">
                      <X className="w-3 h-3" />关闭
                    </button>
                  </div>
                )}

                {isError && (
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-[#ef4444] truncate">{mediaStatus.message}</span>
                    <button onClick={resetMedia}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors shrink-0">
                      <X className="w-3 h-3" />关闭
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
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
