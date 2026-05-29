import { useState, useRef, useCallback, useEffect } from "react";
import {
  useIDEStore,
  type ManagerMessage,
  flattenFiles,
} from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useLLMMonitorStore, type LLMEventType } from "@/stores/llm-monitor-store";
import { useLanguageStore } from "@/stores/language-store";
import { tr } from "@/lib/i18n";
import type { ManagerPlan } from "@/stores/ide-store";
import type { ActionLogEntry, ManagerSseEvent } from "../chat-types";
import {
  KNOWN_MGR_EVENT_TYPES,
  MGR_SOURCE_MAP,
  PROJECT_NAME_REGEX,
  validateManagerEvent,
} from "../chat-types";
import {
  normalizeSteps,
  stripProjectNameMarker,
  generateCascade,
} from "../chat-utils";
import { parseSseStream } from "./useSSEStream";

export interface ManagerStreamState {
  mgrPreparingPlan: boolean;
  mgrLiveThinkingText: string;
  mgrLiveNarrationText: string;
  mgrLiveActionLog: ActionLogEntry[];
  isMgrReconnecting: boolean;
}

export function useManagerStream() {
  const {
    addManagerMessage,
    setManagerResponding,
    setManagerPlan,
    updateTaskStatus,
    clearManagerPlan,
    isManagerResponding,
    isAiResponding,
    projectId,
  } = useIDEStore();
  const { renameProject } = useProjectStore();

  const [mgrPreparingPlan, setMgrPreparingPlan] = useState(false);
  const [mgrLiveThinkingText, setMgrLiveThinkingText] = useState("");
  const [mgrLiveNarrationText, setMgrLiveNarrationText] = useState("");
  const [mgrLiveActionLog, setMgrLiveActionLog] = useState<ActionLogEntry[]>([]);
  const [isMgrReconnecting, setIsMgrReconnecting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const mgrSessionIdRef = useRef<string | null>(null);
  const mgrLastEventIdRef = useRef<number>(-1);
  const mgrReconnectRetryRef = useRef<number>(0);
  const mgrReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mgrLiveClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountingRef = useRef(false);
  const mgrConnectionErrorAddedRef = useRef(false);
  const connectToMgrStreamRef = useRef<
    ((sessionId: string, lastEventId: number) => Promise<void>) | null
  >(null);
  const autoExecutePlanRef = useRef(false);
  const mgrInactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetInactivityTimer = useCallback(() => {
    if (mgrInactivityTimerRef.current) clearTimeout(mgrInactivityTimerRef.current);
    mgrInactivityTimerRef.current = setTimeout(() => {
      mgrInactivityTimerRef.current = null;
      if (!useIDEStore.getState().isManagerResponding) return;
      setManagerResponding(false);
      setMgrPreparingPlan(false);
      clearMgrLive(0);
      removeTypingBubble();
    }, 60_000);
  }, [setManagerResponding, setMgrPreparingPlan]);

  useEffect(() => {
    // Reset unmounting flag on each mount so the finally blocks work correctly
    isUnmountingRef.current = false;
    return () => {
      isUnmountingRef.current = true;
      if (mgrInactivityTimerRef.current) {
        clearTimeout(mgrInactivityTimerRef.current);
        mgrInactivityTimerRef.current = null;
      }
      const currentProjectId = useIDEStore.getState().projectId;
      const sessionId = mgrSessionIdRef.current;
      if (sessionId && currentProjectId) {
        try {
          localStorage.setItem(
            `cascade-mgr-session-${currentProjectId}`,
            sessionId,
          );
        } catch {}
        const existingSnap = useIDEStore.getState().streamingSnapshot;
        if (existingSnap?.type === "manager" && existingSnap.sessionId === sessionId) {
          useIDEStore.getState().setStreamingSnapshot({
            ...existingSnap,
            updatedAt: Date.now(),
            lastEventId: mgrLastEventIdRef.current,
          });
        }
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (mgrReconnectTimerRef.current) {
        clearTimeout(mgrReconnectTimerRef.current);
        mgrReconnectTimerRef.current = null;
      }
      if (mgrLiveClearTimerRef.current) {
        clearTimeout(mgrLiveClearTimerRef.current);
        mgrLiveClearTimerRef.current = null;
      }
      // Don't null mgrSessionIdRef here — remount needs it to reconnect
      mgrReconnectRetryRef.current = 0;
    };
  }, []);

  const clearMgrLive = useCallback((delay = 300) => {
    if (mgrLiveClearTimerRef.current) clearTimeout(mgrLiveClearTimerRef.current);
    mgrLiveClearTimerRef.current = setTimeout(() => {
      setMgrLiveThinkingText("");
      setMgrLiveNarrationText("");
      setMgrLiveActionLog([]);
      mgrLiveClearTimerRef.current = null;
    }, delay);
  }, []);

  const resetLiveState = useCallback(() => {
    if (mgrLiveClearTimerRef.current) {
      clearTimeout(mgrLiveClearTimerRef.current);
      mgrLiveClearTimerRef.current = null;
    }
    if (mgrInactivityTimerRef.current) {
      clearTimeout(mgrInactivityTimerRef.current);
      mgrInactivityTimerRef.current = null;
    }
    if (mgrReconnectTimerRef.current) {
      clearTimeout(mgrReconnectTimerRef.current);
      mgrReconnectTimerRef.current = null;
    }
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
      abortRef.current = null;
    }
    mgrSessionIdRef.current = null;
    mgrLastEventIdRef.current = -1;
    mgrReconnectRetryRef.current = 0;
    autoExecutePlanRef.current = false;
    setMgrLiveThinkingText("");
    setMgrLiveNarrationText("");
    setMgrLiveActionLog([]);
    setMgrPreparingPlan(false);
    setIsMgrReconnecting(false);
  }, []);

  const removeTypingBubble = useCallback((excludeId?: string | null) => {
    const msgs = useIDEStore.getState().managerMessages;
    const typingIdx = msgs.findIndex(
      (m) => m.typing === true && (!excludeId || m.id !== excludeId),
    );
    if (typingIdx !== -1) {
      useIDEStore.setState({
        managerMessages: msgs.filter((_, i) => i !== typingIdx),
      });
    }
  }, []);

  const handleManagerSend = useCallback(
    async (overrideMessage?: string, input?: string): Promise<boolean> => {
      const trimmed = overrideMessage?.trim() || input?.trim() || "";
      if (!trimmed || isManagerResponding || isAiResponding) return false;

      if (mgrLiveClearTimerRef.current) {
        clearTimeout(mgrLiveClearTimerRef.current);
        mgrLiveClearTimerRef.current = null;
      }

      addManagerMessage({ role: "user", content: trimmed });
      setManagerResponding(true);
      mgrConnectionErrorAddedRef.current = false;
      resetInactivityTimer();
      setMgrPreparingPlan(false);
      setMgrLiveThinkingText("");
      setMgrLiveNarrationText("");
      setMgrLiveActionLog([]);

      const priorManagerMsgs = useIDEStore.getState().managerMessages;
      const historyMessages = priorManagerMsgs
        .filter(
          (m: ManagerMessage) =>
            (m.role === "user" || m.role === "assistant") &&
            m.content &&
            !m.typing,
        )
        .map((m: ManagerMessage) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      const controller = new AbortController();
      abortRef.current = controller;

      let managerAccumulated = "";
      let managerThinkingAccumulated = "";
      let commAccumulated = "";
      let planEmitted = false;

      let lastMgrSnapshotFlush = 0;
      const MGR_SNAPSHOT_INTERVAL = 500;
      const flushMgrSnapshot = (sessionId: string) => {
        const now = Date.now();
        if (now - lastMgrSnapshotFlush < MGR_SNAPSHOT_INTERVAL) return;
        lastMgrSnapshotFlush = now;
        useIDEStore.getState().setStreamingSnapshot({
          type: "manager",
          thinkingText: managerThinkingAccumulated,
          narrationText: managerAccumulated,
          projectId: projectId || "",
          updatedAt: now,
          sessionId,
          lastEventId: mgrLastEventIdRef.current,
        });
      };

      try {
        const allFiles = flattenFiles(useIDEStore.getState().files);
        const fileContext = allFiles
          .filter((f) => f.path)
          .map((f) => ({ path: f.path!, content: f.content || "" }));
        const existingPlan = useIDEStore.getState().managerPlan;

        const response = await fetch("/api/manager-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: historyMessages,
            files: fileContext,
            provider: useIDEStore.getState().selectedProvider,
            existingPlan: existingPlan || undefined,
            projectId: projectId || undefined,
            framework:
              useProjectStore
                .getState()
                .projects.find((p) => p.id === projectId)?.framework ||
              undefined,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          removeTypingBubble();
          addManagerMessage({
            role: "assistant",
            content: tr(useLanguageStore.getState().lang, "chat.errorConnect"),
            source: "communicator",
          });
          return true;
        }

        const reader = response.body.getReader();

        await parseSseStream<ManagerSseEvent>(reader, {
          signal: controller.signal,
          validate: validateManagerEvent,
          onEvent: async (ev) => {
            resetInactivityTimer();
            if (typeof ev.eventId === "number") {
              mgrLastEventIdRef.current = ev.eventId;
            }

            const evType = ev.type;

            if (evType === "session_id") {
              mgrSessionIdRef.current = ev.sessionId || "";
              mgrReconnectRetryRef.current = 0;
              if (projectId && ev.sessionId) {
                try {
                  localStorage.setItem(
                    `cascade-mgr-session-${projectId}`,
                    ev.sessionId,
                  );
                } catch {}
              }
              return;
            }

            if (KNOWN_MGR_EVENT_TYPES.has(evType)) {
              const source = MGR_SOURCE_MAP[evType] || "manager";
              const monitorContent = ev.token || ev.label || evType;
              useLLMMonitorStore
                .getState()
                .addEvent(
                  source,
                  evType as LLMEventType,
                  typeof monitorContent === "string"
                    ? monitorContent
                    : String(monitorContent),
                );
            }

            const isCurrentProject =
              useIDEStore.getState().projectId === projectId;

            if (evType === "thinking_token") {
              managerThinkingAccumulated += (ev.token || "");
              if (mgrSessionIdRef.current)
                flushMgrSnapshot(mgrSessionIdRef.current);
              if (isCurrentProject)
                setMgrLiveThinkingText(managerThinkingAccumulated);
            } else if (evType === "raw_token" || evType === "manager_token") {
              managerAccumulated += ev.token;
              if (mgrSessionIdRef.current)
                flushMgrSnapshot(mgrSessionIdRef.current);
              if (isCurrentProject) {
                setMgrLiveNarrationText(
                  stripProjectNameMarker(managerAccumulated),
                );
              }
            } else if (evType === "communicator_narration_starting") {
              // Reset accumulator — live display is handled by mgrLiveNarrationText
              // in chat-panel.tsx. No typing bubble is inserted into the store here.
              commAccumulated = "";
            } else if (evType === "communicator_token") {
              commAccumulated += ev.token || "";
              if (isCurrentProject) {
                setMgrLiveNarrationText(commAccumulated);
              }
            } else if (evType === "action_log") {
              const actionEntry: ActionLogEntry = {
                type: ev.actionType || "tool_call",
                label: ev.label || "",
                detail: ev.detail || "",
                timestamp: Date.now(),
                filePath: ev.filePath || undefined,
              };
              if (isCurrentProject) {
                setMgrLiveActionLog((prev) => [...prev, actionEntry]);
              }
            } else if (evType === "plan_preparing") {
              if (isCurrentProject) setMgrPreparingPlan(true);
            } else if (evType === "plan_ready") {
              planEmitted = true;
              if (isCurrentProject) {
                // Keep mgrPreparingPlan=true until manager_done so the status
                // indicator stays active through the narration phase
                // Remove any stale typing bubbles (e.g. from reconnect path)
                removeTypingBubble();

                // Write the comm narration as a static message BEFORE the plan card,
                // so it appears above it in seq order.
                if (commAccumulated) {
                  const friendlyComm = commAccumulated.trim();
                  if (friendlyComm) {
                    addManagerMessage({
                      role: "assistant",
                      content: friendlyComm,
                      source: "communicator",
                    });
                  }
                  commAccumulated = ""; // consumed — don't write again in post-stream
                }

                const plan = ev.plan;
                clearManagerPlan();
                if (!plan) return;
                const steps = normalizeSteps(plan);
                for (const step of steps) {
                  updateTaskStatus(String(step.step), "pending");
                }
                setManagerPlan(plan);

                addManagerMessage({
                  role: "assistant",
                  content: "",
                  plan,
                  thinking: managerThinkingAccumulated || undefined,
                });

                const firstUserMsg = useIDEStore
                  .getState()
                  .managerMessages.find((m) => m.role === "user");
                const userPrompt = firstUserMsg?.content || trimmed;
                const currentAllFiles = flattenFiles(
                  useIDEStore.getState().files,
                );
                const currentFilesForServer = currentAllFiles
                  .filter((f) => f.path && !f.path.endsWith("cascade.md"))
                  .map((f) => ({ path: f.path!, content: f.content || "" }));

                generateCascade({
                  plan,
                  userPrompt,
                  currentFiles: currentFilesForServer,
                });

                if (ev.autoExecute) {
                  autoExecutePlanRef.current = true;
                }
              } else if (projectId) {
                try {
                  const savedRaw = localStorage.getItem(
                    `cascade-project-${projectId}`,
                  );
                  const saved = savedRaw ? JSON.parse(savedRaw) : null;
                  if (saved) {
                    const plan = ev.plan;
                    let msgs: ManagerMessage[] = saved.managerMessages || [];
                    msgs = msgs.filter((m: ManagerMessage) => !m.typing);
                    const seq = typeof saved._nextSeq === "number" ? saved._nextSeq : 1;
                    saved._nextSeq = seq + 1;
                    msgs.push({
                      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-plan`,
                      role: "assistant",
                      content: "",
                      plan,
                      thinking: managerThinkingAccumulated || undefined,
                      timestamp: Date.now(),
                      seq,
                    });
                    saved.managerMessages = msgs;
                    saved.managerPlan = plan;
                    const steps = normalizeSteps(plan);
                    const statuses: Record<string, string> = {};
                    for (const step of steps) {
                      statuses[String(step.step)] = "pending";
                    }
                    saved.taskStatuses = statuses;
                    saved.streamingSnapshot = null;
                    localStorage.setItem(
                      `cascade-project-${projectId}`,
                      JSON.stringify(saved),
                    );
                  }
                } catch {}
              }
            } else if (evType === "manager_done") {
              useIDEStore.getState().setStreamingSnapshot(null);
              mgrSessionIdRef.current = null;
              mgrReconnectRetryRef.current = 0;
              if (projectId) {
                try {
                  localStorage.removeItem(
                    `cascade-mgr-session-${projectId}`,
                  );
                } catch {}
              }

              if (isCurrentProject) {
                setMgrPreparingPlan(false);
                removeTypingBubble();
                clearMgrLive();
                if (
                  !useIDEStore.getState().managerPlan ||
                  !planEmitted
                ) {
                  setManagerResponding(false);
                }
              }

              if (!planEmitted && isCurrentProject) {
                let plan = ev.plan;
                if (!plan && managerAccumulated) {
                  try {
                    const jsonMatch = managerAccumulated.match(
                      /```json\s*([\s\S]*?)```/,
                    );
                    if (jsonMatch) {
                      const parsed = JSON.parse(jsonMatch[1]);
                      if (parsed && (parsed.steps || parsed.sub_tasks)) {
                        plan = parsed;
                      }
                    }
                  } catch {}
                }
                if (plan) {
                  // Late plan (arrived via manager_done instead of plan_ready)
                  // Write comm narration first, then the plan card
                  if (commAccumulated) {
                    const friendlyComm = commAccumulated.trim();
                    if (friendlyComm) {
                      addManagerMessage({
                        role: "assistant",
                        content: friendlyComm,
                        source: "communicator",
                      });
                    }
                    commAccumulated = "";
                  }
                  clearManagerPlan();
                  const steps = normalizeSteps(plan);
                  for (const step of steps) {
                    updateTaskStatus(String(step.step), "pending");
                  }
                  setManagerPlan(plan);
                  addManagerMessage({
                    role: "assistant",
                    content: "",
                    plan,
                    thinking: managerThinkingAccumulated || undefined,
                  });
                } else if (commAccumulated) {
                  // Conversational response — write the communicator message
                  const friendlyComm = commAccumulated.trim();
                  if (friendlyComm) {
                    addManagerMessage({
                      role: "assistant",
                      content: friendlyComm,
                      source: "communicator",
                      thinking: managerThinkingAccumulated || undefined,
                    });
                  }
                  commAccumulated = "";
                } else if (managerAccumulated) {
                  const stripped = stripProjectNameMarker(managerAccumulated);
                  if (stripped.trim()) {
                    addManagerMessage({
                      role: "assistant",
                      content: stripped,
                      thinking: managerThinkingAccumulated || undefined,
                    });
                  }
                }
              }

              let nameFromDone: string | undefined;
              try {
                const rawPlan = ev.plan as (ManagerPlan & { project_name?: string }) | undefined;
                if (rawPlan?.project_name && typeof rawPlan.project_name === "string") {
                  nameFromDone = rawPlan.project_name;
                }
                if (!nameFromDone && managerAccumulated) {
                  nameFromDone = managerAccumulated
                    .match(PROJECT_NAME_REGEX)?.[1]
                    ?.trim();
                }
              } catch {}

              if (nameFromDone && projectId) {
                renameProject(projectId, nameFromDone);
              }
            } else if (evType === "manager_error") {
              useIDEStore.getState().setStreamingSnapshot(null);
              mgrSessionIdRef.current = null;
              mgrReconnectRetryRef.current = 0;
              if (projectId) {
                try {
                  localStorage.removeItem(
                    `cascade-mgr-session-${projectId}`,
                  );
                } catch {}
              }
              if (isCurrentProject) {
                removeTypingBubble();
                addManagerMessage({
                  role: "assistant",
                  content: tr(
                    useLanguageStore.getState().lang,
                    "chat.errorConnect",
                  ),
                  source: "communicator",
                });
              } else if (projectId) {
                try {
                  const savedRaw = localStorage.getItem(
                    `cascade-project-${projectId}`,
                  );
                  const saved = savedRaw ? JSON.parse(savedRaw) : null;
                  if (saved) {
                    let msgs: ManagerMessage[] = saved.managerMessages || [];
                    msgs = msgs.filter((m: ManagerMessage) => !m.typing);
                    const seq = typeof saved._nextSeq === "number" ? saved._nextSeq : 1;
                    saved._nextSeq = seq + 1;
                    msgs.push({
                      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-err`,
                      role: "assistant",
                      content: tr(
                        useLanguageStore.getState().lang,
                        "chat.errorConnect",
                      ),
                      source: "communicator",
                      timestamp: Date.now(),
                      seq,
                    });
                    saved.managerMessages = msgs;
                    saved.streamingSnapshot = null;
                    localStorage.setItem(
                      `cascade-project-${projectId}`,
                      JSON.stringify(saved),
                    );
                  }
                } catch {}
              }
            }
          },
        });

        // Post-stream safety net: only write leftover comm content when no plan was
        // emitted. If a plan was emitted, plan_ready already consumed commAccumulated
        // (and reset it to ""). Any tokens that arrived after plan_ready are
        // post-plan commentary and should be discarded to avoid an orphaned bubble.
        if (
          !planEmitted &&
          useIDEStore.getState().projectId === projectId &&
          commAccumulated
        ) {
          const friendlyComm = commAccumulated.trim();
          if (friendlyComm) {
            addManagerMessage({
              role: "assistant",
              content: friendlyComm,
              source: "communicator",
              thinking: managerThinkingAccumulated || undefined,
            });
          }
          commAccumulated = "";
        }

        if (
          useIDEStore.getState().projectId === projectId &&
          managerAccumulated
        ) {
          const nameFromMarker = managerAccumulated
            .match(PROJECT_NAME_REGEX)?.[1]
            ?.trim();
          if (nameFromMarker && projectId)
            renameProject(projectId, nameFromMarker);
        }
        return true;
      } catch (error: unknown) {
        let mgrReconnectScheduled = false;
        const isAbort = error instanceof DOMException && error.name === "AbortError";
        if (!isAbort && mgrSessionIdRef.current) {
          const maxRetries = 8;
          if (mgrReconnectRetryRef.current < maxRetries) {
            mgrReconnectRetryRef.current++;
            mgrReconnectScheduled = true;
            const retrySessionId = mgrSessionIdRef.current;
            const retryLastEventId = mgrLastEventIdRef.current;
            const backoffMs = Math.min(
              1000 * Math.pow(2, mgrReconnectRetryRef.current - 1),
              16000,
            );
            mgrReconnectTimerRef.current = setTimeout(async () => {
              mgrReconnectTimerRef.current = null;
              try {
                const statusRes = await fetch(
                  `/api/manager-chat/${retrySessionId}/status`,
                );
                if (!statusRes.ok) {
                  useIDEStore.getState().setStreamingSnapshot(null);
                  mgrSessionIdRef.current = null;
                  setManagerResponding(false);
                  return;
                }
                const statusData = await statusRes.json();
                if (statusData.done || !statusData.active) {
                  useIDEStore.getState().setStreamingSnapshot(null);
                  mgrSessionIdRef.current = null;
                  setManagerResponding(false);
                  return;
                }
              } catch {
                useIDEStore.getState().setStreamingSnapshot(null);
                mgrSessionIdRef.current = null;
                setManagerResponding(false);
                return;
              }
              connectToMgrStreamRef.current?.(
                retrySessionId,
                retryLastEventId,
              );
            }, backoffMs);
          }
        }
        if (!mgrReconnectScheduled) {
          useIDEStore.getState().setStreamingSnapshot(null);
          mgrSessionIdRef.current = null;
          mgrReconnectRetryRef.current = 0;
          if (projectId) {
            try {
              localStorage.removeItem(`cascade-mgr-session-${projectId}`);
            } catch {}
          }
          if (useIDEStore.getState().projectId === projectId) {
            removeTypingBubble();
            if (!isAbort && !mgrConnectionErrorAddedRef.current) {
              mgrConnectionErrorAddedRef.current = true;
              addManagerMessage({
                role: "assistant",
                content: tr(
                  useLanguageStore.getState().lang,
                  "chat.errorConnect",
                ),
                source: "communicator",
              });
            }
            setMgrPreparingPlan(false);
            clearMgrLive();
            setManagerResponding(false);
          }
        }
        return false;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        // Clean up any stale typing bubbles (e.g. from reconnect path)
        removeTypingBubble();
        if (
          !mgrSessionIdRef.current &&
          useIDEStore.getState().projectId === projectId
        ) {
          setMgrPreparingPlan(false);
          clearMgrLive();
          setManagerResponding(false);
        }
      }
    },
    [
      isManagerResponding,
      isAiResponding,
      addManagerMessage,
      setManagerResponding,
      setManagerPlan,
      updateTaskStatus,
      projectId,
      renameProject,
      clearManagerPlan,
      clearMgrLive,
      removeTypingBubble,
      resetInactivityTimer,
    ],
  );

  const connectToMgrStream = useCallback(
    async (sessionId: string, lastEventId: number) => {
      mgrSessionIdRef.current = sessionId;

      try {
        const response = await fetch(
          `/api/manager-chat/${sessionId}/stream?lastEventId=${lastEventId}`,
        );
        if (!response.ok || !response.body) {
          useIDEStore.getState().setStreamingSnapshot(null);
          mgrSessionIdRef.current = null;
          if (projectId) {
            try {
              localStorage.removeItem(`cascade-mgr-session-${projectId}`);
            } catch {}
          }
          setManagerResponding(false);
          return;
        }

        mgrReconnectRetryRef.current = 0;

        const reader = response.body.getReader();
        const existingSnapshot = useIDEStore.getState().streamingSnapshot;
        let managerAccumulated2 =
          (existingSnapshot?.type === "manager"
            ? existingSnapshot.narrationText
            : "") || "";
        let managerThinkingAccumulated2 =
          (existingSnapshot?.type === "manager"
            ? existingSnapshot.thinkingText
            : "") || "";
        let planEmittedInReconnect = false;

        let lastMgrReconnectSnapshotFlush = 0;
        const MGR_RECONNECT_SNAPSHOT_INTERVAL = 500;
        const flushMgrReconnectSnapshot = () => {
          const now = Date.now();
          if (
            now - lastMgrReconnectSnapshotFlush <
            MGR_RECONNECT_SNAPSHOT_INTERVAL
          )
            return;
          lastMgrReconnectSnapshotFlush = now;
          useIDEStore.getState().setStreamingSnapshot({
            type: "manager",
            thinkingText: managerThinkingAccumulated2,
            narrationText: managerAccumulated2,
            projectId: projectId || "",
            updatedAt: now,
            sessionId: sessionId,
            lastEventId: mgrLastEventIdRef.current,
          });
        };

        await parseSseStream<ManagerSseEvent>(reader, {
          validate: validateManagerEvent,
          onEvent: async (ev) => {
            resetInactivityTimer();
            if (typeof ev.eventId === "number") {
              mgrLastEventIdRef.current = ev.eventId;
            }

            const evType = ev.type;
            if (evType === "session_id") return;

            const isCurrentProject =
              useIDEStore.getState().projectId === projectId;

            if (evType === "thinking_token") {
              managerThinkingAccumulated2 += (ev.token || "");
              flushMgrReconnectSnapshot();
              if (isCurrentProject)
                setMgrLiveThinkingText(managerThinkingAccumulated2);
            } else if (
              evType === "raw_token" ||
              evType === "manager_token"
            ) {
              managerAccumulated2 += ev.token;
              flushMgrReconnectSnapshot();
              if (isCurrentProject)
                setMgrLiveNarrationText(
                  stripProjectNameMarker(managerAccumulated2),
                );
            } else if (evType === "communicator_token") {
              managerAccumulated2 += ev.token || "";
              if (isCurrentProject)
                setMgrLiveNarrationText(managerAccumulated2);
            } else if (evType === "plan_ready") {
              if (isCurrentProject) {
                const plan = ev.plan;
                const msgs = useIDEStore.getState().managerMessages;
                const lastPlanIdx = msgs.findLastIndex((m: ManagerMessage) => !!m.plan);
                const existingPlan = lastPlanIdx >= 0 ? msgs[lastPlanIdx].plan : null;
                const sameSummary =
                  !!existingPlan && !!plan && existingPlan.summary === plan.summary;

                if (sameSummary) {
                  // Replay of an already-rendered plan — keep the existing card
                  // (preserves live task statuses). Just drop any typing bubbles.
                  planEmittedInReconnect = true;
                  useIDEStore.setState({
                    managerMessages: msgs.filter((m: ManagerMessage) => !m.typing),
                  });
                } else {
                  // Different plan (or first one) — strip the last plan card + typing
                  // bubbles and render the new one.
                  useIDEStore.setState({
                    managerMessages: msgs.filter((m: ManagerMessage, i: number) => !m.typing && (i !== lastPlanIdx || !m.plan)),
                  });
                  if (plan) {
                    planEmittedInReconnect = true;
                    useIDEStore.getState().clearManagerPlan();
                    const steps = normalizeSteps(plan);
                    for (const step of steps)
                      updateTaskStatus(String(step.step), "pending");
                    useIDEStore.getState().setManagerPlan(plan);
                    addManagerMessage({
                      role: "assistant",
                      content: "",
                      plan,
                      thinking: managerThinkingAccumulated2 || undefined,
                    });
                  }
                }
              }
            } else if (evType === "manager_done") {
              if (!planEmittedInReconnect && isCurrentProject && managerAccumulated2.trim()) {
                const stripped = stripProjectNameMarker(managerAccumulated2).trim();
                if (stripped) {
                  addManagerMessage({
                    role: "assistant",
                    content: stripped,
                    thinking: managerThinkingAccumulated2 || undefined,
                  });
                }
              }
              return;
            } else if (evType === "manager_error") {
              useIDEStore.getState().setStreamingSnapshot(null);
              mgrSessionIdRef.current = null;
              mgrReconnectRetryRef.current = 0;
              if (projectId) {
                try {
                  localStorage.removeItem(`cascade-mgr-session-${projectId}`);
                } catch {}
              }
              if (isCurrentProject) {
                setManagerResponding(false);
                setMgrPreparingPlan(false);
                clearMgrLive(0);
                removeTypingBubble();
                if (!mgrConnectionErrorAddedRef.current) {
                  mgrConnectionErrorAddedRef.current = true;
                  addManagerMessage({
                    role: "assistant",
                    content: tr(
                      useLanguageStore.getState().lang,
                      "chat.errorConnect",
                    ),
                    source: "communicator",
                    errorCode: "connect",
                  });
                }
              }
              return;
            }
          },
        });
      } catch (err: unknown) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        if (!isAbort && mgrSessionIdRef.current) {
          const maxRetries = 8;
          if (mgrReconnectRetryRef.current < maxRetries) {
            mgrReconnectRetryRef.current++;
            const retrySessionId = mgrSessionIdRef.current;
            const retryLastEventId = mgrLastEventIdRef.current;
            const backoffMs = Math.min(
              1000 * Math.pow(2, mgrReconnectRetryRef.current - 1),
              16000,
            );
            mgrReconnectTimerRef.current = setTimeout(async () => {
              mgrReconnectTimerRef.current = null;
              try {
                const statusRes = await fetch(
                  `/api/manager-chat/${retrySessionId}/status`,
                );
                const statusData = statusRes.ok ? await statusRes.json() : null;
                if (!statusData || statusData.done || !statusData.active) {
                  useIDEStore.getState().setStreamingSnapshot(null);
                  mgrSessionIdRef.current = null;
                  setManagerResponding(false);
                  return;
                }
              } catch {
                useIDEStore.getState().setStreamingSnapshot(null);
                mgrSessionIdRef.current = null;
                setManagerResponding(false);
                return;
              }
              connectToMgrStreamRef.current?.(
                retrySessionId,
                retryLastEventId,
              );
            }, backoffMs);
            return;
          }
          if (useIDEStore.getState().projectId === projectId && !mgrConnectionErrorAddedRef.current) {
            mgrConnectionErrorAddedRef.current = true;
            const errorContent = tr(useLanguageStore.getState().lang, "chat.errorConnect");
            const msgs = useIDEStore.getState().managerMessages;
            const last = msgs[msgs.length - 1];
            const alreadyShown =
              last &&
              last.role === "assistant" &&
              last.errorCode === "connect";
            if (!alreadyShown) {
              addManagerMessage({
                role: "assistant",
                content: errorContent,
                source: "communicator",
                errorCode: "connect",
              });
            }
          }
        }
      } finally {
        if (!mgrReconnectTimerRef.current && !isUnmountingRef.current) {
          useIDEStore.getState().setStreamingSnapshot(null);
          mgrSessionIdRef.current = null;
          if (projectId) {
            try {
              localStorage.removeItem(`cascade-mgr-session-${projectId}`);
            } catch {}
          }
          clearMgrLive();
          setManagerResponding(false);
        }
      }
    },
    [
      projectId,
      addManagerMessage,
      updateTaskStatus,
      setManagerResponding,
      clearMgrLive,
      resetInactivityTimer,
    ],
  );

  connectToMgrStreamRef.current = connectToMgrStream;

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const restorePlanFromDB = () => {
      const store = useIDEStore.getState();
      if (store.managerPlan) return;
      const localPlan = store.managerMessages.find((m) => !!m.plan)?.plan;
      if (localPlan) {
        store.setManagerPlan(localPlan);
        for (const step of localPlan.steps) {
          updateTaskStatus(String(step.step), "pending");
        }
        return;
      }
      fetch(`/api/projects/${projectId}/plan`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { plan: ManagerPlan | null } | null) => {
          if (cancelled || !data?.plan) return;
          const plan = data.plan;
          const currentStore = useIDEStore.getState();
          if (currentStore.managerPlan) return;
          const rawSteps = plan.steps ?? [];
          const steps = rawSteps.map((s, i) => ({
            ...s,
            step: s.step ?? i + 1,
          }));
          const restoredPlan: ManagerPlan = { ...plan, steps };
          store.setManagerPlan(restoredPlan);
          for (const step of steps) {
            updateTaskStatus(String(step.step), "pending");
          }
          const alreadyHasPlan = store.managerMessages.some((m) => !!m.plan);
          if (!alreadyHasPlan) {
            addManagerMessage({
              role: "assistant",
              content: plan.summary || "Plan restored from previous session.",
              plan: restoredPlan,
            });
          }
        })
        .catch(() => {});
    };

    const attemptManagerReconnect = () => {
      const snapshot = useIDEStore.getState().streamingSnapshot;
      const savedMgrSessionId = (() => {
        try {
          return localStorage.getItem(`cascade-mgr-session-${projectId}`);
        } catch {
          return null;
        }
      })();
      const sessionIdToReconnect =
        (snapshot?.type === "manager" && snapshot.projectId === projectId
          ? snapshot.sessionId
          : null) || savedMgrSessionId;

      if (snapshot?.type === "manager" && snapshot.projectId === projectId) {
        setMgrLiveThinkingText(snapshot.thinkingText || "");
        setMgrLiveNarrationText(snapshot.narrationText || "");
      }

      const fallbackToActiveEndpoint = () => {
        fetch(`/api/manager-chat/active/${projectId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((activeData) => {
            if (cancelled || !activeData?.sessionId) {
              useIDEStore.getState().setStreamingSnapshot(null);
              setManagerResponding(false);
              setMgrLiveThinkingText("");
              setMgrLiveNarrationText("");
              restorePlanFromDB();
              return;
            }
            const existingSnap = useIDEStore.getState().streamingSnapshot;
            if (existingSnap?.sessionId !== activeData.sessionId) {
              useIDEStore.getState().setStreamingSnapshot(null);
              setMgrLiveThinkingText("");
              setMgrLiveNarrationText("");
            }
            try {
              localStorage.setItem(
                `cascade-mgr-session-${projectId}`,
                activeData.sessionId,
              );
            } catch {}
            if (activeData.active) {
              setManagerResponding(true);
            }
            connectToMgrStream(activeData.sessionId, -1);
          })
          .catch(() => {
            useIDEStore.getState().setStreamingSnapshot(null);
            setManagerResponding(false);
            setMgrLiveThinkingText("");
            setMgrLiveNarrationText("");
            restorePlanFromDB();
          });
      };

      if (sessionIdToReconnect) {
        const resumeEventId =
          snapshot?.type === "manager" &&
          snapshot.sessionId === sessionIdToReconnect &&
          typeof snapshot.lastEventId === "number"
            ? snapshot.lastEventId
            : (() => {
                try {
                  const saved = localStorage.getItem(`cascade-mgr-session-${projectId}`);
                  return saved === sessionIdToReconnect ? mgrLastEventIdRef.current : -1;
                } catch { return -1; }
              })();
        setIsMgrReconnecting(true);
        fetch(`/api/manager-chat/${sessionIdToReconnect}/status`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (cancelled) { setIsMgrReconnecting(false); return; }
            if (data?.active || data?.done) {
              setIsMgrReconnecting(false);
              if (data.active) {
                setManagerResponding(true);
              }
              connectToMgrStream(sessionIdToReconnect, resumeEventId);
            } else {
              setIsMgrReconnecting(false);
              try {
                localStorage.removeItem(
                  `cascade-mgr-session-${projectId}`,
                );
              } catch {}
              fallbackToActiveEndpoint();
            }
          })
          .catch(() => {
            setIsMgrReconnecting(false);
            try {
              localStorage.removeItem(`cascade-mgr-session-${projectId}`);
            } catch {}
            fallbackToActiveEndpoint();
          });
      } else if (
        snapshot?.type === "manager" &&
        snapshot.projectId === projectId
      ) {
        setTimeout(() => {
          if (cancelled) return;
          useIDEStore.getState().setStreamingSnapshot(null);
          setManagerResponding(false);
          setMgrLiveThinkingText("");
          setMgrLiveNarrationText("");
          restorePlanFromDB();
        }, 2000);
      } else {
        restorePlanFromDB();
      }
    };

    if (mgrSessionIdRef.current) {
      const staleSessionId = mgrSessionIdRef.current;
      const snapshot = useIDEStore.getState().streamingSnapshot;
      const resumeEventId =
        snapshot?.type === "manager" &&
        snapshot.sessionId === staleSessionId &&
        typeof snapshot.lastEventId === "number"
          ? snapshot.lastEventId
          : mgrLastEventIdRef.current;

      fetch(`/api/manager-chat/${staleSessionId}/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled) return;
          const staleProjectId = data?.projectId;
          const wrongProject = staleProjectId && staleProjectId !== projectId;
          if (data?.active && !wrongProject) {
            // Session is still running for this project — reconnect directly
            setManagerResponding(true);
            connectToMgrStream(staleSessionId, resumeEventId);
          } else if (data?.done && !wrongProject) {
            // Session finished while we were away — replay to get final state
            connectToMgrStream(staleSessionId, resumeEventId);
          } else {
            // Session gone or belongs to another project
            mgrSessionIdRef.current = null;
            const snap = useIDEStore.getState().streamingSnapshot;
            if (snap?.sessionId === staleSessionId) {
              useIDEStore.getState().setStreamingSnapshot(null);
            }
            setManagerResponding(false);
            setMgrLiveThinkingText("");
            setMgrLiveNarrationText("");
            attemptManagerReconnect();
          }
        })
        .catch(() => {
          if (cancelled) return;
          mgrSessionIdRef.current = null;
          setManagerResponding(false);
          attemptManagerReconnect();
        });
    } else {
      attemptManagerReconnect();
    }

    return () => {
      cancelled = true;
    };
  }, [projectId, connectToMgrStream, setManagerResponding]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const sessionId = mgrSessionIdRef.current;
      if (!sessionId) return;
      if (isMgrReconnecting) return;
      fetch(`/api/manager-chat/${sessionId}/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          if (mgrSessionIdRef.current !== sessionId) return;
          const localLast = mgrLastEventIdRef.current;
          const serverCount = typeof data.eventCount === "number" ? data.eventCount : 0;
          const behind = serverCount > localLast + 1;
          const serverFinished = !!data.done;
          if (data.active && !behind) return;
          if (!data.active && !serverFinished) return;
          connectToMgrStreamRef
            .current?.(sessionId, localLast)
            .catch(() => {});
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [isMgrReconnecting]);

  return {
    handleManagerSend,
    mgrPreparingPlan,
    mgrLiveThinkingText,
    mgrLiveNarrationText,
    mgrLiveActionLog,
    isMgrReconnecting,
    autoExecutePlanRef,
    abortRef,
    mgrSessionIdRef,
    resetLiveState,
  };
}
