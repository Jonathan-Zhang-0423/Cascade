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
import type { ActionLogEntry, ManagerSseEvent, ManagerPlanPayload, NormalizedStep } from "../chat-types";
import {
  KNOWN_MGR_EVENT_TYPES,
  MGR_SOURCE_MAP,
  PROJECT_NAME_REGEX,
  validateManagerEvent,
} from "../chat-types";
import {
  normalizeSteps,
  stripProjectNameMarker,
  generateCodestart,
} from "../chat-utils";
import { parseSseStream } from "./useSSEStream";

export interface ManagerStreamState {
  mgrPreparingPlan: boolean;
  mgrLiveThinkingText: string;
  mgrLiveNarrationText: string;
  mgrLiveActionLog: ActionLogEntry[];
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

  const abortRef = useRef<AbortController | null>(null);
  const mgrSessionIdRef = useRef<string | null>(null);
  const mgrLastEventIdRef = useRef<number>(-1);
  const mgrReconnectRetryRef = useRef<number>(0);
  const mgrReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mgrLiveClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountingRef = useRef(false);
  const connectToMgrStreamRef = useRef<
    ((sessionId: string, lastEventId: number) => Promise<void>) | null
  >(null);
  const autoExecutePlanRef = useRef(false);

  useEffect(() => {
    return () => {
      isUnmountingRef.current = true;
      const currentProjectId = useIDEStore.getState().projectId;
      const sessionId = mgrSessionIdRef.current;
      if (sessionId && currentProjectId) {
        try {
          localStorage.setItem(
            `codestart-mgr-session-${currentProjectId}`,
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
      mgrSessionIdRef.current = null;
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

  const removeTypingBubble = useCallback(() => {
    const msgs = useIDEStore.getState().managerMessages;
    const typingIdx = msgs.findIndex((m) => m.typing === true);
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
      let commInserted = false;
      let commNarrationMsgIndex = -1;
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
                    `codestart-mgr-session-${projectId}`,
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
              commInserted = false;
              commAccumulated = "";
              commNarrationMsgIndex = -1;
              if (isCurrentProject) {
                addManagerMessage({
                  role: "assistant",
                  content: "",
                  source: "communicator",
                  typing: true,
                });
                commNarrationMsgIndex =
                  useIDEStore.getState().managerMessages.length - 1;
              }
            } else if (evType === "communicator_token") {
              if (!commInserted && isCurrentProject) {
                commInserted = true;
              }
              commAccumulated += ev.token || "";
              if (isCurrentProject) {
                setMgrLiveNarrationText(commAccumulated);
              }
            } else if (evType === "communicator_error") {
              commInserted = false;
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
                setMgrPreparingPlan(false);
                removeTypingBubble();

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
                  .filter((f) => f.path && !f.path.endsWith("codestart.md"))
                  .map((f) => ({ path: f.path!, content: f.content || "" }));

                generateCodestart({
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
                    `codestart-project-${projectId}`,
                  );
                  const saved = savedRaw ? JSON.parse(savedRaw) : null;
                  if (saved) {
                    const plan = ev.plan;
                    let msgs: ManagerMessage[] = saved.managerMessages || [];
                    msgs = msgs.filter((m: ManagerMessage) => !m.typing);
                    msgs.push({
                      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-plan`,
                      role: "assistant",
                      content: "",
                      plan,
                      thinking: managerThinkingAccumulated || undefined,
                      timestamp: Date.now(),
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
                      `codestart-project-${projectId}`,
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
                    `codestart-mgr-session-${projectId}`,
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
                } else if (managerAccumulated) {
                  const stripped =
                    stripProjectNameMarker(managerAccumulated);
                  if (stripped.trim()) {
                    removeTypingBubble();
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
                    `codestart-mgr-session-${projectId}`,
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
                    `codestart-project-${projectId}`,
                  );
                  const saved = savedRaw ? JSON.parse(savedRaw) : null;
                  if (saved) {
                    let msgs: ManagerMessage[] = saved.managerMessages || [];
                    msgs = msgs.filter((m: ManagerMessage) => !m.typing);
                    msgs.push({
                      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-err`,
                      role: "assistant",
                      content: tr(
                        useLanguageStore.getState().lang,
                        "chat.errorConnect",
                      ),
                      source: "communicator",
                      timestamp: Date.now(),
                    });
                    saved.managerMessages = msgs;
                    saved.streamingSnapshot = null;
                    localStorage.setItem(
                      `codestart-project-${projectId}`,
                      JSON.stringify(saved),
                    );
                  }
                } catch {}
              }
            }
          },
        });

        if (
          useIDEStore.getState().projectId === projectId &&
          commInserted &&
          commAccumulated &&
          commNarrationMsgIndex >= 0
        ) {
          const friendlyLines = commAccumulated
            .split("\n")
            .filter(
              (l) =>
                !l.trim().match(/^\[PLAN[_ ]SUMMARY\]/i) &&
                !l.trim().match(/^\[STEP[_ ]\d+\]/i) &&
                !l.trim().match(/^\[WHAT[_ ]AND[_ ]WHY\]/i) &&
                !l.trim().match(/^\[DONE[_ ]LOOKS[_ ]LIKE\]/i) &&
                !l.trim().match(/^\[OUT[_ ]OF[_ ]SCOPE\]/i),
            )
            .map((l) => l.trim())
            .filter(Boolean)
            .join("\n");
          const msgs = useIDEStore.getState().managerMessages;
          if (commNarrationMsgIndex < msgs.length) {
            const target = msgs[commNarrationMsgIndex];
            if (target?.role === "assistant" && !target.plan) {
              const updated = [...msgs];
              if (friendlyLines) {
                updated[commNarrationMsgIndex] = {
                  ...target,
                  content: friendlyLines,
                };
              } else {
                updated.splice(commNarrationMsgIndex, 1);
              }
              useIDEStore.setState({ managerMessages: updated });
            }
          }
        }

        if (
          useIDEStore.getState().projectId === projectId &&
          !commInserted &&
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
                if (!statusData.active && !statusData.done) {
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
              localStorage.removeItem(`codestart-mgr-session-${projectId}`);
            } catch {}
          }
          if (useIDEStore.getState().projectId === projectId) {
            removeTypingBubble();
            if (!isAbort) {
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
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (
          !mgrSessionIdRef.current &&
          useIDEStore.getState().projectId === projectId
        ) {
          removeTypingBubble();
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
              localStorage.removeItem(`codestart-mgr-session-${projectId}`);
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
              if (isCurrentProject)
                setMgrLiveNarrationText(ev.token || "");
            } else if (evType === "plan_ready") {
              if (isCurrentProject) {
                const msgs = useIDEStore.getState().managerMessages;
                const typingIdx = msgs.findIndex((m) => m.typing === true);
                if (typingIdx !== -1) {
                  useIDEStore.setState({
                    managerMessages: msgs.filter((_, i) => i !== typingIdx),
                  });
                }
                const plan = ev.plan;
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
            } else if (
              evType === "manager_done" ||
              evType === "manager_error"
            ) {
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
                if (!statusData || (!statusData.active && !statusData.done)) {
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
        }
      } finally {
        if (!mgrReconnectTimerRef.current && !isUnmountingRef.current) {
          useIDEStore.getState().setStreamingSnapshot(null);
          mgrSessionIdRef.current = null;
          if (projectId) {
            try {
              localStorage.removeItem(`codestart-mgr-session-${projectId}`);
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
    ],
  );

  connectToMgrStreamRef.current = connectToMgrStream;

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const attemptManagerReconnect = () => {
      const snapshot = useIDEStore.getState().streamingSnapshot;
      const savedMgrSessionId = (() => {
        try {
          return localStorage.getItem(`codestart-mgr-session-${projectId}`);
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
        setManagerResponding(true);
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
                `codestart-mgr-session-${projectId}`,
                activeData.sessionId,
              );
            } catch {}
            setManagerResponding(true);
            connectToMgrStream(activeData.sessionId, -1);
          })
          .catch(() => {
            useIDEStore.getState().setStreamingSnapshot(null);
            setManagerResponding(false);
            setMgrLiveThinkingText("");
            setMgrLiveNarrationText("");
          });
      };

      if (sessionIdToReconnect) {
        const resumeEventId =
          snapshot?.type === "manager" &&
          typeof snapshot.lastEventId === "number"
            ? snapshot.lastEventId
            : -1;
        fetch(`/api/manager-chat/${sessionIdToReconnect}/status`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (cancelled) return;
            if (data?.active) {
              setManagerResponding(true);
              connectToMgrStream(sessionIdToReconnect, resumeEventId);
            } else if (data?.done) {
              setManagerResponding(true);
              connectToMgrStream(sessionIdToReconnect, resumeEventId);
            } else {
              try {
                localStorage.removeItem(
                  `codestart-mgr-session-${projectId}`,
                );
              } catch {}
              fallbackToActiveEndpoint();
            }
          })
          .catch(() => {
            try {
              localStorage.removeItem(`codestart-mgr-session-${projectId}`);
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
        }, 2000);
      }
    };

    if (mgrSessionIdRef.current) {
      const staleSessionId = mgrSessionIdRef.current;
      fetch(`/api/manager-chat/${staleSessionId}/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled) return;
          if (!data?.active) {
            mgrSessionIdRef.current = null;
            const snap = useIDEStore.getState().streamingSnapshot;
            if (snap?.sessionId === staleSessionId) {
              useIDEStore.getState().setStreamingSnapshot(null);
            }
            setManagerResponding(false);
            setMgrLiveThinkingText("");
            setMgrLiveNarrationText("");
          }
          const staleProjectId = data?.projectId;
          if (
            !data?.active ||
            (staleProjectId && staleProjectId !== projectId)
          ) {
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

  return {
    handleManagerSend,
    mgrPreparingPlan,
    mgrLiveThinkingText,
    mgrLiveNarrationText,
    mgrLiveActionLog,
    autoExecutePlanRef,
    abortRef,
    mgrSessionIdRef,
  };
}
