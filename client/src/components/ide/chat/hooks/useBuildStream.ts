import { useState, useRef, useCallback, useEffect } from "react";
import {
  useIDEStore,
  type BuildResultData,
  flattenFiles,
} from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useLLMMonitorStore, type LLMEventType } from "@/stores/llm-monitor-store";
import { useLanguageStore } from "@/stores/language-store";
import { tr } from "@/lib/i18n";
import type { ActionLogEntry, CodeBlock, BuildSseEvent, NormalizedStep } from "../chat-types";
import { KNOWN_BUILD_EVENT_TYPES, BUILD_SOURCE_MAP, validateBuildEvent } from "../chat-types";
import { detectLanguage, normalizeSteps, generateCascade } from "../chat-utils";
import { parseSseStream, createHeartbeatWatchdog, type HeartbeatWatchdog } from "./useSSEStream";
import type { BuildPhase } from "../BuildPhaseIndicator";

export function useBuildStream() {
  const {
    addManagerMessage,
    setExecutingTaskIndex,
    setManagerResponding,
    setAiResponding,
    updateTaskStatus,
    setTaskFailureReason,
    setReviewPhase,
    setHolisticReview,
    setFixCycle,
    setPendingConfirmation,
    setChatMode,
    refreshPreview,
    createCheckpoint,
    projectId,
    setLastBuildFileDiff,
    clearLastBuildFileDiffs,
    setCompletionData,
  } = useIDEStore();

  const [buildPhase, setBuildPhase] = useState<BuildPhase>(null);
  const [liveActionLog, setLiveActionLog] = useState<ActionLogEntry[]>([]);
  const [liveThinkingText, setLiveThinkingText] = useState("");
  const [liveNarrationText, setLiveNarrationText] = useState("");
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [thinkingElapsedSec, setThinkingElapsedSec] = useState<number | null>(null);

  const buildSessionIdRef = useRef<string | null>(null);
  const buildReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const lastReceivedEventIdRef = useRef<number>(-1);
  const reconnectRetryRef = useRef<number>(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReconnectingRef = useRef(false);
  const isUnmountingRef = useRef(false);
  const heartbeatWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionLogRef = useRef<ActionLogEntry[]>([]);
  const thinkingFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buildLiveClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewWatchdogRef = useRef<HeartbeatWatchdog | null>(null);
  const buildResultMsgIdRef = useRef<string | null>(null);
  const savedBuildSessionIdsRef = useRef<Set<string>>(new Set());
  const connectionErrorAddedRef = useRef(false);
  const userConfirmationRef = useRef<string>("");
  const beforeBuildCheckpointCreatedRef = useRef(false);
  const buildCompleteCheckpointCreatedRef = useRef(false);
  const thinkingStartTimeRef = useRef<number | null>(null);
  const thinkingElapsedComputedRef = useRef(false);
  const connectToBuildStreamRef = useRef<
    ((sessionId: string, lastEventId: number) => Promise<void>) | null
  >(null);

  useEffect(() => {
    // Reset unmounting flag on each mount so finally blocks work correctly
    isUnmountingRef.current = false;
    return () => {
      isUnmountingRef.current = true;
      const currentProjectId = useIDEStore.getState().projectId;
      const sessionId = buildSessionIdRef.current;
      if (sessionId && currentProjectId) {
        try {
          localStorage.setItem(
            `cascade-build-session-${currentProjectId}`,
            sessionId,
          );
        } catch {}
        const existingSnap = useIDEStore.getState().streamingSnapshot;
        if (existingSnap?.type === "build" && existingSnap.sessionId === sessionId) {
          useIDEStore.getState().setStreamingSnapshot({
            ...existingSnap,
            updatedAt: Date.now(),
            lastEventId: lastReceivedEventIdRef.current,
          });
        }
      }
      if (buildReaderRef.current) {
        buildReaderRef.current.cancel().catch(() => {});
        buildReaderRef.current = null;
      }
      if (buildLiveClearTimerRef.current) {
        clearTimeout(buildLiveClearTimerRef.current);
        buildLiveClearTimerRef.current = null;
      }
      if (thinkingFadeTimerRef.current) {
        clearTimeout(thinkingFadeTimerRef.current);
        thinkingFadeTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (heartbeatWatchdogRef.current) {
        clearTimeout(heartbeatWatchdogRef.current);
        heartbeatWatchdogRef.current = null;
      }
      if (reviewWatchdogRef.current) {
        reviewWatchdogRef.current.clear();
        reviewWatchdogRef.current = null;
      }
      // Don't reset isReconnectingRef — remount will handle reconnection
    };
  }, []);

  const applyCodeBlock = useCallback(async (block: CodeBlock) => {
    const currentState = useIDEStore.getState();
    const currentFiles = flattenFiles(currentState.files);
    const exists = currentFiles.some((f) => f.path === block.filePath);

    if (exists) {
      currentState.updateFileContent(block.filePath, block.code);
    } else {
      const lastSlash = block.filePath.lastIndexOf("/");
      if (lastSlash > 0) {
        const parentPath = block.filePath.substring(0, lastSlash);
        const fileName = block.filePath.substring(lastSlash + 1);
        currentState.addFile(parentPath, fileName, "file");
        await new Promise((r) => setTimeout(r, 80));
        useIDEStore.getState().updateFileContent(block.filePath, block.code);
      }
    }
  }, []);

  const finalizeSessionCleanup = useCallback(() => {
    isReconnectingRef.current = false;
    setIsReconnecting(false);
    buildSessionIdRef.current = null;
    buildReaderRef.current = null;
    if (projectId) {
      try {
        localStorage.removeItem(`cascade-build-session-${projectId}`);
      } catch {}
    }
    setBuildPhase(null);
    setExecutingTaskIndex(null);
    setAiResponding(false);
  }, [projectId, setExecutingTaskIndex, setAiResponding]);

  const clearBuildLive = useCallback((delay = 300) => {
    if (buildLiveClearTimerRef.current) {
      clearTimeout(buildLiveClearTimerRef.current);
    }
    buildLiveClearTimerRef.current = setTimeout(() => {
      setLiveActionLog([]);
      setLiveThinkingText("");
      setLiveNarrationText("");
      buildLiveClearTimerRef.current = null;
    }, delay);
  }, []);

  const appendActionLog = useCallback((entry: ActionLogEntry) => {
    actionLogRef.current = [...actionLogRef.current, entry];
    setLiveActionLog([...actionLogRef.current]);
  }, []);

  const processBuildEvent = useCallback(
    async (
      ev: BuildSseEvent,
      ctx: {
        normalizedSteps: NormalizedStep[];
        userLang: string;
        thinkingAccumulated: { value: string };
        commAccumulated: { value: string };
        commMsgIndex: { value: number };
        editorAccumulated: { value: string };
        flushSnapshot: () => void;
        flushNarrationToStore: () => void;
        flushThinkingToStore: () => void;
        resetNarration: () => void;
        clearTypingOnCurrentMsg: () => void;
        finalizeEditor: () => void;
      },
    ) => {
      const type = ev.type;

      if (KNOWN_BUILD_EVENT_TYPES.has(type)) {
        const buildMonitorContent =
          ev.token || ev.label || ev.message || ev.filePath || type;
        useLLMMonitorStore
          .getState()
          .addEvent(
            BUILD_SOURCE_MAP[type] || "editor",
            type as LLMEventType,
            typeof buildMonitorContent === "string"
              ? buildMonitorContent
              : String(buildMonitorContent),
          );
      }

      if (type === "step_starting") {
        ctx.finalizeEditor();
        ctx.resetNarration();
        if (thinkingFadeTimerRef.current) {
          clearTimeout(thinkingFadeTimerRef.current);
          thinkingFadeTimerRef.current = null;
        }
        if (buildLiveClearTimerRef.current) {
          clearTimeout(buildLiveClearTimerRef.current);
          buildLiveClearTimerRef.current = null;
        }
        if (reviewWatchdogRef.current) {
          reviewWatchdogRef.current.clear();
          reviewWatchdogRef.current = null;
        }
        setBuildPhase("thinking");
        setLiveThinkingText("");
        setLiveNarrationText("");
        setThinkingElapsedSec(null);
        thinkingStartTimeRef.current = null;
        thinkingElapsedComputedRef.current = false;
        const stepNum = ev.stepNumber ?? 1;
        const stepTitle = ev.stepTitle || "";
        const totalSteps = ev.totalSteps || ctx.normalizedSteps.length;
        const stepLabel =
          totalSteps > 1
            ? `Step ${stepNum}/${totalSteps}: ${stepTitle}`
            : stepTitle;
        appendActionLog({
          type: "step",
          label: stepLabel,
          detail: "",
          timestamp: Date.now(),
        });
        const isCurrentProjectNow =
          useIDEStore.getState().projectId === projectId;
        if (isCurrentProjectNow || buildSessionIdRef.current) {
          setExecutingTaskIndex(stepNum - 1);
        }
        if (isCurrentProjectNow) {
          ctx.commAccumulated.value = "";
          ctx.commMsgIndex.value = -1;
        }
        await new Promise<void>((r) => setTimeout(r, 0));
      } else if (type === "thinking_token") {
        const token = ev.token || "";
        if (token) {
          if (!thinkingStartTimeRef.current) {
            thinkingStartTimeRef.current = Date.now();
          }
          if (thinkingFadeTimerRef.current) {
            clearTimeout(thinkingFadeTimerRef.current);
            thinkingFadeTimerRef.current = null;
          }
          if (buildLiveClearTimerRef.current) {
            clearTimeout(buildLiveClearTimerRef.current);
            buildLiveClearTimerRef.current = null;
          }
          ctx.thinkingAccumulated.value += token;
          ctx.flushThinkingToStore();
          ctx.flushSnapshot();
          setLiveThinkingText(ctx.thinkingAccumulated.value);
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        }
        setBuildPhase("thinking");
      } else if (type === "action_log") {
        const actionType = ev.actionType || "tool_call";
        const label = ev.label || "";
        const detail = ev.detail || "";
        const filePath = ev.filePath || undefined;
        if (ctx.thinkingAccumulated.value) {
          const existing = actionLogRef.current;
          const lastIsThinking =
            existing.length > 0 &&
            existing[existing.length - 1].type === "thinking";
          if (!lastIsThinking) {
            appendActionLog({
              type: "thinking",
              label: "Thinking",
              detail: ctx.thinkingAccumulated.value,
              timestamp: Date.now(),
            });
          }
          ctx.thinkingAccumulated.value = "";
          if (thinkingFadeTimerRef.current) {
            clearTimeout(thinkingFadeTimerRef.current);
            thinkingFadeTimerRef.current = null;
          }
          thinkingFadeTimerRef.current = setTimeout(() => {
            setLiveThinkingText("");
            thinkingFadeTimerRef.current = null;
          }, 400);
        }
        setLiveNarrationText("");
        appendActionLog({
          type: actionType,
          label,
          detail,
          timestamp: Date.now(),
          filePath,
        });
      } else if (type === "narration_token") {
        if (thinkingStartTimeRef.current && !thinkingElapsedComputedRef.current) {
          thinkingElapsedComputedRef.current = true;
          const elapsed = Math.round((Date.now() - thinkingStartTimeRef.current) / 1000);
          setThinkingElapsedSec(elapsed);
        }
        if (ctx.thinkingAccumulated.value) {
          const existing = actionLogRef.current;
          const lastIsThinking =
            existing.length > 0 &&
            existing[existing.length - 1].type === "thinking";
          if (!lastIsThinking) {
            appendActionLog({
              type: "thinking",
              label: "Thinking",
              detail: ctx.thinkingAccumulated.value,
              timestamp: Date.now(),
            });
          }
          ctx.thinkingAccumulated.value = "";
        }
        if (thinkingFadeTimerRef.current) {
          clearTimeout(thinkingFadeTimerRef.current);
          thinkingFadeTimerRef.current = null;
        }
        thinkingFadeTimerRef.current = setTimeout(() => {
          setLiveThinkingText("");
          thinkingFadeTimerRef.current = null;
        }, 400);
        if (buildLiveClearTimerRef.current) {
          clearTimeout(buildLiveClearTimerRef.current);
          buildLiveClearTimerRef.current = null;
        }
        ctx.commAccumulated.value += ev.token || "";
        ctx.flushSnapshot();
        setLiveNarrationText(ctx.commAccumulated.value);
        setBuildPhase("working");
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      } else if (type === "communicator_token") {
        ctx.commAccumulated.value += ev.token || "";
        ctx.flushSnapshot();
        setLiveNarrationText(ctx.commAccumulated.value);
        setBuildPhase("working");
      } else if (type === "code_applied") {
        setBuildPhase("working");
      } else if (
        type === "step_completed" ||
        type === "step_failed" ||
        type === "step_cancelled"
      ) {
        ctx.clearTypingOnCurrentMsg();
        ctx.finalizeEditor();
        ctx.flushNarrationToStore();
        setLiveNarrationText("");
      } else if (type === "reviewing") {
        ctx.flushNarrationToStore();
        ctx.resetNarration();
        setLiveNarrationText("");
        setBuildPhase("verifying");
        if (reviewWatchdogRef.current) {
          reviewWatchdogRef.current.clear();
          reviewWatchdogRef.current = null;
        }
        reviewWatchdogRef.current = createHeartbeatWatchdog(300_000, () => {
          reviewWatchdogRef.current = null;
          if (useIDEStore.getState().projectId !== projectId) return;
          const currentPhase = useIDEStore.getState().reviewPhase;
          if (currentPhase !== "reviewing") return;
          setReviewPhase("idle");
          setBuildPhase(null);
          clearBuildLive(0);
          if (!connectionErrorAddedRef.current) {
            connectionErrorAddedRef.current = true;
            addManagerMessage({
              role: "assistant",
              content: tr(
                useLanguageStore.getState().lang,
                "chat.errorBuildGeneric",
              ),
              source: "communicator",
              errorCode: "build_generic",
            });
          }
          if (buildReaderRef.current) {
            buildReaderRef.current.cancel().catch(() => {});
            buildReaderRef.current = null;
          }
        });
      } else if (type === "bugs_found") {
        setBuildPhase("fixing");
        if (reviewWatchdogRef.current) {
          reviewWatchdogRef.current.clear();
          reviewWatchdogRef.current = null;
        }
      } else if (type === "fixing") {
        setBuildPhase("fixing");
        if (reviewWatchdogRef.current) {
          reviewWatchdogRef.current.clear();
          reviewWatchdogRef.current = null;
        }
      }

      const isCurrentProject =
        useIDEStore.getState().projectId === projectId;
      if (!isCurrentProject) return;

      if (type === "step_starting") {
        updateTaskStatus(String(ev.stepNumber), "running");
      } else if (type === "code_applied") {
        const filePath = ev.filePath || "";
        const newCode = ev.code || "";
        const oldContent = flattenFiles(useIDEStore.getState().files)
          .find((n) => n.path === filePath)?.content ?? "";
        setLastBuildFileDiff(filePath, oldContent, newCode);
        await applyCodeBlock({
          filePath,
          code: newCode,
          language: "",
        });
        refreshPreview();
      } else if (type === "step_completed") {
        // Resolve the canonical key: prefer numeric step number, but fall back
        // to matching sub_task_id when the server sends a string ID.
        const rawNum = ev.stepNumber;
        const parsedNum = typeof rawNum === "number" ? rawNum : parseInt(String(rawNum), 10);
        let resolvedKey: string;
        if (!isNaN(parsedNum)) {
          resolvedKey = String(parsedNum);
        } else {
          // Sub-task ID string — find the matching step by sub_task_id
          const matched = ctx.normalizedSteps.find((s) => s.sub_task_id === String(rawNum));
          resolvedKey = matched ? String(matched.step) : String(rawNum);
        }
        updateTaskStatus(resolvedKey, "done");

        const stepNum = !isNaN(parsedNum) ? parsedNum : (ctx.normalizedSteps.find((s) => s.sub_task_id === String(rawNum))?.step ?? 0);
        const lastStep =
          ctx.normalizedSteps[ctx.normalizedSteps.length - 1];
        const isLastStep =
          lastStep && String(lastStep.step) === String(stepNum);
        if (isLastStep) {
          const midPlan = useIDEStore.getState().managerPlan;
          const midProjectId = useIDEStore.getState().projectId;
          if (midPlan && midProjectId) {
            const midMsg = useIDEStore
              .getState()
              .managerMessages.find((m) => m.role === "user");
            const midFileNodes = flattenFiles(useIDEStore.getState().files);
            const midCurrentFiles = midFileNodes
              .filter((f) => f.path && !f.path.endsWith("cascade.md"))
              .map((f) => ({ path: f.path!, content: f.content || "" }));
            generateCascade({
              plan: midPlan,
              userPrompt: midMsg?.content || "",
              currentFiles: midCurrentFiles,
            });
          }
        }
      } else if (type === "step_failed") {
        updateTaskStatus(String(ev.stepNumber), "failed");
        if (ev.reason) setTaskFailureReason(String(ev.stepNumber), ev.reason);
      } else if (type === "step_cancelled") {
        updateTaskStatus(String(ev.stepNumber), "pending");
      } else if (type === "reviewing") {
        setReviewPhase("reviewing");
      } else if (type === "review_passed") {
        setReviewPhase("review_passed");
        if (reviewWatchdogRef.current) {
          reviewWatchdogRef.current.clear();
          reviewWatchdogRef.current = null;
        }
        ctx.normalizedSteps.forEach((step) => {
          const key = String(step.step);
          const s = useIDEStore.getState().taskStatuses[key];
          if (s === "bug" || s === "failed") updateTaskStatus(key, "done");
        });
      } else if (type === "bugs_found") {
        setReviewPhase("review_failed");
        if (ev.review) setHolisticReview(ev.review);
        ctx.normalizedSteps.forEach((step) => {
          const key = String(step.step);
          const s = useIDEStore.getState().taskStatuses[key];
          if (s === "done" || s === "failed") updateTaskStatus(key, "bug");
        });
      } else if (type === "fixing") {
        setReviewPhase("fixing");
        setFixCycle(ev.fixCycle || 1);
      } else if (type === "needs_input") {
        setPendingConfirmation({
          stepKey: "review",
          items: ev.items || [],
        });
      } else if (type === "all_complete") {
        setReviewPhase("review_passed");
        setBuildPhase(null);
        if (reviewWatchdogRef.current) {
          reviewWatchdogRef.current.clear();
          reviewWatchdogRef.current = null;
        }
        ctx.normalizedSteps.forEach((step) => {
          const key = String(step.step);
          const s = useIDEStore.getState().taskStatuses[key];
          if (s === "bug" || s === "failed" || s === "running" || s === "pending") updateTaskStatus(key, "done");
        });
      } else if (type === "build_error") {
        setBuildPhase(null);
        setExecutingTaskIndex(null);
        setReviewPhase("idle");
        clearBuildLive(0);
        if (reviewWatchdogRef.current) {
          reviewWatchdogRef.current.clear();
          reviewWatchdogRef.current = null;
        }
        if (thinkingFadeTimerRef.current) {
          clearTimeout(thinkingFadeTimerRef.current);
          thinkingFadeTimerRef.current = null;
        }
        if (!connectionErrorAddedRef.current) {
          connectionErrorAddedRef.current = true;
          addManagerMessage({
            role: "assistant",
            content: tr(
              useLanguageStore.getState().lang,
              "chat.errorBuildGeneric",
            ),
            source: "communicator",
            errorCode: "build_generic",
          });
        }
      }
    },
    [
      projectId,
      appendActionLog,
      applyCodeBlock,
      refreshPreview,
      addManagerMessage,
      updateTaskStatus,
      setTaskFailureReason,
      setExecutingTaskIndex,
      setReviewPhase,
      setHolisticReview,
      setFixCycle,
      setPendingConfirmation,
      clearBuildLive,
    ],
  );

  const saveBuildResult = useCallback(
    (finalLog: ActionLogEntry[], changedFiles: string[], userLang: string, summary = "", sessionId?: string | null) => {
      if (useIDEStore.getState().projectId !== projectId) return;
      const activeSessionId = sessionId ?? buildSessionIdRef.current;
      if (!activeSessionId) return;
      // Session-scoped dedup using the persisted BuildResultData.sessionId field.
      // managerMessages persists to localStorage, so on reload we can look up
      // existing cards by sessionId even though in-memory refs reset. This prevents
      // duplicate cards on every reload (the old Set<string> ref-based guard failed
      // because the ref reset on mount while the card persisted).
      const existingMsgs = useIDEStore.getState().managerMessages;
      const existing = existingMsgs.find(
        (m) => m.buildResult?.sessionId === activeSessionId,
      );
      if (existing) {
        // Already have a card for this session — update in place instead of adding.
        buildResultMsgIdRef.current = existing.id;
        savedBuildSessionIdsRef.current.add(activeSessionId);
        const updated = existingMsgs.map((m) =>
          m.id === existing.id && m.buildResult
            ? {
                ...m,
                buildResult: {
                  ...m.buildResult,
                  actionLog: finalLog.length > 0 ? finalLog : m.buildResult.actionLog,
                  completionData: {
                    ...m.buildResult.completionData,
                    changedFiles: changedFiles.length > 0 ? changedFiles : m.buildResult.completionData.changedFiles,
                    userLang: userLang || m.buildResult.completionData.userLang,
                    summary: summary || m.buildResult.completionData.summary,
                  },
                },
              }
            : m,
        );
        useIDEStore.setState({ managerMessages: updated });
        return;
      }
      if (savedBuildSessionIdsRef.current.has(activeSessionId)) return;
      savedBuildSessionIdsRef.current.add(activeSessionId);
      const buildResult: BuildResultData = {
        actionLog: finalLog,
        completionData: { changedFiles, userLang, summary },
        sessionId: activeSessionId,
      };
      addManagerMessage({
        role: "assistant",
        content: "",
        source: "communicator",
        buildResult,
      });
      const msgs = useIDEStore.getState().managerMessages;
      buildResultMsgIdRef.current = msgs[msgs.length - 1]?.id || null;
    },
    [projectId, addManagerMessage],
  );

  const createBuildHelpers = useCallback(
    (userLang: string) => {
      let commAccumulated = "";
      let commMsgIndex = -1;
      let editorAccumulated = "";
      let thinkingAccumulated = "";

      const flushNarrationToStore = () => {
        // Narration text is now transient, only shown as liveNarrationText during execution
        // No longer persisted to managerMessages
        commAccumulated = "";
        commMsgIndex = -1;
      };

      const flushThinkingToStore = () => {
        const isCurrentProject2 =
          useIDEStore.getState().projectId === projectId;
        if (!isCurrentProject2) return;
        const msgs = useIDEStore.getState().managerMessages;
        let idx = commMsgIndex;
        if (idx === -1 || !msgs[idx] || msgs[idx].role !== "assistant") {
          const fallbackIdx = [...msgs]
            .reverse()
            .findIndex(
              (m) => m.typing === true && m.role === "assistant",
            );
          idx = fallbackIdx !== -1 ? msgs.length - 1 - fallbackIdx : -1;
        }
        if (idx === -1) {
          addManagerMessage({
            role: "assistant",
            content: "",
            source: "communicator",
            typing: true,
          });
          commMsgIndex =
            useIDEStore.getState().managerMessages.length - 1;
          idx = commMsgIndex;
        }
        const target = useIDEStore.getState().managerMessages[idx];
        if (target?.role === "assistant") {
          const updated = [...useIDEStore.getState().managerMessages];
          updated[idx] = { ...target, thinking: thinkingAccumulated };
          useIDEStore.setState({ managerMessages: updated });
        }
      };

      const resetNarration = () => {
        commAccumulated = "";
        commMsgIndex = -1;
        thinkingAccumulated = "";
      };

      const clearTypingOnCurrentMsg = () => {
        const isCurrentProject2 =
          useIDEStore.getState().projectId === projectId;
        if (!isCurrentProject2) return;
        if (commMsgIndex === -1) return;
        const msgs = useIDEStore.getState().managerMessages;
        const target = msgs[commMsgIndex];
        if (target?.role === "assistant" && target.typing) {
          const updated = [...msgs];
          updated[commMsgIndex] = { ...target, typing: false };
          useIDEStore.setState({ managerMessages: updated });
        }
      };

      const finalizeEditor = () => {
        editorAccumulated = "";
      };

      return {
        thinkingAccumulated: { get value() { return thinkingAccumulated; }, set value(v) { thinkingAccumulated = v; } },
        commAccumulated: { get value() { return commAccumulated; }, set value(v) { commAccumulated = v; } },
        commMsgIndex: { get value() { return commMsgIndex; }, set value(v) { commMsgIndex = v; } },
        editorAccumulated: { get value() { return editorAccumulated; }, set value(v) { editorAccumulated = v; } },
        flushNarrationToStore,
        flushThinkingToStore,
        resetNarration,
        clearTypingOnCurrentMsg,
        finalizeEditor,
      };
    },
    [projectId, addManagerMessage],
  );

  const handleExecutePlan = useCallback(async () => {
    const plan = useIDEStore.getState().managerPlan;
    if (!plan) return;
    if (buildSessionIdRef.current) return;

    if (buildLiveClearTimerRef.current) {
      clearTimeout(buildLiveClearTimerRef.current);
      buildLiveClearTimerRef.current = null;
    }
    setExecutingTaskIndex(0);
    setManagerResponding(false);
    setBuildPhase("thinking");
    setChatMode("build");
    setReviewPhase("building");
    setFixCycle(0);
    setHolisticReview(null);
    setCompletionData(null);

    if (!beforeBuildCheckpointCreatedRef.current) {
      beforeBuildCheckpointCreatedRef.current = true;
      buildCompleteCheckpointCreatedRef.current = false;
      createCheckpoint("Before build");
    }
    clearLastBuildFileDiffs();

    const normalizedSteps2 = normalizeSteps(plan);
    const firstUserMsg = useIDEStore
      .getState()
      .managerMessages.find((m) => m.role === "user");
    // Use plan summary as canonical user request — it reflects confirmed intent after multi-turn planning
    const userRequest = plan.summary || firstUserMsg?.content || "";
    const userLang = firstUserMsg ? detectLanguage(firstUserMsg.content) : "English";

    const allFiles = flattenFiles(useIDEStore.getState().files);
    const filesForServer = allFiles
      .filter((f) => f.path)
      .map((f) => ({ path: f.path!, content: f.content || "" }));

    const taskStatuses2 = useIDEStore.getState().taskStatuses;
    const userConfirmation = userConfirmationRef.current;
    userConfirmationRef.current = "";

    const sessionId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    buildSessionIdRef.current = sessionId;
    lastReceivedEventIdRef.current = -1;
    reconnectRetryRef.current = 0;
    if (projectId) {
      try {
        localStorage.setItem(
          `cascade-build-session-${projectId}`,
          sessionId,
        );
      } catch {}
    }

    let lastPrimaryBuildSnapshotFlush = 0;
    const PRIMARY_BUILD_SNAPSHOT_INTERVAL = 500;

    actionLogRef.current = [];
    setLiveActionLog([]);
    setLiveThinkingText("");
    setThinkingElapsedSec(null);
    thinkingStartTimeRef.current = null;
    buildResultMsgIdRef.current = null;
    connectionErrorAddedRef.current = false;

    const helpers = createBuildHelpers(userLang);

    const flushPrimaryBuildSnapshot = () => {
      const now = Date.now();
      if (now - lastPrimaryBuildSnapshotFlush < PRIMARY_BUILD_SNAPSHOT_INTERVAL)
        return;
      lastPrimaryBuildSnapshotFlush = now;
      useIDEStore.getState().setStreamingSnapshot({
        type: "build",
        thinkingText: helpers.thinkingAccumulated.value,
        narrationText: helpers.commAccumulated.value,
        sessionId: sessionId,
        projectId: projectId || "",
        updatedAt: now,
        lastEventId: lastReceivedEventIdRef.current,
      });
    };

    try {
      const response = await fetch("/api/build-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          plan,
          userRequest,
          userLang,
          files: filesForServer,
          taskStatuses: taskStatuses2,
          userConfirmation: userConfirmation || undefined,
          provider: useIDEStore.getState().selectedProvider,
          projectId: projectId || undefined,
          framework:
            useProjectStore
              .getState()
              .projects.find((p) => p.id === projectId)?.framework ||
            undefined,
        }),
      });

      if (!response.ok) {
        addManagerMessage({
          role: "assistant",
          content: tr(
            useLanguageStore.getState().lang,
            "chat.errorBuildStart",
          ),
          source: "communicator",
        });
        setBuildPhase(null);
        setExecutingTaskIndex(null);
        setAiResponding(false);
        setReviewPhase("idle");
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;
      buildReaderRef.current = reader;

      const watchdog = createHeartbeatWatchdog(15000, () => {
        try {
          reader.cancel();
        } catch {}
      });

      const ctx = {
        normalizedSteps: normalizedSteps2,
        userLang,
        ...helpers,
        flushSnapshot: flushPrimaryBuildSnapshot,
      };

      await parseSseStream<BuildSseEvent>(reader, {
        onHeartbeat: () => {
          watchdog.reset();
          reviewWatchdogRef.current?.reset();
        },
        validate: validateBuildEvent,
        onEvent: async (ev) => {
          watchdog.reset();
          reviewWatchdogRef.current?.reset();

          if (typeof ev.eventId === "number") {
            lastReceivedEventIdRef.current = ev.eventId;
          }

          const type = ev.type;

          if (type === "all_complete") {
            if (useIDEStore.getState().projectId === projectId) {
              createCheckpoint("Build complete", {
                includeManagerThread: true,
              });
            }
            const changedFiles = ev.changedFiles || [];
            const summaryText = ev.summaryText || "";
            const finalLog = [...actionLogRef.current];
            helpers.resetNarration();
            saveBuildResult(finalLog, changedFiles, userLang, summaryText);
            setCompletionData({ changedFiles, summary: summaryText });
            setBuildPhase(null);
            setExecutingTaskIndex(null);
            // Clear snapshot and session key now so re-entry after all_complete
            // (but before done) doesn't trigger a phantom reconnect.
            useIDEStore.getState().setStreamingSnapshot(null);
            if (projectId) {
              try { localStorage.removeItem(`cascade-build-session-${projectId}`); } catch {}
            }

            // Refresh preview and reload files immediately on completion
            if (projectId && useIDEStore.getState().projectId === projectId) {
              refreshPreview();
              fetch(`/api/projects/${projectId}/files`)
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                  if (!data?.files?.length) return;
                  if (useIDEStore.getState().projectId === projectId) {
                    useIDEStore.getState().loadProject(projectId);
                  }
                })
                .catch(() => {});
            }
            return;
          }

          if (type === "done") {
            helpers.finalizeEditor();
            helpers.flushNarrationToStore();
            setLiveNarrationText("");
            const finalLog = [...actionLogRef.current];
            if (
              helpers.thinkingAccumulated.value &&
              finalLog.length > 0
            ) {
              const lastIsThinking =
                finalLog[finalLog.length - 1].type === "thinking";
              if (!lastIsThinking) {
                finalLog.push({
                  type: "thinking",
                  label: "Thinking",
                  detail: helpers.thinkingAccumulated.value,
                  timestamp: Date.now(),
                });
              }
            }
            if (finalLog.length > 0) {
              const msgId = buildResultMsgIdRef.current;
              if (msgId) {
                const curMsgs =
                  useIDEStore.getState().managerMessages;
                const updated = curMsgs.map((m) =>
                  m.id === msgId && m.buildResult
                    ? {
                        ...m,
                        buildResult: {
                          ...m.buildResult,
                          actionLog: finalLog,
                        },
                      }
                    : m,
                );
                useIDEStore.setState({ managerMessages: updated });
              } else {
                saveBuildResult(finalLog, [], userLang);
              }
            }
            clearBuildLive(400);
            return;
          }

          await processBuildEvent(ev, ctx);
        },
      });

      watchdog.clear();
    } catch (err: unknown) {
      if (heartbeatWatchdogRef.current) {
        clearTimeout(heartbeatWatchdogRef.current);
        heartbeatWatchdogRef.current = null;
      }
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      if (!isAbort) {
        const maxRetries = 10;
        if (
          reconnectRetryRef.current < maxRetries &&
          buildSessionIdRef.current
        ) {
          reconnectRetryRef.current++;
          setIsReconnecting(true);
          isReconnectingRef.current = true;
          const retrySessionId = buildSessionIdRef.current;
          const retryLastEventId = lastReceivedEventIdRef.current;
          const backoffMs = Math.min(
            1000 * Math.pow(2, reconnectRetryRef.current - 1),
            16000,
          );
          reconnectTimerRef.current = setTimeout(async () => {
            reconnectTimerRef.current = null;
            try {
              const statusRes = await fetch(
                `/api/build-session/${retrySessionId}/status`,
              );
              if (!statusRes.ok) {
                finalizeSessionCleanup();
                return;
              }
              const statusData = await statusRes.json();
              if (statusData.active === false && !statusData.done) {
                finalizeSessionCleanup();
                return;
              }
            } catch {}
            connectToBuildStreamRef
              .current?.(retrySessionId, retryLastEventId)
              .catch(() => {});
          }, backoffMs);
          return;
        }
        if (useIDEStore.getState().projectId === projectId && !connectionErrorAddedRef.current) {
          connectionErrorAddedRef.current = true;
          addManagerMessage({
            role: "assistant",
            content: tr(useLanguageStore.getState().lang, "chat.errorBuildInterrupted"),
            source: "communicator",
            errorCode: "build_interrupted",
          });
        }
      }
    } finally {
      if (heartbeatWatchdogRef.current) {
        clearTimeout(heartbeatWatchdogRef.current);
        heartbeatWatchdogRef.current = null;
      }
      // Always clear reconnecting flag — stream has ended one way or another
      isReconnectingRef.current = false;
      setIsReconnecting(false);
      if (!isUnmountingRef.current) {
        helpers.flushNarrationToStore();
        useIDEStore.getState().setStreamingSnapshot(null);
        buildSessionIdRef.current = null;
        beforeBuildCheckpointCreatedRef.current = false;
        buildCompleteCheckpointCreatedRef.current = false;
        buildReaderRef.current = null;
        if (projectId) {
          try {
            localStorage.removeItem(
              `cascade-build-session-${projectId}`,
            );
          } catch {}
        }
        if (thinkingFadeTimerRef.current) {
          clearTimeout(thinkingFadeTimerRef.current);
          thinkingFadeTimerRef.current = null;
        }
        setBuildPhase(null);
        clearBuildLive();
        const finalLog = [...actionLogRef.current];
        if (finalLog.length > 0) {
          const msgId = buildResultMsgIdRef.current;
          if (msgId) {
            const curMsgs = useIDEStore.getState().managerMessages;
            const updated = curMsgs.map((m) =>
              m.id === msgId && m.buildResult
                ? {
                    ...m,
                    buildResult: {
                      ...m.buildResult,
                      actionLog: finalLog,
                    },
                  }
                : m,
            );
            useIDEStore.setState({ managerMessages: updated });
          } else if (useIDEStore.getState().projectId === projectId) {
            const alreadyHasResult = useIDEStore.getState().managerMessages.some((m) => !!m.buildResult);
            if (!alreadyHasResult) {
              saveBuildResult(finalLog, [], userLang);
            }
          }
        }
        if (useIDEStore.getState().projectId === projectId) {
          normalizedSteps2.forEach((step) => {
            const key = String(step.step);
            const s = useIDEStore.getState().taskStatuses[key];
            if (s === "pending" || s === "running")
              updateTaskStatus(key, "done");
          });
          setExecutingTaskIndex(null);
          setAiResponding(false);
        }
      }
    }
  }, [
    applyCodeBlock,
    refreshPreview,
    addManagerMessage,
    updateTaskStatus,
    setTaskFailureReason,
    setExecutingTaskIndex,
    setManagerResponding,
    setReviewPhase,
    setHolisticReview,
    setFixCycle,
    setPendingConfirmation,
    setChatMode,
    setAiResponding,
    projectId,
    createCheckpoint,
    processBuildEvent,
    saveBuildResult,
    createBuildHelpers,
    clearBuildLive,
    finalizeSessionCleanup,
    appendActionLog,
  ]);

  const connectToBuildStream = useCallback(
    async (sessionId: string, lastEventId: number) => {
      const plan = useIDEStore.getState().managerPlan;
      const nSteps = plan ? normalizeSteps(plan) : [];
      const firstUserMsg = useIDEStore
        .getState()
        .managerMessages.find((m) => m.role === "user");
      const userLang = firstUserMsg
        ? detectLanguage(firstUserMsg.content || "")
        : "English";

      if (buildLiveClearTimerRef.current) {
        clearTimeout(buildLiveClearTimerRef.current);
        buildLiveClearTimerRef.current = null;
      }

      buildSessionIdRef.current = sessionId;
      let buildCompleted = false;

      const buildSnapshot = useIDEStore.getState().streamingSnapshot;

      if (lastEventId === -1) {
        actionLogRef.current = [];
        setLiveActionLog([]);
        setLiveThinkingText("");
        buildResultMsgIdRef.current = null;
      }

      const helpers = createBuildHelpers(userLang);
      helpers.commAccumulated.value =
        (buildSnapshot?.type === "build"
          ? buildSnapshot.narrationText
          : "") || "";
      helpers.thinkingAccumulated.value =
        (buildSnapshot?.type === "build"
          ? buildSnapshot.thinkingText
          : "") || "";

      let lastBuildSnapshotFlush = 0;
      const BUILD_SNAPSHOT_INTERVAL = 500;
      const flushBuildSnapshot = () => {
        const now = Date.now();
        if (now - lastBuildSnapshotFlush < BUILD_SNAPSHOT_INTERVAL) return;
        lastBuildSnapshotFlush = now;
        useIDEStore.getState().setStreamingSnapshot({
          type: "build",
          thinkingText: helpers.thinkingAccumulated.value,
          narrationText: helpers.commAccumulated.value,
          sessionId: sessionId,
          projectId: projectId || "",
          updatedAt: now,
          lastEventId: lastReceivedEventIdRef.current,
        });
      };

      try {
        const response = await fetch(
          `/api/build-session/${sessionId}/stream?lastEventId=${lastEventId}`,
        );
        if (!response.ok) {
          if (projectId) {
            try {
              localStorage.removeItem(
                `cascade-build-session-${projectId}`,
              );
            } catch {}
          }
          buildSessionIdRef.current = null;
          setIsReconnecting(false);
          isReconnectingRef.current = false;
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) return;
        buildReaderRef.current = reader;
        setIsReconnecting(false);
        isReconnectingRef.current = false;
        reconnectRetryRef.current = 0;

        const watchdog = createHeartbeatWatchdog(15000, () => {
          try {
            reader.cancel();
          } catch {}
        });

        const ctx = {
          normalizedSteps: nSteps,
          userLang,
          ...helpers,
          flushSnapshot: flushBuildSnapshot,
        };

        await parseSseStream<BuildSseEvent>(reader, {
          onHeartbeat: () => {
            watchdog.reset();
            reviewWatchdogRef.current?.reset();
          },
          validate: validateBuildEvent,
          onEvent: async (ev) => {
            watchdog.reset();
            reviewWatchdogRef.current?.reset();

            if (typeof ev.eventId === "number") {
              lastReceivedEventIdRef.current = ev.eventId;
            }

            const isReplayEvent = !!ev.replay;
            const type = ev.type;
            if (type === "replay_boundary") return;

            if (!isReplayEvent && KNOWN_BUILD_EVENT_TYPES.has(type)) {
              const buildMonitorContent =
                ev.token || ev.label || ev.message || ev.filePath || type;
              useLLMMonitorStore
                .getState()
                .addEvent(
                  BUILD_SOURCE_MAP[type] || "editor",
                  type as LLMEventType,
                  typeof buildMonitorContent === "string"
                    ? buildMonitorContent
                    : String(buildMonitorContent),
                );
            }

            if (isReplayEvent) {
              if (type === "step_starting") {
                const stepNum = ev.stepNumber ?? 1;
                setExecutingTaskIndex(stepNum - 1);
                updateTaskStatus(String(stepNum), "running");
                setBuildPhase("thinking");
                helpers.thinkingAccumulated.value = "";
                helpers.commAccumulated.value = "";
                setLiveThinkingText("");
                setLiveNarrationText("");
                const stepTitle = ev.stepTitle || "";
                const totalSteps = ev.totalSteps || nSteps.length;
                const stepLabel =
                  totalSteps > 1
                    ? `Step ${stepNum}/${totalSteps}: ${stepTitle}`
                    : stepTitle;
                appendActionLog({
                  type: "step",
                  label: stepLabel,
                  detail: "",
                  timestamp: Date.now(),
                });
              } else if (type === "thinking_token") {
                const token = ev.token || "";
                if (token) {
                  helpers.thinkingAccumulated.value += token;
                  setLiveThinkingText(
                    helpers.thinkingAccumulated.value,
                  );
                }
                setBuildPhase("thinking");
              } else if (type === "narration_token") {
                if (helpers.thinkingAccumulated.value) {
                  helpers.thinkingAccumulated.value = "";
                  setLiveThinkingText("");
                }
                const token = ev.token || "";
                if (token) {
                  helpers.commAccumulated.value += token;
                  setLiveNarrationText(
                    helpers.commAccumulated.value,
                  );
                }
                setBuildPhase("working");
              } else if (type === "communicator_token") {
                const token = ev.token || "";
                if (token) {
                  helpers.commAccumulated.value += token;
                  setLiveNarrationText(
                    helpers.commAccumulated.value,
                  );
                }
                setBuildPhase("working");
              } else if (type === "action_log") {
                setBuildPhase("working");
                const actionType = ev.actionType || "tool_call";
                const label = ev.label || "";
                const detail = ev.detail || "";
                const filePath = ev.filePath || undefined;
                appendActionLog({
                  type: actionType,
                  label,
                  detail,
                  filePath,
                  timestamp: Date.now(),
                });
              } else if (type === "step_completed") {
                updateTaskStatus(String(ev.stepNumber), "done");
                helpers.clearTypingOnCurrentMsg();
                helpers.finalizeEditor();
                helpers.flushNarrationToStore();
                setLiveNarrationText("");
              } else if (type === "step_failed") {
                updateTaskStatus(String(ev.stepNumber), "failed");
                if (ev.reason)
                  setTaskFailureReason(
                    String(ev.stepNumber),
                    String(ev.reason),
                  );
              } else if (type === "code_applied") {
                setBuildPhase("working");
                if (
                  useIDEStore.getState().projectId === projectId
                ) {
                  await applyCodeBlock({
                    filePath: ev.filePath || "",
                    code: ev.code || "",
                    language: "",
                  });
                }
              } else if (type === "reviewing") {
                setReviewPhase("reviewing");
                setBuildPhase("verifying");
              } else if (type === "review_passed") {
                setReviewPhase("review_passed");
                nSteps.forEach((step) => {
                  const key = String(step.step);
                  const s = useIDEStore.getState().taskStatuses[key];
                  if (s === "bug" || s === "failed")
                    updateTaskStatus(key, "done");
                });
              } else if (type === "bugs_found") {
                setReviewPhase("review_failed");
                setBuildPhase("fixing");
              } else if (type === "fixing") {
                setReviewPhase("fixing");
                setBuildPhase("fixing");
                setFixCycle(ev.fixCycle || 1);
              } else if (type === "step_cancelled") {
                updateTaskStatus(String(ev.stepNumber), "pending");
              } else if (type === "needs_input") {
                setPendingConfirmation({
                  stepKey: "review",
                  items: ev.items || [],
                });
              } else if (type === "build_error") {
                setBuildPhase(null);
                setExecutingTaskIndex(null);
                setReviewPhase("idle");
                setLiveThinkingText("");
                setLiveNarrationText("");
                helpers.resetNarration();
              } else if (type === "all_complete") {
                buildCompleted = true;
                setReviewPhase("review_passed");
                const changedFiles = ev.changedFiles || [];
                const finalLog = [...actionLogRef.current];
                helpers.resetNarration();
                saveBuildResult(finalLog, changedFiles, userLang);
                const replayTargetId = buildResultMsgIdRef.current;
                const replaySummary = ev.summaryText || "";
                if (replaySummary && replayTargetId) {
                  const curMsgs = useIDEStore.getState().managerMessages;
                  useIDEStore.setState({
                    managerMessages: curMsgs.map((m) =>
                      m.id === replayTargetId && m.buildResult
                        ? { ...m, buildResult: { ...m.buildResult, completionData: { ...m.buildResult.completionData, summary: replaySummary } } }
                        : m,
                    ),
                  });
                }
                setCompletionData({ changedFiles, summary: replaySummary });
                setBuildPhase(null);
                setExecutingTaskIndex(null);
                nSteps.forEach((step) => {
                  const key = String(step.step);
                  const s = useIDEStore.getState().taskStatuses[key];
                  if (s === "bug" || s === "failed" || s === "running" || s === "pending") updateTaskStatus(key, "done");
                });
                return;
              } else if (type === "done") {
                return;
              }
              return;
            }

            if (type === "all_complete") {
              buildCompleted = true;
              if (useIDEStore.getState().projectId === projectId && !buildCompleteCheckpointCreatedRef.current) {
                buildCompleteCheckpointCreatedRef.current = true;
                createCheckpoint("Build complete", {
                  includeManagerThread: true,
                });
              }
              const changedFiles = ev.changedFiles || [];
              const summaryText2 = ev.summaryText || "";
              const finalLog = [...actionLogRef.current];
              helpers.resetNarration();
              saveBuildResult(finalLog, changedFiles, userLang, summaryText2);
              setCompletionData({ changedFiles, summary: summaryText2 });
              setBuildPhase(null);
              setExecutingTaskIndex(null);
              nSteps.forEach((step) => {
                const key = String(step.step);
                const s = useIDEStore.getState().taskStatuses[key];
                if (s === "bug" || s === "failed" || s === "running" || s === "pending") updateTaskStatus(key, "done");
              });
              // Clear snapshot and session key now so re-entry after all_complete
              // (but before done) doesn't trigger a phantom reconnect.
              useIDEStore.getState().setStreamingSnapshot(null);
              if (projectId) {
                try { localStorage.removeItem(`cascade-build-session-${projectId}`); } catch {}
              }

              // Refresh preview and reload files immediately on completion
              if (projectId && useIDEStore.getState().projectId === projectId) {
                fetch(`/api/projects/${projectId}/files`)
                  .then((r) => (r.ok ? r.json() : null))
                  .then((data) => {
                    if (!data?.files?.length) return;
                    if (useIDEStore.getState().projectId === projectId) {
                      useIDEStore.getState().loadProject(projectId);
                    }
                  })
                  .catch(() => {});
              }
              return;
            }

            if (type === "done") {
              helpers.finalizeEditor();
              helpers.flushNarrationToStore();
              clearBuildLive(400);
              return;
            }

            await processBuildEvent(ev, ctx);
          },
        });

        watchdog.clear();
      } catch (err: unknown) {
        if (heartbeatWatchdogRef.current) {
          clearTimeout(heartbeatWatchdogRef.current);
          heartbeatWatchdogRef.current = null;
        }
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        if (!isAbort) {
          const maxRetries = 10;
          if (
            reconnectRetryRef.current < maxRetries &&
            buildSessionIdRef.current
          ) {
            reconnectRetryRef.current++;
            setIsReconnecting(true);
            isReconnectingRef.current = true;
            const retrySessionId = buildSessionIdRef.current;
            const retryLastEventId = lastReceivedEventIdRef.current;
            const backoffMs = Math.min(
              1000 * Math.pow(2, reconnectRetryRef.current - 1),
              16000,
            );
            reconnectTimerRef.current = setTimeout(async () => {
              reconnectTimerRef.current = null;
              try {
                const statusRes = await fetch(
                  `/api/build-session/${retrySessionId}/status`,
                );
                if (!statusRes.ok) {
                  finalizeSessionCleanup();
                  return;
                }
                const statusData = await statusRes.json();
                if (
                  statusData.active === false &&
                  !statusData.done
                ) {
                  finalizeSessionCleanup();
                  return;
                }
              } catch {}
              connectToBuildStreamRef
                .current?.(retrySessionId, retryLastEventId)
                .catch(() => {});
            }, backoffMs);
            return;
          }
          isReconnectingRef.current = false;
          setIsReconnecting(false);
          if (useIDEStore.getState().projectId === projectId) {
            const errorContent = tr(
              useLanguageStore.getState().lang,
              "chat.errorBuildInterrupted",
            );
            const msgs = useIDEStore.getState().managerMessages;
            const last = msgs[msgs.length - 1];
            const alreadyShown =
              last &&
              last.role === "assistant" &&
              last.errorCode === "build_interrupted";
            if (!alreadyShown) {
              addManagerMessage({
                role: "assistant",
                content: errorContent,
                source: "communicator",
                errorCode: "build_interrupted",
              });
            }
          }
        }
      } finally {
        if (heartbeatWatchdogRef.current) {
          clearTimeout(heartbeatWatchdogRef.current);
          heartbeatWatchdogRef.current = null;
        }
        // Always clear reconnecting flag — stream has ended one way or another
        isReconnectingRef.current = false;
        setIsReconnecting(false);
        if (!isUnmountingRef.current) {
          helpers.flushNarrationToStore();
          useIDEStore.getState().setStreamingSnapshot(null);
          buildSessionIdRef.current = null;
          buildReaderRef.current = null;
          if (projectId) {
            try {
              localStorage.removeItem(
                `cascade-build-session-${projectId}`,
              );
            } catch {}
          }
          if (thinkingFadeTimerRef.current) {
            clearTimeout(thinkingFadeTimerRef.current);
            thinkingFadeTimerRef.current = null;
          }
          setBuildPhase(null);
          clearBuildLive();
          if (useIDEStore.getState().projectId === projectId) {
            if (buildCompleted) {
              const plan2 = useIDEStore.getState().managerPlan;
              if (plan2) {
                normalizeSteps(plan2).forEach((step) => {
                  const key = String(step.step);
                  const s =
                    useIDEStore.getState().taskStatuses[key];
                  if (s === "pending" || s === "running")
                    updateTaskStatus(key, "done");
                });
              }
            }
            setExecutingTaskIndex(null);
            setAiResponding(false);
          }
        }
      }
    },
    [
      applyCodeBlock,
      refreshPreview,
      addManagerMessage,
      updateTaskStatus,
      setTaskFailureReason,
      setExecutingTaskIndex,
      setReviewPhase,
      setHolisticReview,
      setFixCycle,
      setPendingConfirmation,
      setChatMode,
      setAiResponding,
      projectId,
      createCheckpoint,
      processBuildEvent,
      saveBuildResult,
      createBuildHelpers,
      clearBuildLive,
      finalizeSessionCleanup,
      appendActionLog,
    ],
  );

  connectToBuildStreamRef.current = connectToBuildStream;

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const restoreBuildResultFromDB = () => {
      fetch(`/api/projects/${projectId}/build-result`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { result: { changedFiles: string[]; summary: string; completedAt: number } | null } | null) => {
          if (cancelled || !data?.result) return;
          const store = useIDEStore.getState();
          const alreadyHasResult = store.managerMessages.some((m) => !!m.buildResult);
          if (alreadyHasResult) return;
          const buildResult: BuildResultData = {
            actionLog: [],
            completionData: { changedFiles: data.result.changedFiles, userLang: "", summary: data.result.summary },
          };
          const planMsg = [...store.managerMessages].reverse().find((m) => m.plan);
          if (planMsg) {
            const updated = store.managerMessages.map((m) =>
              m.id === planMsg.id ? { ...m, buildResult } : m,
            );
            useIDEStore.setState({ managerMessages: updated });
            if (planMsg.plan) {
              for (const step of planMsg.plan.steps) {
                updateTaskStatus(String(step.step), "done");
              }
              store.setManagerPlan(planMsg.plan);
              setReviewPhase("review_passed");
            }
            setCompletionData({ changedFiles: data.result.changedFiles, summary: data.result.summary });
          } else {
            addManagerMessage({
              role: "assistant",
              content: data.result.summary || "",
              source: "communicator",
              buildResult,
            });
            setReviewPhase("review_passed");
            setCompletionData({ changedFiles: data.result.changedFiles, summary: data.result.summary });
          }
        })
        .catch(() => {});
    };

    // If we still have a session ref (navigated away and back), reconnect directly
    if (buildSessionIdRef.current) {
      const existingSessionId = buildSessionIdRef.current;
      const snapshot = useIDEStore.getState().streamingSnapshot;
      const resumeEventId =
        snapshot?.type === "build" &&
        snapshot.sessionId === existingSessionId &&
        typeof snapshot.lastEventId === "number"
          ? snapshot.lastEventId
          : lastReceivedEventIdRef.current;

      isReconnectingRef.current = true;
      setIsReconnecting(true);

      fetch(`/api/build-session/${existingSessionId}/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled) { setIsReconnecting(false); isReconnectingRef.current = false; return; }
          if (data?.active) {
            // Still running — reconnect to live stream
            setExecutingTaskIndex(0);
            setChatMode("build");
            // Don't overwrite a terminal review state (e.g. review_passed) that was
            // already persisted — only reset to "building" if we have no result yet.
            if (useIDEStore.getState().reviewPhase !== "review_passed" && useIDEStore.getState().reviewPhase !== "review_failed") {
              setReviewPhase("building");
            }
            setBuildPhase("thinking");
            connectToBuildStream(existingSessionId, resumeEventId).catch(() => {});
          } else if (data?.done) {
            // Finished while we were away — restore result, don't re-stream
            buildSessionIdRef.current = null;
            isReconnectingRef.current = false;
            setIsReconnecting(false);
            setAiResponding(false);
            setExecutingTaskIndex(null);
            setBuildPhase(null);
            restoreBuildResultFromDB();
          } else {
            // Session gone — fall through to normal restore
            buildSessionIdRef.current = null;
            isReconnectingRef.current = false;
            setIsReconnecting(false);
            setAiResponding(false);
            setExecutingTaskIndex(null);
            setBuildPhase(null);
            restoreBuildResultFromDB();
          }
        })
        .catch(() => {
          if (cancelled) return;
          buildSessionIdRef.current = null;
          isReconnectingRef.current = false;
          setIsReconnecting(false);
          setAiResponding(false);
          setExecutingTaskIndex(null);
          setBuildPhase(null);
          restoreBuildResultFromDB();
        });

      return () => { cancelled = true; };
    }

    const savedSessionId = (() => {
      try {
        return localStorage.getItem(`cascade-build-session-${projectId}`);
      } catch {
        return null;
      }
    })();

    if (!savedSessionId) {
      fetch(`/api/build-session/active/${projectId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data?.sessionId) {
            useIDEStore.getState().setStreamingSnapshot(null);
            setAiResponding(false);
            setExecutingTaskIndex(null);
            setBuildPhase(null);
            restoreBuildResultFromDB();
            return;
          }
          if (buildSessionIdRef.current) return;
          setIsReconnecting(true);
          isReconnectingRef.current = true;
          setExecutingTaskIndex(0);
          setChatMode("build");
          if (useIDEStore.getState().reviewPhase !== "review_passed" && useIDEStore.getState().reviewPhase !== "review_failed") {
            setReviewPhase("building");
          }
          setBuildPhase("thinking");
          connectToBuildStream(data.sessionId, -1).catch(() => {});
        })
        .catch(() => {
          useIDEStore.getState().setStreamingSnapshot(null);
          setAiResponding(false);
          setExecutingTaskIndex(null);
          setBuildPhase(null);
          restoreBuildResultFromDB();
        });
      return () => {
        cancelled = true;
      };
    }

    fetch(`/api/build-session/${savedSessionId}/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          try {
            localStorage.removeItem(
              `cascade-build-session-${projectId}`,
            );
          } catch {}
          return fetch(`/api/build-session/active/${projectId}`)
            .then((r2) => (r2.ok ? r2.json() : null))
            .then((activeData) => {
              if (cancelled || !activeData?.sessionId) {
                useIDEStore.getState().setStreamingSnapshot(null);
                setAiResponding(false);
                setExecutingTaskIndex(null);
                setBuildPhase(null);
                restoreBuildResultFromDB();
                return;
              }
              if (buildSessionIdRef.current) return;
              try {
                localStorage.setItem(
                  `cascade-build-session-${projectId}`,
                  activeData.sessionId,
                );
              } catch {}
              setIsReconnecting(true);
              isReconnectingRef.current = true;
              setExecutingTaskIndex(0);
              setChatMode("build");
              if (useIDEStore.getState().reviewPhase !== "review_passed" && useIDEStore.getState().reviewPhase !== "review_failed") {
                setReviewPhase("building");
              }
              setBuildPhase("thinking");
              connectToBuildStream(activeData.sessionId, -1).catch(() => {});
            })
            .catch(() => {
              useIDEStore.getState().setStreamingSnapshot(null);
              setAiResponding(false);
              setExecutingTaskIndex(null);
              setBuildPhase(null);
              restoreBuildResultFromDB();
            });
        }
        if (buildSessionIdRef.current) return;
        setIsReconnecting(true);
        isReconnectingRef.current = true;
        setExecutingTaskIndex(0);
        setChatMode("build");
        if (useIDEStore.getState().reviewPhase !== "review_passed" && useIDEStore.getState().reviewPhase !== "review_failed") {
          setReviewPhase("building");
        }
        setBuildPhase("thinking");
        connectToBuildStream(savedSessionId, -1).catch(() => {});
      })
      .catch(() => {
        try {
          localStorage.removeItem(
            `cascade-build-session-${projectId}`,
          );
        } catch {}
        useIDEStore.getState().setStreamingSnapshot(null);
        setAiResponding(false);
        setExecutingTaskIndex(null);
        setBuildPhase(null);
        restoreBuildResultFromDB();
      });

    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    connectToBuildStream,
    setExecutingTaskIndex,
    setChatMode,
    setReviewPhase,
    setAiResponding,
  ]);

  const buildSnapshotReconnect = useCallback(() => {
    if (!projectId) return;
    const buildSnapshot = useIDEStore.getState().streamingSnapshot;
    if (
      buildSnapshot?.type === "build" &&
      buildSnapshot.projectId === projectId
    ) {
      setLiveThinkingText(buildSnapshot.thinkingText || "");
      setLiveNarrationText(buildSnapshot.narrationText || "");
      const savedBuildSessionId = (() => {
        try {
          return localStorage.getItem(
            `cascade-build-session-${projectId}`,
          );
        } catch {
          return null;
        }
      })();
      const buildSessionToReconnect =
        buildSnapshot.sessionId || savedBuildSessionId;
      if (buildSessionToReconnect && !buildSessionIdRef.current) {
        const resumeBuildEventId =
          typeof buildSnapshot.lastEventId === "number"
            ? buildSnapshot.lastEventId
            : -1;
        fetch(`/api/build-session/${buildSessionToReconnect}/status`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.active) {
              connectToBuildStreamRef.current?.(
                buildSessionToReconnect,
                resumeBuildEventId,
              );
            } else {
              useIDEStore.getState().setStreamingSnapshot(null);
              try {
                localStorage.removeItem(
                  `cascade-build-session-${projectId}`,
                );
              } catch {}
              setLiveThinkingText("");
              setLiveNarrationText("");
            }
          })
          .catch(() => {
            useIDEStore.getState().setStreamingSnapshot(null);
            try {
              localStorage.removeItem(
                `cascade-build-session-${projectId}`,
              );
            } catch {}
            setLiveThinkingText("");
            setLiveNarrationText("");
          });
      } else if (!buildSessionToReconnect) {
        setTimeout(() => {
          useIDEStore.getState().setStreamingSnapshot(null);
          setLiveThinkingText("");
          setLiveNarrationText("");
        }, 2000);
      }
    }
  }, [projectId]);

  useEffect(() => {
    buildSnapshotReconnect();
  }, [buildSnapshotReconnect]);

  const handleStopExecution = useCallback(() => {
    if (buildSessionIdRef.current) {
      fetch(`/api/build-session/${buildSessionIdRef.current}`, {
        method: "DELETE",
      }).catch(() => {});
      buildSessionIdRef.current = null;
    }
    if (buildReaderRef.current) {
      buildReaderRef.current.cancel().catch(() => {});
      buildReaderRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatWatchdogRef.current) {
      clearTimeout(heartbeatWatchdogRef.current);
      heartbeatWatchdogRef.current = null;
    }
    if (thinkingFadeTimerRef.current) {
      clearTimeout(thinkingFadeTimerRef.current);
      thinkingFadeTimerRef.current = null;
    }
    if (projectId) {
      try {
        localStorage.removeItem(`cascade-build-session-${projectId}`);
      } catch {}
    }
    setIsReconnecting(false);
    isReconnectingRef.current = false;
    setAiResponding(false);
    setExecutingTaskIndex(null);
    setReviewPhase("idle");
    setBuildPhase(null);
    setLiveThinkingText("");
    setLiveNarrationText("");
    setLiveActionLog([]);
    // Clear any stuck typing:true flags left on manager messages
    const msgs = useIDEStore.getState().managerMessages;
    const hasTyping = msgs.some((m) => m.typing);
    if (hasTyping) {
      useIDEStore.setState({
        managerMessages: msgs.map((m) => (m.typing ? { ...m, typing: false } : m)),
      });
    }
  }, [setAiResponding, setExecutingTaskIndex, setReviewPhase, projectId]);

  return {
    buildPhase,
    liveActionLog,
    liveThinkingText,
    liveNarrationText,
    isReconnecting,
    thinkingElapsedSec,
    handleExecutePlan,
    handleStopExecution,
    userConfirmationRef,
    buildSessionIdRef,
  };
}
