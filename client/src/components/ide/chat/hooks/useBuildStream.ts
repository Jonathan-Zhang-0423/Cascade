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
import { detectLanguage, normalizeSteps, generateCodestart } from "../chat-utils";
import { parseSseStream, createHeartbeatWatchdog } from "./useSSEStream";
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
  } = useIDEStore();

  const [buildPhase, setBuildPhase] = useState<BuildPhase>(null);
  const [liveActionLog, setLiveActionLog] = useState<ActionLogEntry[]>([]);
  const [liveThinkingText, setLiveThinkingText] = useState("");
  const [liveNarrationText, setLiveNarrationText] = useState("");
  const [isReconnecting, setIsReconnecting] = useState(false);

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
  const buildResultMsgIdRef = useRef<string | null>(null);
  const userConfirmationRef = useRef<string>("");
  const connectToBuildStreamRef = useRef<
    ((sessionId: string, lastEventId: number) => Promise<void>) | null
  >(null);

  useEffect(() => {
    return () => {
      isUnmountingRef.current = true;
      const currentProjectId = useIDEStore.getState().projectId;
      const sessionId = buildSessionIdRef.current;
      if (sessionId && currentProjectId) {
        try {
          localStorage.setItem(
            `codestart-build-session-${currentProjectId}`,
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
      isReconnectingRef.current = false;
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
        localStorage.removeItem(`codestart-build-session-${projectId}`);
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
        setBuildPhase("thinking");
        setLiveThinkingText("");
        setLiveNarrationText("");
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
          addManagerMessage({
            role: "assistant",
            content: stepLabel,
            source: "communicator",
            typing: true,
          });
          ctx.commMsgIndex.value =
            useIDEStore.getState().managerMessages.length - 1;
        }
        await new Promise<void>((r) => setTimeout(r, 0));
      } else if (type === "thinking_token") {
        const token = ev.token || "";
        if (token) {
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
          await new Promise<void>((r) => setTimeout(r, 16));
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
        await new Promise<void>((r) => setTimeout(r, 16));
      } else if (type === "editor_token") {
        ctx.editorAccumulated.value += ev.token || "";
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
      } else if (type === "bugs_found") {
        setBuildPhase("fixing");
      } else if (type === "fixing") {
        setBuildPhase("fixing");
      }

      const isCurrentProject =
        useIDEStore.getState().projectId === projectId;
      if (!isCurrentProject) return;

      if (type === "step_starting") {
        updateTaskStatus(String(ev.stepNumber), "running");
      } else if (type === "code_applied") {
        await applyCodeBlock({
          filePath: ev.filePath || "",
          code: ev.code || "",
          language: "",
        });
        refreshPreview();
      } else if (type === "step_completed") {
        updateTaskStatus(String(ev.stepNumber), "done");

        const stepNum = ev.stepNumber ?? 0;
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
              .filter((f) => f.path && !f.path.endsWith("codestart.md"))
              .map((f) => ({ path: f.path!, content: f.content || "" }));
            generateCodestart({
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
        ctx.normalizedSteps.forEach((step) => {
          const key = String(step.step);
          const s = useIDEStore.getState().taskStatuses[key];
          if (s === "bug" || s === "failed") updateTaskStatus(key, "done");
        });
      } else if (type === "build_error") {
        addManagerMessage({
          role: "assistant",
          content: tr(
            useLanguageStore.getState().lang,
            "chat.errorBuildGeneric",
          ),
          source: "communicator",
        });
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
    ],
  );

  const saveBuildResult = useCallback(
    (finalLog: ActionLogEntry[], changedFiles: string[], userLang: string) => {
      if (useIDEStore.getState().projectId !== projectId) return;
      const buildResult: BuildResultData = {
        actionLog: finalLog,
        completionData: { changedFiles, userLang },
      };
      const curMsgs = useIDEStore.getState().managerMessages;
      const planMsg = [...curMsgs].reverse().find((m) => m.plan);
      if (planMsg) {
        const updated = curMsgs.map((m) =>
          m.id === planMsg.id ? { ...m, buildResult } : m,
        );
        useIDEStore.setState({ managerMessages: updated });
        buildResultMsgIdRef.current = planMsg.id;
      } else {
        addManagerMessage({
          role: "assistant",
          content: "",
          source: "communicator",
          buildResult,
        });
        const msgs = useIDEStore.getState().managerMessages;
        buildResultMsgIdRef.current = msgs[msgs.length - 1]?.id || null;
      }
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
        if (!commAccumulated) return;
        const isCurrentProject2 =
          useIDEStore.getState().projectId === projectId;
        if (!isCurrentProject2) return;
        if (commMsgIndex === -1) {
          addManagerMessage({
            role: "assistant",
            content: commAccumulated,
            source: "communicator",
          });
          commMsgIndex =
            useIDEStore.getState().managerMessages.length - 1;
        } else {
          const msgs = useIDEStore.getState().managerMessages;
          const target = msgs[commMsgIndex];
          if (target?.role === "assistant") {
            const updated = [...msgs];
            updated[commMsgIndex] = { ...target, content: commAccumulated };
            useIDEStore.setState({ managerMessages: updated });
          }
        }
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

    const normalizedSteps2 = normalizeSteps(plan);
    const firstUserMsg = useIDEStore
      .getState()
      .managerMessages.find((m) => m.role === "user");
    const userRequest = firstUserMsg?.content || "";
    const userLang = firstUserMsg ? detectLanguage(userRequest) : "English";

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
          `codestart-build-session-${projectId}`,
          sessionId,
        );
      } catch {}
    }

    let lastPrimaryBuildSnapshotFlush = 0;
    const PRIMARY_BUILD_SNAPSHOT_INTERVAL = 500;

    actionLogRef.current = [];
    setLiveActionLog([]);
    setLiveThinkingText("");
    buildResultMsgIdRef.current = null;

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
        onHeartbeat: () => watchdog.reset(),
        validate: validateBuildEvent,
        onEvent: async (ev) => {
          watchdog.reset();

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
            const planSummary = ev.summary || "";
            const finalLog = [...actionLogRef.current];
            saveBuildResult(finalLog, changedFiles, userLang);

            const targetMsgId = buildResultMsgIdRef.current;
            (async () => {
              if (!targetMsgId) return;
              try {
                const response2 = await fetch("/api/communicator-chat", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    event: {
                      event: "all_complete",
                      userLanguage: userLang,
                      changedFiles,
                      planSummary,
                    },
                  }),
                });
                if (!response2.ok) return;
                const reader2 = response2.body?.getReader();
                if (!reader2) return;
                await parseSseStream(reader2, {
                  onEvent: async (parsed2) => {
                    if (parsed2.content) {
                      useLLMMonitorStore
                        .getState()
                        .addEvent(
                          "communicator",
                          "communicator_summary",
                          String(parsed2.content || ""),
                        );
                      const curMsgs2 =
                        useIDEStore.getState().managerMessages;
                      if (
                        !curMsgs2.some((m) => m.id === targetMsgId)
                      )
                        return;
                      const updated2 = curMsgs2.map((m) =>
                        m.id === targetMsgId && m.buildResult
                          ? {
                              ...m,
                              buildResult: {
                                ...m.buildResult,
                                completionData: {
                                  ...m.buildResult.completionData,
                                  summary:
                                    (m.buildResult.completionData
                                      .summary || "") +
                                    String(parsed2.content || ""),
                                },
                              },
                            }
                          : m,
                      );
                      useIDEStore.setState({
                        managerMessages: updated2,
                      });
                    }
                  },
                });
              } catch {}
            })();
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
            clearBuildLive(400);
            return;
          }

          if (type !== "all_complete" && type !== "done") {
            await processBuildEvent(ev, ctx);
          } else if (type === "all_complete") {
            await processBuildEvent(ev, ctx);
          }
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
        if (useIDEStore.getState().projectId === projectId) {
          addManagerMessage({
            role: "assistant",
            content: tr(
              useLanguageStore.getState().lang,
              "chat.errorBuildInterrupted",
            ),
            source: "communicator",
          });
        }
      }
    } finally {
      if (heartbeatWatchdogRef.current) {
        clearTimeout(heartbeatWatchdogRef.current);
        heartbeatWatchdogRef.current = null;
      }
      if (!isReconnectingRef.current && !isUnmountingRef.current) {
        helpers.flushNarrationToStore();
        useIDEStore.getState().setStreamingSnapshot(null);
        buildSessionIdRef.current = null;
        buildReaderRef.current = null;
        if (projectId) {
          try {
            localStorage.removeItem(
              `codestart-build-session-${projectId}`,
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
            saveBuildResult(finalLog, [], userLang);
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
                `codestart-build-session-${projectId}`,
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
          onHeartbeat: () => watchdog.reset(),
          validate: validateBuildEvent,
          onEvent: async (ev) => {
            watchdog.reset();

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
              } else if (type === "editor_token") {
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
              } else if (type === "all_complete") {
                buildCompleted = true;
                setReviewPhase("review_passed");
                const changedFiles = ev.changedFiles || [];
                const finalLog = [...actionLogRef.current];
                saveBuildResult(finalLog, changedFiles, userLang);
              } else if (type === "done") {
                return;
              }
              return;
            }

            if (type === "all_complete") {
              buildCompleted = true;
              if (useIDEStore.getState().projectId === projectId) {
                createCheckpoint("Build complete", {
                  includeManagerThread: true,
                });
              }
              const changedFiles = ev.changedFiles || [];
              const finalLog = [...actionLogRef.current];
              saveBuildResult(finalLog, changedFiles, userLang);
            }

            if (type === "done") {
              helpers.finalizeEditor();
              helpers.flushNarrationToStore();
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
              clearBuildLive(400);
              return;
            }

            if (type !== "all_complete") {
              await processBuildEvent(ev, ctx);
            } else {
              await processBuildEvent(ev, ctx);
            }
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
            addManagerMessage({
              role: "assistant",
              content: tr(
                useLanguageStore.getState().lang,
                "chat.errorBuildInterrupted",
              ),
              source: "communicator",
            });
          }
        }
      } finally {
        if (heartbeatWatchdogRef.current) {
          clearTimeout(heartbeatWatchdogRef.current);
          heartbeatWatchdogRef.current = null;
        }
        if (!isReconnectingRef.current && !isUnmountingRef.current) {
          helpers.flushNarrationToStore();
          useIDEStore.getState().setStreamingSnapshot(null);
          buildSessionIdRef.current = null;
          buildReaderRef.current = null;
          if (projectId) {
            try {
              localStorage.removeItem(
                `codestart-build-session-${projectId}`,
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
    if (buildSessionIdRef.current) return;

    let cancelled = false;
    const savedSessionId = (() => {
      try {
        return localStorage.getItem(`codestart-build-session-${projectId}`);
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
            return;
          }
          if (buildSessionIdRef.current) return;
          setIsReconnecting(true);
          isReconnectingRef.current = true;
          setExecutingTaskIndex(0);
          setChatMode("build");
          setReviewPhase("building");
          setBuildPhase("thinking");
          connectToBuildStream(data.sessionId, -1).catch(() => {});
        })
        .catch(() => {
          useIDEStore.getState().setStreamingSnapshot(null);
          setAiResponding(false);
          setExecutingTaskIndex(null);
          setBuildPhase(null);
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
              `codestart-build-session-${projectId}`,
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
                return;
              }
              if (buildSessionIdRef.current) return;
              try {
                localStorage.setItem(
                  `codestart-build-session-${projectId}`,
                  activeData.sessionId,
                );
              } catch {}
              setIsReconnecting(true);
              isReconnectingRef.current = true;
              setExecutingTaskIndex(0);
              setChatMode("build");
              setReviewPhase("building");
              setBuildPhase("thinking");
              connectToBuildStream(activeData.sessionId, -1).catch(() => {});
            })
            .catch(() => {
              useIDEStore.getState().setStreamingSnapshot(null);
              setAiResponding(false);
              setExecutingTaskIndex(null);
              setBuildPhase(null);
            });
        }
        if (buildSessionIdRef.current) return;
        setIsReconnecting(true);
        isReconnectingRef.current = true;
        setExecutingTaskIndex(0);
        setChatMode("build");
        setReviewPhase("building");
        setBuildPhase("thinking");
        connectToBuildStream(savedSessionId, -1).catch(() => {});
      })
      .catch(() => {
        try {
          localStorage.removeItem(
            `codestart-build-session-${projectId}`,
          );
        } catch {}
        useIDEStore.getState().setStreamingSnapshot(null);
        setAiResponding(false);
        setExecutingTaskIndex(null);
        setBuildPhase(null);
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
            `codestart-build-session-${projectId}`,
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
                  `codestart-build-session-${projectId}`,
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
                `codestart-build-session-${projectId}`,
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
        localStorage.removeItem(`codestart-build-session-${projectId}`);
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
  }, [setAiResponding, setExecutingTaskIndex, setReviewPhase, projectId]);

  return {
    buildPhase,
    liveActionLog,
    liveThinkingText,
    liveNarrationText,
    isReconnecting,
    handleExecutePlan,
    handleStopExecution,
    userConfirmationRef,
    buildSessionIdRef,
  };
}
