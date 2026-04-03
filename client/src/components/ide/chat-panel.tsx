import { useState, useRef, useEffect, useCallback } from "react";
import {
  useIDEStore,
  type ChatMessage,
  type ManagerMessage,
  type AIProvider,
  type BuildResultData,
  flattenFiles,
} from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import {
  useLLMMonitorStore,
  type LLMEventType,
} from "@/stores/llm-monitor-store";
import { useLanguageStore } from "@/stores/language-store";
import { useT, tr } from "@/lib/i18n";
import { toast } from "@/hooks/use-toast";
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
  Sparkles,
  Lightbulb,
  X,
  Check,
  Loader2,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";

import type { ActionLogEntry, CodeBlock } from "./chat/chat-types";
import {
  KNOWN_MGR_EVENT_TYPES,
  MGR_SOURCE_MAP,
  KNOWN_BUILD_EVENT_TYPES,
  BUILD_SOURCE_MAP,
  PROJECT_NAME_REGEX,
} from "./chat/chat-types";
import {
  detectLanguage,
  normalizeSteps,
  stripProjectNameMarker,
  parseCodeBlocks,
  extractCodeBlocks,
  t,
  usePlanCardLang,
  generateCodestart,
} from "./chat/chat-utils";
import { ActionLogLive, ActionLogCollapsed } from "./chat/action-log";
import {
  MessageBubble,
  CheckpointMarker,
  TypingIndicator,
  BuildCompletionCard,
} from "./chat/message-components";
import { ManagerMessageBubble } from "./chat/plan-components";

export type { ActionLogEntry } from "./chat/chat-types";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const {
    chatMessages,
    addChatMessage,
    updateLastAssistantMessage,
    setActiveTool,
    isAiResponding,
    setAiResponding,
    files,
    pendingPrompt,
    clearPendingPrompt,
    projectId,
    refreshPreview,
    createCheckpoint,
    chatMode,
    setChatMode,
    managerPlan,
    setManagerPlan,
    managerMessages,
    addManagerMessage,
    taskStatuses,
    taskFailureReasons,
    updateTaskStatus,
    setTaskFailureReason,
    executingTaskIndex,
    setExecutingTaskIndex,
    isManagerResponding,
    setManagerResponding,
    clearManagerPlan,
    pendingConfirmation,
    setPendingConfirmation,
    userConfirmationInput,
    setUserConfirmationInput,
    reviewPhase,
    setReviewPhase,
    holisticReview,
    setHolisticReview,
    fixCycle,
    setFixCycle,
    selectedProvider,
    setSelectedProvider,
  } = useIDEStore();
  const { renameProject } = useProjectStore();
  const planCardLang = usePlanCardLang();
  const tGlobal = useT();
  const chatTitle = tGlobal("chat.title");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingHandled = useRef(false);
  const buildSessionIdRef = useRef<string | null>(null);
  const buildReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );
  const userConfirmationRef = useRef<string>("");
  const autoExecutePlanRef = useRef(false);
  const handleExecutePlanRef = useRef<(() => Promise<void>) | null>(null);
  const connectToBuildStreamRef = useRef<
    ((sessionId: string, lastEventId: number) => Promise<void>) | null
  >(null);
  const [autoAppliedMessageIds] = useState<Set<string>>(new Set());
  const [appliedBlockIndices] = useState<Set<number>>(new Set());
  const [smartResponseLoading, setSmartResponseLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [buildPhase, setBuildPhase] = useState<
    "thinking" | "working" | "verifying" | "fixing" | null
  >(null);
  const inputBoxRef = useRef<HTMLDivElement>(null);
  const [providers, setProviders] = useState<{
    doubao: boolean;
    kimi: boolean;
    minimax: boolean;
    glm: boolean;
  }>({ doubao: true, kimi: false, minimax: false, glm: false });
  const [liveActionLog, setLiveActionLog] = useState<ActionLogEntry[]>([]);
  const [liveThinkingText, setLiveThinkingText] = useState<string>("");
  const [liveNarrationText, setLiveNarrationText] = useState<string>("");
  const [mgrPreparingPlan, setMgrPreparingPlan] = useState(false);
  const [mgrLiveThinkingText, setMgrLiveThinkingText] = useState<string>("");
  const [mgrLiveNarrationText, setMgrLiveNarrationText] = useState<string>("");
  const [mgrLiveActionLog, setMgrLiveActionLog] = useState<ActionLogEntry[]>(
    [],
  );
  const actionLogRef = useRef<ActionLogEntry[]>([]);
  const thinkingFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const mgrLiveClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const buildLiveClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const buildResultMsgIdRef = useRef<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const lastReceivedEventIdRef = useRef<number>(-1);
  const reconnectRetryRef = useRef<number>(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReconnectingRef = useRef(false);
  const heartbeatWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mgrSessionIdRef = useRef<string | null>(null);
  const mgrLastEventIdRef = useRef<number>(-1);
  const mgrReconnectRetryRef = useRef<number>(0);
  const mgrReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectToMgrStreamRef = useRef<
    ((sessionId: string, lastEventId: number) => Promise<void>) | null
  >(null);

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
          if (current === "kimi" && !loaded.kimi) setSelectedProvider("doubao");
          if (current === "minimax" && !loaded.minimax)
            setSelectedProvider("doubao");
          if (current === "glm" && !loaded.glm) setSelectedProvider("doubao");
        },
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20;
    el.style.height = Math.min(el.scrollHeight, lineHeight * 10) + "px";
  }, [input]);

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
    const handleClickOutside = (e: MouseEvent) => {
      if (
        modeDropdownRef.current &&
        !modeDropdownRef.current.contains(e.target as Node)
      ) {
        setModeDropdownOpen(false);
      }
    };
    if (modeDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [modeDropdownOpen]);

  useEffect(() => {
    return () => {
      if (mgrLiveClearTimerRef.current) {
        clearTimeout(mgrLiveClearTimerRef.current);
        mgrLiveClearTimerRef.current = null;
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

  const BLOCKING_EVENTS = new Set(["needs_input", "plan_created"]);

  const callCommunicatorCore = useCallback(
    async (event: {
      event: string;
      userLanguage?: string;
      planSummary?: string;
      totalSteps?: number;
      stepTitles?: string[];
      stepNumber?: number;
      stepTitle?: string;
      stepDescription?: string;
      errorSummary?: string;
      confirmationItems?: string[];
      retryAttempt?: number;
      maxRetries?: number;
      reviewSummary?: string;
      bugCount?: number;
      fixCycle?: number;
      maxFixCycles?: number;
      whatAndWhy?: string;
      doneLooksLike?: string;
      outOfScope?: string;
      relevantFiles?: string[];
      changedFiles?: string[];
    }): Promise<string> => {
      let messageInserted = false;
      try {
        const response = await fetch("/api/communicator-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event }),
        });

        if (!response.ok) return "";

        const reader = response.body?.getReader();
        if (!reader) return "";

        const decoder = new TextDecoder();
        let accumulated = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith("data: ")) {
              const data = trimmedLine.slice(6).trim();
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  accumulated += parsed.content;
                  useLLMMonitorStore
                    .getState()
                    .addEvent(
                      "communicator",
                      "communicator_token",
                      parsed.content,
                    );
                  if (!messageInserted) {
                    addManagerMessage({
                      role: "assistant",
                      content: accumulated,
                      source: "communicator",
                    });
                    messageInserted = true;
                  } else {
                    const msgs = useIDEStore.getState().managerMessages;
                    const lastMsg = msgs[msgs.length - 1];
                    if (lastMsg && lastMsg.role === "assistant") {
                      useIDEStore.setState({
                        managerMessages: [
                          ...msgs.slice(0, -1),
                          { ...lastMsg, content: accumulated },
                        ],
                      });
                    }
                  }
                }
              } catch {}
            }
          }
        }

        return accumulated;
      } catch {
        return "";
      }
    },
    [addManagerMessage],
  );

  const callCommunicator = useCallback(
    async (
      event: Parameters<typeof callCommunicatorCore>[0],
    ): Promise<string> => {
      if (BLOCKING_EVENTS.has(event.event)) {
        return callCommunicatorCore(event);
      }
      callCommunicatorCore(event).catch(() => {});
      return "";
    },
    [callCommunicatorCore],
  );

  const handleManagerSend = useCallback(
    async (overrideMessage?: string) => {
      const trimmed = overrideMessage?.trim() || input.trim();
      if (!trimmed || isManagerResponding || isAiResponding) return;

      if (mgrLiveClearTimerRef.current) {
        clearTimeout(mgrLiveClearTimerRef.current);
        mgrLiveClearTimerRef.current = null;
      }

      const removeTypingBubble = () => {
        const msgs = useIDEStore.getState().managerMessages;
        const typingIdx = msgs.findIndex((m) => m.typing === true);
        if (typingIdx !== -1) {
          useIDEStore.setState({
            managerMessages: msgs.filter((_, i) => i !== typingIdx),
          });
        }
      };

      const isNewConversation =
        !useIDEStore.getState().managerMessages.some((m) => m.role === "user");

      addManagerMessage({ role: "user", content: trimmed });
      if (!overrideMessage) setInput("");
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
            framework: useProjectStore.getState().projects.find((p) => p.id === projectId)?.framework || undefined,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          removeTypingBubble();
          addManagerMessage({
            role: "assistant",
            content: tr(
              useLanguageStore.getState().lang,
              "chat.errorConnect",
            ),
            source: "communicator",
          });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bufferStr = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          bufferStr += decoder.decode(value, { stream: true });
          const lines = bufferStr.split("\n");
          bufferStr = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith("data: ")) continue;
            const raw = trimmedLine.slice(6).trim();
            if (raw === "[DONE]") break;

            let ev: any;
            try {
              ev = JSON.parse(raw);
            } catch {
              continue;
            }

            if (typeof ev.eventId === "number") {
              mgrLastEventIdRef.current = ev.eventId;
            }

            const evType = ev.type;

            if (evType === "session_id") {
              mgrSessionIdRef.current = ev.sessionId;
              mgrReconnectRetryRef.current = 0;
              if (projectId && ev.sessionId) {
                try {
                  localStorage.setItem(`codestart-mgr-session-${projectId}`, ev.sessionId);
                } catch {}
              }
              continue;
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
              managerThinkingAccumulated += (ev.token as string) || "";
              if (mgrSessionIdRef.current) flushMgrSnapshot(mgrSessionIdRef.current);
              if (isCurrentProject)
                setMgrLiveThinkingText(managerThinkingAccumulated);
            } else if (
              evType === "raw_token" ||
              evType === "manager_token"
            ) {
              managerAccumulated += ev.token;
              if (mgrSessionIdRef.current) flushMgrSnapshot(mgrSessionIdRef.current);
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
                type: (ev.actionType as ActionLogEntry["type"]) || "tool_call",
                label: (ev.label as string) || "",
                detail: (ev.detail as string) || "",
                timestamp: Date.now(),
                filePath: (ev.filePath as string) || undefined,
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
                  .filter(
                    (f) => f.path && !f.path.endsWith("codestart.md"),
                  )
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
                    let msgs: ManagerMessage[] =
                      saved.managerMessages || [];
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
                try { localStorage.removeItem(`codestart-mgr-session-${projectId}`); } catch {}
              }

              if (isCurrentProject) {
                setMgrPreparingPlan(false);
                removeTypingBubble();
                if (mgrLiveClearTimerRef.current) clearTimeout(mgrLiveClearTimerRef.current);
                mgrLiveClearTimerRef.current = setTimeout(() => {
                  setMgrLiveThinkingText("");
                  setMgrLiveNarrationText("");
                  setMgrLiveActionLog([]);
                  mgrLiveClearTimerRef.current = null;
                }, 300);
                if (!buildSessionIdRef.current) {
                  setManagerResponding(false);
                }
              }

              if (!planEmitted && isCurrentProject) {
                let plan = ev.plan;
                if (!plan && managerAccumulated) {
                  try {
                    const jsonMatch = managerAccumulated.match(/```json\s*([\s\S]*?)```/);
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
                  const stripped = stripProjectNameMarker(managerAccumulated);
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
                if (ev.plan && ev.plan.project_name) {
                  nameFromDone = ev.plan.project_name;
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
                try { localStorage.removeItem(`codestart-mgr-session-${projectId}`); } catch {}
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
                  const savedRaw = localStorage.getItem(`codestart-project-${projectId}`);
                  const saved = savedRaw ? JSON.parse(savedRaw) : null;
                  if (saved) {
                    let msgs: ManagerMessage[] = saved.managerMessages || [];
                    msgs = msgs.filter((m: ManagerMessage) => !m.typing);
                    msgs.push({
                      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-err`,
                      role: "assistant",
                      content: tr(useLanguageStore.getState().lang, "chat.errorConnect"),
                      source: "communicator",
                      timestamp: Date.now(),
                    });
                    saved.managerMessages = msgs;
                    saved.streamingSnapshot = null;
                    localStorage.setItem(`codestart-project-${projectId}`, JSON.stringify(saved));
                  }
                } catch {}
              }
            }
          }
        }

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
          if (nameFromMarker && projectId) renameProject(projectId, nameFromMarker);
        }
      } catch (error: any) {
        let mgrReconnectScheduled = false;
        if (error?.name !== "AbortError" && mgrSessionIdRef.current) {
          const maxRetries = 8;
          if (mgrReconnectRetryRef.current < maxRetries) {
            mgrReconnectRetryRef.current++;
            mgrReconnectScheduled = true;
            const retrySessionId = mgrSessionIdRef.current;
            const retryLastEventId = mgrLastEventIdRef.current;
            const backoffMs = Math.min(1000 * Math.pow(2, mgrReconnectRetryRef.current - 1), 16000);
            mgrReconnectTimerRef.current = setTimeout(async () => {
              mgrReconnectTimerRef.current = null;
              try {
                const statusRes = await fetch(`/api/manager-chat/${retrySessionId}/status`);
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
              connectToMgrStreamRef.current?.(retrySessionId, retryLastEventId);
            }, backoffMs);
          }
        }
        if (!mgrReconnectScheduled) {
          useIDEStore.getState().setStreamingSnapshot(null);
          mgrSessionIdRef.current = null;
          mgrReconnectRetryRef.current = 0;
          if (projectId) {
            try { localStorage.removeItem(`codestart-mgr-session-${projectId}`); } catch {}
          }
          if (useIDEStore.getState().projectId === projectId) {
            removeTypingBubble();
            if (error?.name !== "AbortError") {
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
            if (mgrLiveClearTimerRef.current) clearTimeout(mgrLiveClearTimerRef.current);
            mgrLiveClearTimerRef.current = setTimeout(() => {
              setMgrLiveThinkingText("");
              setMgrLiveNarrationText("");
              setMgrLiveActionLog([]);
              mgrLiveClearTimerRef.current = null;
            }, 300);
            if (!buildSessionIdRef.current) {
              setManagerResponding(false);
            }
          }
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (!mgrSessionIdRef.current && useIDEStore.getState().projectId === projectId) {
          removeTypingBubble();
          setMgrPreparingPlan(false);
          if (mgrLiveClearTimerRef.current) {
            clearTimeout(mgrLiveClearTimerRef.current);
          }
          mgrLiveClearTimerRef.current = setTimeout(() => {
            setMgrLiveThinkingText("");
            setMgrLiveNarrationText("");
            setMgrLiveActionLog([]);
            mgrLiveClearTimerRef.current = null;
          }, 300);
          if (!buildSessionIdRef.current) {
            setManagerResponding(false);
          }
        }
      }
    },
    [
      input,
      isManagerResponding,
      isAiResponding,
      files,
      addManagerMessage,
      setManagerResponding,
      setManagerPlan,
      updateTaskStatus,
      projectId,
      renameProject,
      chatMode,
      clearManagerPlan,
    ],
  );

  const handleEditorSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isAiResponding || isManagerResponding) return;

    const priorMsgs = useIDEStore.getState().chatMessages;
    const isFirstUserMessage = !priorMsgs.some((m) => m.role === "user");

    const messagesForApi = [
      ...priorMsgs
        .filter(
          (m) => (m.role === "user" || m.role === "assistant") && m.content,
        )
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      { role: "user" as const, content: trimmed },
    ];

    addChatMessage({ role: "user", content: trimmed });
    addChatMessage({ role: "assistant", content: "" });
    setInput("");
    setAiResponding(true);

    const allFiles = flattenFiles(files);
    const fileContext = allFiles.map((f) => ({
      path: f.path,
      content: f.content || "",
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulated = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messagesForApi,
          files: fileContext,
          provider: useIDEStore.getState().selectedProvider,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        updateLastAssistantMessage(
          tr(useLanguageStore.getState().lang, "chat.errorConnect"),
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bufferStr = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        bufferStr += decoder.decode(value, { stream: true });
        const lines = bufferStr.split("\n");
        bufferStr = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith("data: ")) continue;
          const raw = trimmedLine.slice(6).trim();
          if (raw === "[DONE]") break outer;

          let ev: any;
          try {
            ev = JSON.parse(raw);
          } catch {
            continue;
          }

          if (ev.type === "narration_token" && typeof ev.token === "string") {
            accumulated += ev.token;
            useLLMMonitorStore
              .getState()
              .addEvent("editor-chat", "editor_token", ev.token);
            updateLastAssistantMessage(stripProjectNameMarker(accumulated));
            await new Promise<void>((r) => setTimeout(r, 0));
          } else if (
            ev.type === "thinking_token" &&
            typeof ev.token === "string"
          ) {
            useLLMMonitorStore
              .getState()
              .addEvent("editor-chat", "thinking_token", ev.token);
          } else if (
            ev.type === "code_applied" &&
            ev.filePath &&
            typeof ev.code === "string"
          ) {
            await applyCodeBlock({
              filePath: ev.filePath,
              code: ev.code,
              language: "",
            });
          } else if (ev.type === "action_log") {
            useLLMMonitorStore
              .getState()
              .addEvent("editor-chat", "action_log", JSON.stringify(ev));
          }
        }
      }

      if (isFirstUserMessage && projectId) {
        const nameFromMarker = accumulated
          .match(PROJECT_NAME_REGEX)?.[1]
          ?.trim();
        if (nameFromMarker && projectId) renameProject(projectId, nameFromMarker);
      }

      const stripped = stripProjectNameMarker(accumulated);
      updateLastAssistantMessage(stripped);

      createCheckpoint("AI response");
    } catch (error: any) {
      if (error?.name === "AbortError") {
        if (!accumulated) {
          const msgs = useIDEStore.getState().chatMessages;
          const lastIdx = msgs.length - 1;
          if (
            lastIdx >= 0 &&
            msgs[lastIdx].role === "assistant" &&
            msgs[lastIdx].content === ""
          ) {
            useIDEStore.setState({ chatMessages: msgs.slice(0, lastIdx) });
          }
        }
      } else {
        updateLastAssistantMessage(
          tr(useLanguageStore.getState().lang, "chat.errorConnect"),
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setAiResponding(false);
    }
  }, [
    input,
    isAiResponding,
    isManagerResponding,
    files,
    addChatMessage,
    updateLastAssistantMessage,
    setAiResponding,
    projectId,
    renameProject,
    createCheckpoint,
  ]);

  const finalizeSessionCleanup = useCallback(() => {
    isReconnectingRef.current = false;
    setIsReconnecting(false);
    buildSessionIdRef.current = null;
    buildReaderRef.current = null;
    if (projectId) {
      try { localStorage.removeItem(`codestart-build-session-${projectId}`); } catch {}
    }
    setBuildPhase(null);
    setExecutingTaskIndex(null);
    setAiResponding(false);
  }, [projectId]);

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

    const sessionId = (crypto as any).randomUUID
      ? (crypto as any).randomUUID()
      : Math.random().toString(36).slice(2);
    buildSessionIdRef.current = sessionId;
    lastReceivedEventIdRef.current = -1;
    reconnectRetryRef.current = 0;
    if (projectId) {
      try {
        localStorage.setItem(`codestart-build-session-${projectId}`, sessionId);
      } catch {}
    }

    let commAccumulated2 = "";
    let commMsgIndex = -1;
    let editorAccumulated = "";
    let thinkingAccumulated = "";

    let lastPrimaryBuildSnapshotFlush = 0;
    const PRIMARY_BUILD_SNAPSHOT_INTERVAL = 500;
    const flushPrimaryBuildSnapshot = () => {
      const now = Date.now();
      if (now - lastPrimaryBuildSnapshotFlush < PRIMARY_BUILD_SNAPSHOT_INTERVAL) return;
      lastPrimaryBuildSnapshotFlush = now;
      useIDEStore.getState().setStreamingSnapshot({
        type: "build",
        thinkingText: thinkingAccumulated,
        narrationText: commAccumulated2,
        sessionId: sessionId,
        projectId: projectId || "",
        updatedAt: now,
        lastEventId: lastReceivedEventIdRef.current,
      });
    };

    actionLogRef.current = [];
    setLiveActionLog([]);
    setLiveThinkingText("");
    buildResultMsgIdRef.current = null;

    const appendActionLog = (entry: ActionLogEntry) => {
      actionLogRef.current = [...actionLogRef.current, entry];
      setLiveActionLog([...actionLogRef.current]);
    };

    const flushNarrationToStore = () => {
      if (!commAccumulated2) return;
      const isCurrentProject2 = useIDEStore.getState().projectId === projectId;
      if (!isCurrentProject2) return;
      const content = commAccumulated2;
      if (commMsgIndex === -1) {
        addManagerMessage({
          role: "assistant",
          content,
          source: "communicator",
        });
        commMsgIndex = useIDEStore.getState().managerMessages.length - 1;
      } else {
        const msgs = useIDEStore.getState().managerMessages;
        const target = msgs[commMsgIndex];
        if (target?.role === "assistant") {
          const updated = [...msgs];
          updated[commMsgIndex] = { ...target, content };
          useIDEStore.setState({ managerMessages: updated });
        }
      }
    };

    const flushThinkingToStore = () => {
      const isCurrentProject2 = useIDEStore.getState().projectId === projectId;
      if (!isCurrentProject2) return;
      const msgs = useIDEStore.getState().managerMessages;
      let idx = commMsgIndex;
      if (idx === -1 || !msgs[idx] || msgs[idx].role !== "assistant") {
        const fallbackIdx = [...msgs]
          .reverse()
          .findIndex((m) => m.typing === true && m.role === "assistant");
        idx = fallbackIdx !== -1 ? msgs.length - 1 - fallbackIdx : -1;
      }
      if (idx === -1) {
        addManagerMessage({
          role: "assistant",
          content: "",
          source: "communicator",
          typing: true,
        });
        commMsgIndex = useIDEStore.getState().managerMessages.length - 1;
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
      commAccumulated2 = "";
      commMsgIndex = -1;
      thinkingAccumulated = "";
    };

    const clearTypingOnCurrentMsg = () => {
      const isCurrentProject2 = useIDEStore.getState().projectId === projectId;
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
          framework: useProjectStore.getState().projects.find((p) => p.id === projectId)?.framework || undefined,
        }),
      });

      if (!response.ok) {
        addManagerMessage({
          role: "assistant",
          content: tr(useLanguageStore.getState().lang, "chat.errorBuildStart"),
          source: "communicator",
        });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;
      buildReaderRef.current = reader;

      const decoder = new TextDecoder();
      let buffer = "";
      let streamDone = false;

      const HEARTBEAT_TIMEOUT_MS = 15000;
      let heartbeatTimedOut = false;
      const resetPostHeartbeat = () => {
        if (heartbeatWatchdogRef.current) {
          clearTimeout(heartbeatWatchdogRef.current);
        }
        heartbeatWatchdogRef.current = setTimeout(() => {
          heartbeatWatchdogRef.current = null;
          heartbeatTimedOut = true;
          try { reader.cancel(); } catch {}
        }, HEARTBEAT_TIMEOUT_MS);
      };
      resetPostHeartbeat();

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) {
          if (heartbeatTimedOut) throw new Error("heartbeat_timeout");
          break;
        }

        resetPostHeartbeat();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const raw = trimmed.slice(6).trim();
          if (raw === "[DONE]") {
            streamDone = true;
            break;
          }

          let ev: any;
          try {
            ev = JSON.parse(raw);
          } catch {
            continue;
          }

          if (typeof ev.eventId === "number") {
            lastReceivedEventIdRef.current = ev.eventId;
          }

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
            finalizeEditor();
            resetNarration();
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
            const stepNum = (ev.stepNumber as number) ?? 1;
            const stepTitle = (ev.stepTitle as string) || "";
            const totalSteps =
              (ev.totalSteps as number) || normalizedSteps2.length;
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
              commAccumulated2 = "";
              addManagerMessage({
                role: "assistant",
                content: stepLabel,
                source: "communicator",
                typing: true,
              });
              commMsgIndex = useIDEStore.getState().managerMessages.length - 1;
            }
            await new Promise<void>((r) => setTimeout(r, 0));
          } else if (type === "thinking_token") {
            const token = (ev.token as string) || "";
            if (token) {
              if (thinkingFadeTimerRef.current) {
                clearTimeout(thinkingFadeTimerRef.current);
                thinkingFadeTimerRef.current = null;
              }
              if (buildLiveClearTimerRef.current) {
                clearTimeout(buildLiveClearTimerRef.current);
                buildLiveClearTimerRef.current = null;
              }
              thinkingAccumulated += token;
              flushThinkingToStore();
              flushPrimaryBuildSnapshot();
              setLiveThinkingText(thinkingAccumulated);
              await new Promise<void>((r) => setTimeout(r, 16));
            }
            setBuildPhase("thinking");
          } else if (type === "action_log") {
            const actionType =
              (ev.actionType as ActionLogEntry["type"]) || "tool_call";
            const label = (ev.label as string) || "";
            const detail = (ev.detail as string) || "";
            const filePath = (ev.filePath as string) || undefined;
            if (thinkingAccumulated) {
              const existing = actionLogRef.current;
              const lastIsThinking =
                existing.length > 0 &&
                existing[existing.length - 1].type === "thinking";
              if (!lastIsThinking) {
                appendActionLog({
                  type: "thinking",
                  label: "Thinking",
                  detail: thinkingAccumulated,
                  timestamp: Date.now(),
                });
              }
              thinkingAccumulated = "";
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
            if (thinkingAccumulated) {
              const existing = actionLogRef.current;
              const lastIsThinking =
                existing.length > 0 &&
                existing[existing.length - 1].type === "thinking";
              if (!lastIsThinking) {
                appendActionLog({
                  type: "thinking",
                  label: "Thinking",
                  detail: thinkingAccumulated,
                  timestamp: Date.now(),
                });
              }
              thinkingAccumulated = "";
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
            commAccumulated2 += ev.token || "";
            flushPrimaryBuildSnapshot();
            setLiveNarrationText(commAccumulated2);
            setBuildPhase("working");
            await new Promise<void>((r) => setTimeout(r, 16));
          } else if (type === "editor_token") {
            editorAccumulated += ev.token || "";
            setBuildPhase("working");
          } else if (type === "code_applied") {
            setBuildPhase("working");
          } else if (
            type === "step_completed" ||
            type === "step_failed" ||
            type === "step_cancelled"
          ) {
            clearTypingOnCurrentMsg();
            finalizeEditor();
            flushNarrationToStore();
            setLiveNarrationText("");
          } else if (type === "reviewing") {
            flushNarrationToStore();
            resetNarration();
            setLiveNarrationText("");
            setBuildPhase("verifying");
          } else if (type === "bugs_found") {
            setBuildPhase("fixing");
          } else if (type === "fixing") {
            setBuildPhase("fixing");
          } else if (type === "all_complete") {
            if (useIDEStore.getState().projectId === projectId) {
              createCheckpoint("Build complete", {
                includeManagerThread: true,
              });
            }
            const changedFiles = (ev.changedFiles as string[]) || [];
            const planSummary = (ev.summary as string) || "";
            const finalLog = [...actionLogRef.current];
            if (useIDEStore.getState().projectId === projectId) {
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
            }
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
                const decoder2 = new TextDecoder();
                let accumulated2 = "";
                let buffer2 = "";
                while (true) {
                  const { done: done2, value: value2 } = await reader2.read();
                  if (done2) break;
                  buffer2 += decoder2.decode(value2, { stream: true });
                  const lines2 = buffer2.split("\n");
                  buffer2 = lines2.pop() || "";
                  for (const line2 of lines2) {
                    const trimmed2 = line2.trim();
                    if (!trimmed2.startsWith("data: ")) continue;
                    const data2 = trimmed2.slice(6).trim();
                    if (data2 === "[DONE]") break;
                    try {
                      const parsed2 = JSON.parse(data2);
                      if (parsed2.content) {
                        accumulated2 += parsed2.content;
                        useLLMMonitorStore
                          .getState()
                          .addEvent(
                            "communicator",
                            "communicator_summary",
                            parsed2.content,
                          );
                        const curMsgs2 = useIDEStore.getState().managerMessages;
                        if (!curMsgs2.some((m) => m.id === targetMsgId)) break;
                        const updated2 = curMsgs2.map((m) =>
                          m.id === targetMsgId && m.buildResult
                            ? {
                                ...m,
                                buildResult: {
                                  ...m.buildResult,
                                  completionData: {
                                    ...m.buildResult.completionData,
                                    summary: accumulated2,
                                  },
                                },
                              }
                            : m,
                        );
                        useIDEStore.setState({ managerMessages: updated2 });
                      }
                    } catch {}
                  }
                }
              } catch {}
            })();
          } else if (type === "done") {
            finalizeEditor();
            flushNarrationToStore();
            setLiveNarrationText("");
            const finalLog = [...actionLogRef.current];
            if (thinkingAccumulated && finalLog.length > 0) {
              const lastIsThinking =
                finalLog[finalLog.length - 1].type === "thinking";
              if (!lastIsThinking) {
                finalLog.push({
                  type: "thinking",
                  label: "Thinking",
                  detail: thinkingAccumulated,
                  timestamp: Date.now(),
                });
              }
            }
            if (finalLog.length > 0) {
              const msgId = buildResultMsgIdRef.current;
              if (msgId) {
                const curMsgs = useIDEStore.getState().managerMessages;
                const updated = curMsgs.map((m) =>
                  m.id === msgId && m.buildResult
                    ? {
                        ...m,
                        buildResult: { ...m.buildResult, actionLog: finalLog },
                      }
                    : m,
                );
                useIDEStore.setState({ managerMessages: updated });
              } else if (useIDEStore.getState().projectId === projectId) {
                const buildResult: BuildResultData = {
                  actionLog: finalLog,
                  completionData: { changedFiles: [], userLang },
                };
                const doneMsgs = useIDEStore.getState().managerMessages;
                const donePlanMsg = [...doneMsgs].reverse().find((m) => m.plan);
                if (donePlanMsg) {
                  const updated = doneMsgs.map((m) =>
                    m.id === donePlanMsg.id ? { ...m, buildResult } : m,
                  );
                  useIDEStore.setState({ managerMessages: updated });
                  buildResultMsgIdRef.current = donePlanMsg.id;
                } else {
                  addManagerMessage({
                    role: "assistant",
                    content: "",
                    source: "communicator",
                    buildResult,
                  });
                  const msgs2 = useIDEStore.getState().managerMessages;
                  buildResultMsgIdRef.current =
                    msgs2[msgs2.length - 1]?.id || null;
                }
              }
            }
            if (buildLiveClearTimerRef.current) {
              clearTimeout(buildLiveClearTimerRef.current);
            }
            buildLiveClearTimerRef.current = setTimeout(() => {
              setLiveActionLog([]);
              setLiveThinkingText("");
              setLiveNarrationText("");
              buildLiveClearTimerRef.current = null;
            }, 400);
            streamDone = true;
            break;
          }

          const isCurrentProject =
            useIDEStore.getState().projectId === projectId;
          if (!isCurrentProject) continue;

          if (type === "step_starting") {
            updateTaskStatus(String(ev.stepNumber), "running");
          } else if (type === "code_applied") {
            await applyCodeBlock({
              filePath: ev.filePath,
              code: ev.code,
              language: "",
            });
            refreshPreview();
          } else if (type === "step_completed") {
            updateTaskStatus(String(ev.stepNumber), "done");

            const stepNum = ev.stepNumber as number;
            const lastStep = normalizedSteps2[normalizedSteps2.length - 1];
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
                  userPrompt: midMsg?.content || userRequest,
                  currentFiles: midCurrentFiles,
                });
              }
            }
          } else if (type === "step_failed") {
            updateTaskStatus(String(ev.stepNumber), "failed");
            if (ev.reason)
              setTaskFailureReason(String(ev.stepNumber), ev.reason);
          } else if (type === "step_cancelled") {
            updateTaskStatus(String(ev.stepNumber), "pending");
          } else if (type === "reviewing") {
            setReviewPhase("reviewing");
          } else if (type === "review_passed") {
            setReviewPhase("review_passed");
            normalizedSteps2.forEach((step) => {
              const key = String(step.step);
              const s = useIDEStore.getState().taskStatuses[key];
              if (s === "bug" || s === "failed") updateTaskStatus(key, "done");
            });
          } else if (type === "bugs_found") {
            setReviewPhase("review_failed");
            if (ev.review) setHolisticReview(ev.review);
            normalizedSteps2.forEach((step) => {
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
            normalizedSteps2.forEach((step) => {
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
        }
      }
    } catch (err: any) {
      if (heartbeatWatchdogRef.current) {
        clearTimeout(heartbeatWatchdogRef.current);
        heartbeatWatchdogRef.current = null;
      }
      if (err?.name !== "AbortError") {
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
          const backoffMs = Math.min(1000 * Math.pow(2, reconnectRetryRef.current - 1), 16000);
          reconnectTimerRef.current = setTimeout(async () => {
            reconnectTimerRef.current = null;
            try {
              const statusRes = await fetch(`/api/build-session/${retrySessionId}/status`);
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
      if (!isReconnectingRef.current) {
        flushNarrationToStore();
        useIDEStore.getState().setStreamingSnapshot(null);
        buildSessionIdRef.current = null;
        buildReaderRef.current = null;
        if (projectId) {
          try {
            localStorage.removeItem(`codestart-build-session-${projectId}`);
          } catch {}
        }
        if (thinkingFadeTimerRef.current) {
          clearTimeout(thinkingFadeTimerRef.current);
          thinkingFadeTimerRef.current = null;
        }
        setBuildPhase(null);
        if (buildLiveClearTimerRef.current) {
          clearTimeout(buildLiveClearTimerRef.current);
        }
        buildLiveClearTimerRef.current = setTimeout(() => {
          setLiveThinkingText("");
          setLiveNarrationText("");
          setLiveActionLog([]);
          buildLiveClearTimerRef.current = null;
        }, 300);
        const finalLog = [...actionLogRef.current];
        if (finalLog.length > 0) {
          const msgId = buildResultMsgIdRef.current;
          if (msgId) {
            const curMsgs = useIDEStore.getState().managerMessages;
            const updated = curMsgs.map((m) =>
              m.id === msgId && m.buildResult
                ? {
                    ...m,
                    buildResult: { ...m.buildResult, actionLog: finalLog },
                  }
                : m,
            );
            useIDEStore.setState({ managerMessages: updated });
          } else if (useIDEStore.getState().projectId === projectId) {
            const buildResult: BuildResultData = {
              actionLog: finalLog,
              completionData: { changedFiles: [], userLang },
            };
            const finallyMsgs = useIDEStore.getState().managerMessages;
            const finallyPlanMsg = [...finallyMsgs]
              .reverse()
              .find((m) => m.plan);
            if (finallyPlanMsg) {
              const updated = finallyMsgs.map((m) =>
                m.id === finallyPlanMsg.id ? { ...m, buildResult } : m,
              );
              useIDEStore.setState({ managerMessages: updated });
            } else {
              addManagerMessage({
                role: "assistant",
                content: "",
                source: "communicator",
                buildResult,
              });
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
    setBuildPhase,
  ]);

  handleExecutePlanRef.current = handleExecutePlan;

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
  }, [
    setAiResponding,
    setExecutingTaskIndex,
    setReviewPhase,
    setBuildPhase,
    projectId,
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
      let commAccumulated3 = (buildSnapshot?.type === "build" ? buildSnapshot.narrationText : "") || "";
      let commMsgIndex2 = -1;
      let editorAccumulated2 = "";
      let thinkingAccumulated2 = (buildSnapshot?.type === "build" ? buildSnapshot.thinkingText : "") || "";

      let lastBuildSnapshotFlush = 0;
      const BUILD_SNAPSHOT_INTERVAL = 500;
      const flushBuildSnapshot = () => {
        const now = Date.now();
        if (now - lastBuildSnapshotFlush < BUILD_SNAPSHOT_INTERVAL) return;
        lastBuildSnapshotFlush = now;
        useIDEStore.getState().setStreamingSnapshot({
          type: "build",
          thinkingText: thinkingAccumulated2,
          narrationText: commAccumulated3,
          sessionId: sessionId,
          projectId: projectId || "",
          updatedAt: now,
          lastEventId: lastReceivedEventIdRef.current,
        });
      };

      if (lastEventId === -1) {
        actionLogRef.current = [];
        setLiveActionLog([]);
        setLiveThinkingText("");
        buildResultMsgIdRef.current = null;
      }

      const appendActionLog = (entry: ActionLogEntry) => {
        actionLogRef.current = [...actionLogRef.current, entry];
        setLiveActionLog([...actionLogRef.current]);
      };

      const flushNarrationToStore = () => {
        if (!commAccumulated3) return;
        const isCurrentProject = useIDEStore.getState().projectId === projectId;
        if (!isCurrentProject) return;
        const content = commAccumulated3;
        if (commMsgIndex2 === -1) {
          addManagerMessage({
            role: "assistant",
            content,
            source: "communicator",
          });
          commMsgIndex2 = useIDEStore.getState().managerMessages.length - 1;
        } else {
          const msgs = useIDEStore.getState().managerMessages;
          const target = msgs[commMsgIndex2];
          if (target?.role === "assistant") {
            const updated = [...msgs];
            updated[commMsgIndex2] = { ...target, content };
            useIDEStore.setState({ managerMessages: updated });
          }
        }
      };

      const flushThinkingToStore = () => {
        const isCurrentProject = useIDEStore.getState().projectId === projectId;
        if (!isCurrentProject) return;
        const msgs = useIDEStore.getState().managerMessages;
        let idx = commMsgIndex2;
        if (idx === -1 || !msgs[idx] || msgs[idx].role !== "assistant") {
          const fallbackIdx = [...msgs]
            .reverse()
            .findIndex((m) => m.typing === true && m.role === "assistant");
          idx = fallbackIdx !== -1 ? msgs.length - 1 - fallbackIdx : -1;
        }
        if (idx === -1) {
          addManagerMessage({
            role: "assistant",
            content: "",
            source: "communicator",
            typing: true,
          });
          commMsgIndex2 = useIDEStore.getState().managerMessages.length - 1;
          idx = commMsgIndex2;
        }
        const target = useIDEStore.getState().managerMessages[idx];
        if (target?.role === "assistant") {
          const updated = [...useIDEStore.getState().managerMessages];
          updated[idx] = { ...target, thinking: thinkingAccumulated2 };
          useIDEStore.setState({ managerMessages: updated });
        }
      };

      const resetNarration = () => {
        commAccumulated3 = "";
        commMsgIndex2 = -1;
        thinkingAccumulated2 = "";
      };

      const clearTypingOnCurrentMsg = () => {
        const isCurrentProject = useIDEStore.getState().projectId === projectId;
        if (!isCurrentProject) return;
        if (commMsgIndex2 === -1) return;
        const msgs = useIDEStore.getState().managerMessages;
        const target = msgs[commMsgIndex2];
        if (target?.role === "assistant" && target.typing) {
          const updated = [...msgs];
          updated[commMsgIndex2] = { ...target, typing: false };
          useIDEStore.setState({ managerMessages: updated });
        }
      };

      const finalizeEditor = () => {
        editorAccumulated2 = "";
      };

      try {
        const response = await fetch(
          `/api/build-session/${sessionId}/stream?lastEventId=${lastEventId}`,
        );
        if (!response.ok) {
          if (projectId) {
            try {
              localStorage.removeItem(`codestart-build-session-${projectId}`);
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

        const decoder = new TextDecoder();
        let buffer = "";
        let streamDone = false;

        const HEARTBEAT_TIMEOUT_MS = 15000;
        let heartbeatTimedOut = false;
        const resetHeartbeatWatchdog = () => {
          if (heartbeatWatchdogRef.current) {
            clearTimeout(heartbeatWatchdogRef.current);
          }
          heartbeatWatchdogRef.current = setTimeout(() => {
            heartbeatWatchdogRef.current = null;
            heartbeatTimedOut = true;
            try { reader.cancel(); } catch {}
          }, HEARTBEAT_TIMEOUT_MS);
        };
        resetHeartbeatWatchdog();

        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) {
            if (heartbeatTimedOut) throw new Error("heartbeat_timeout");
            break;
          }

          resetHeartbeatWatchdog();

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const raw = trimmed.slice(6).trim();
            if (raw === "[DONE]") {
              streamDone = true;
              break;
            }

            let ev: any;
            try {
              ev = JSON.parse(raw);
            } catch {
              continue;
            }

            if (typeof ev.eventId === "number") {
              lastReceivedEventIdRef.current = ev.eventId;
            }

            const isReplayEvent = !!ev.replay;

            const type = ev.type;
            if (type === "replay_boundary") continue;

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
                const stepNum = (ev.stepNumber as number) ?? 1;
                setExecutingTaskIndex(stepNum - 1);
                setBuildPhase("thinking");
                thinkingAccumulated2 = "";
                commAccumulated3 = "";
                setLiveThinkingText("");
                setLiveNarrationText("");
                const stepTitle = (ev.stepTitle as string) || "";
                const totalSteps =
                  (ev.totalSteps as number) || nSteps.length;
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
                const token = (ev.token as string) || "";
                if (token) {
                  thinkingAccumulated2 += token;
                  setLiveThinkingText(thinkingAccumulated2);
                }
                setBuildPhase("thinking");
              } else if (type === "narration_token") {
                if (thinkingAccumulated2) {
                  thinkingAccumulated2 = "";
                  setLiveThinkingText("");
                }
                const token = (ev.token as string) || "";
                if (token) {
                  commAccumulated3 += token;
                  setLiveNarrationText(commAccumulated3);
                }
                setBuildPhase("working");
              } else if (type === "editor_token") {
                setBuildPhase("working");
              } else if (type === "action_log") {
                setBuildPhase("working");
                const actionType =
                  (ev.actionType as ActionLogEntry["type"]) || "tool_call";
                const label = (ev.label as string) || "";
                const detail = (ev.detail as string) || "";
                const filePath = (ev.filePath as string) || undefined;
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
                  setTaskFailureReason(String(ev.stepNumber), ev.reason);
              } else if (type === "code_applied") {
                setBuildPhase("working");
                if (useIDEStore.getState().projectId === projectId) {
                  await applyCodeBlock({
                    filePath: ev.filePath,
                    code: ev.code,
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
                const changedFiles = (ev.changedFiles as string[]) || [];
                const finalLog = [...actionLogRef.current];
                if (useIDEStore.getState().projectId === projectId) {
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
                    buildResultMsgIdRef.current =
                      msgs[msgs.length - 1]?.id || null;
                  }
                }
              } else if (type === "done") {
                streamDone = true;
                break;
              }
              continue;
            }

            if (type === "step_starting") {
              finalizeEditor();
              resetNarration();
              if (thinkingFadeTimerRef.current) {
                clearTimeout(thinkingFadeTimerRef.current);
                thinkingFadeTimerRef.current = null;
              }
              setBuildPhase("thinking");
              setLiveThinkingText("");
              setLiveNarrationText("");
              const stepNum = (ev.stepNumber as number) ?? 1;
              const stepTitle = (ev.stepTitle as string) || "";
              const totalSteps =
                (ev.totalSteps as number) || nSteps.length;
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
                commAccumulated3 = "";
                addManagerMessage({
                  role: "assistant",
                  content: stepLabel,
                  source: "communicator",
                  typing: true,
                });
                commMsgIndex2 =
                  useIDEStore.getState().managerMessages.length - 1;
              }
              await new Promise<void>((r) => setTimeout(r, 0));
            } else if (type === "thinking_token") {
              const token = (ev.token as string) || "";
              if (token) {
                if (thinkingFadeTimerRef.current) {
                  clearTimeout(thinkingFadeTimerRef.current);
                  thinkingFadeTimerRef.current = null;
                }
                if (buildLiveClearTimerRef.current) {
                  clearTimeout(buildLiveClearTimerRef.current);
                  buildLiveClearTimerRef.current = null;
                }
                thinkingAccumulated2 += token;
                flushThinkingToStore();
                flushBuildSnapshot();
                setLiveThinkingText(thinkingAccumulated2);
                await new Promise<void>((r) => setTimeout(r, 16));
              }
              setBuildPhase("thinking");
            } else if (type === "action_log") {
              const actionType =
                (ev.actionType as ActionLogEntry["type"]) || "tool_call";
              const label = (ev.label as string) || "";
              const detail = (ev.detail as string) || "";
              const filePath = (ev.filePath as string) || undefined;
              if (thinkingAccumulated2) {
                const existing = actionLogRef.current;
                const lastIsThinking =
                  existing.length > 0 &&
                  existing[existing.length - 1].type === "thinking";
                if (!lastIsThinking) {
                  appendActionLog({
                    type: "thinking",
                    label: "Thinking",
                    detail: thinkingAccumulated2,
                    timestamp: Date.now(),
                  });
                }
                thinkingAccumulated2 = "";
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
              if (thinkingAccumulated2) {
                const existing = actionLogRef.current;
                const lastIsThinking =
                  existing.length > 0 &&
                  existing[existing.length - 1].type === "thinking";
                if (!lastIsThinking) {
                  appendActionLog({
                    type: "thinking",
                    label: "Thinking",
                    detail: thinkingAccumulated2,
                    timestamp: Date.now(),
                  });
                }
                thinkingAccumulated2 = "";
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
              commAccumulated3 += ev.token || "";
              flushBuildSnapshot();
              setLiveNarrationText(commAccumulated3);
              setBuildPhase("working");
              await new Promise<void>((r) => setTimeout(r, 16));
            } else if (type === "editor_token") {
              editorAccumulated2 += ev.token || "";
              setBuildPhase("working");
            } else if (type === "code_applied") {
              setBuildPhase("working");
            } else if (
              type === "step_completed" ||
              type === "step_failed" ||
              type === "step_cancelled"
            ) {
              clearTypingOnCurrentMsg();
              finalizeEditor();
              flushNarrationToStore();
              setLiveNarrationText("");
            } else if (type === "reviewing") {
              flushNarrationToStore();
              resetNarration();
              setLiveNarrationText("");
              setBuildPhase("verifying");
            } else if (type === "bugs_found") {
              setBuildPhase("fixing");
            } else if (type === "fixing") {
              setBuildPhase("fixing");
            } else if (type === "all_complete") {
              buildCompleted = true;
              if (useIDEStore.getState().projectId === projectId) {
                createCheckpoint("Build complete", {
                  includeManagerThread: true,
                });
              }
              const changedFiles = (ev.changedFiles as string[]) || [];
              const finalLog = [...actionLogRef.current];
              if (useIDEStore.getState().projectId === projectId) {
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
                  buildResultMsgIdRef.current =
                    msgs[msgs.length - 1]?.id || null;
                }
              }
            } else if (type === "done") {
              finalizeEditor();
              flushNarrationToStore();
              if (buildLiveClearTimerRef.current) {
                clearTimeout(buildLiveClearTimerRef.current);
              }
              buildLiveClearTimerRef.current = setTimeout(() => {
                setLiveNarrationText("");
                setLiveActionLog([]);
                setLiveThinkingText("");
                buildLiveClearTimerRef.current = null;
              }, 400);
              streamDone = true;
              break;
            }

            const isCurrentProject =
              useIDEStore.getState().projectId === projectId;
            if (!isCurrentProject) continue;

            if (type === "step_starting") {
              updateTaskStatus(String(ev.stepNumber), "running");
            } else if (type === "code_applied") {
              await applyCodeBlock({
                filePath: ev.filePath,
                code: ev.code,
                language: "",
              });
              refreshPreview();
            } else if (type === "step_completed") {
              updateTaskStatus(String(ev.stepNumber), "done");
            } else if (type === "step_failed") {
              updateTaskStatus(String(ev.stepNumber), "failed");
              if (ev.reason)
                setTaskFailureReason(String(ev.stepNumber), ev.reason);
            } else if (type === "step_cancelled") {
              updateTaskStatus(String(ev.stepNumber), "pending");
            } else if (type === "reviewing") {
              setReviewPhase("reviewing");
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
              if (ev.review) setHolisticReview(ev.review);
              nSteps.forEach((step) => {
                const key = String(step.step);
                const s = useIDEStore.getState().taskStatuses[key];
                if (s === "done" || s === "failed")
                  updateTaskStatus(key, "bug");
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
              nSteps.forEach((step) => {
                const key = String(step.step);
                const s = useIDEStore.getState().taskStatuses[key];
                if (s === "bug" || s === "failed")
                  updateTaskStatus(key, "done");
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
          }
        }
      } catch (err: any) {
        if (heartbeatWatchdogRef.current) {
          clearTimeout(heartbeatWatchdogRef.current);
          heartbeatWatchdogRef.current = null;
        }
        if (err?.name !== "AbortError") {
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
            const backoffMs = Math.min(1000 * Math.pow(2, reconnectRetryRef.current - 1), 16000);
            reconnectTimerRef.current = setTimeout(async () => {
              reconnectTimerRef.current = null;
              try {
                const statusRes = await fetch(`/api/build-session/${retrySessionId}/status`);
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
        if (!isReconnectingRef.current) {
          flushNarrationToStore();
          useIDEStore.getState().setStreamingSnapshot(null);
          buildSessionIdRef.current = null;
          buildReaderRef.current = null;
          if (projectId) {
            try {
              localStorage.removeItem(`codestart-build-session-${projectId}`);
            } catch {}
          }
          if (thinkingFadeTimerRef.current) {
            clearTimeout(thinkingFadeTimerRef.current);
            thinkingFadeTimerRef.current = null;
          }
          setBuildPhase(null);
          if (buildLiveClearTimerRef.current) {
            clearTimeout(buildLiveClearTimerRef.current);
          }
          buildLiveClearTimerRef.current = setTimeout(() => {
            setLiveThinkingText("");
            setLiveNarrationText("");
            setLiveActionLog([]);
            buildLiveClearTimerRef.current = null;
          }, 300);
          if (useIDEStore.getState().projectId === projectId) {
            if (buildCompleted) {
              const plan2 = useIDEStore.getState().managerPlan;
              if (plan2) {
                normalizeSteps(plan2).forEach((step) => {
                  const key = String(step.step);
                  const s = useIDEStore.getState().taskStatuses[key];
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
      setBuildPhase,
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
          if (cancelled || !data?.sessionId) return;
          if (buildSessionIdRef.current) return;
          setIsReconnecting(true);
          isReconnectingRef.current = true;
          setExecutingTaskIndex(0);
          setChatMode("build");
          setReviewPhase("building");
          setBuildPhase("thinking");
          connectToBuildStream(data.sessionId, -1).catch(() => {});
        })
        .catch(() => {});
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
            localStorage.removeItem(`codestart-build-session-${projectId}`);
          } catch {}
          return;
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
          localStorage.removeItem(`codestart-build-session-${projectId}`);
        } catch {}
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
    setBuildPhase,
  ]);

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
            try { localStorage.removeItem(`codestart-mgr-session-${projectId}`); } catch {}
          }
          setManagerResponding(false);
          return;
        }

        mgrReconnectRetryRef.current = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const existingSnapshot = useIDEStore.getState().streamingSnapshot;
        let managerAccumulated2 = (existingSnapshot?.type === "manager" ? existingSnapshot.narrationText : "") || "";
        let managerThinkingAccumulated2 = (existingSnapshot?.type === "manager" ? existingSnapshot.thinkingText : "") || "";

        let lastMgrReconnectSnapshotFlush = 0;
        const MGR_RECONNECT_SNAPSHOT_INTERVAL = 500;
        const flushMgrReconnectSnapshot = () => {
          const now = Date.now();
          if (now - lastMgrReconnectSnapshotFlush < MGR_RECONNECT_SNAPSHOT_INTERVAL) return;
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const raw = trimmed.slice(6).trim();
            if (raw === "[DONE]") break;

            let ev: any;
            try { ev = JSON.parse(raw); } catch { continue; }

            if (typeof ev.eventId === "number") {
              mgrLastEventIdRef.current = ev.eventId;
            }

            const evType = ev.type;
            if (evType === "session_id") continue;

            const isCurrentProject = useIDEStore.getState().projectId === projectId;

            if (evType === "thinking_token") {
              managerThinkingAccumulated2 += (ev.token as string) || "";
              flushMgrReconnectSnapshot();
              if (isCurrentProject) setMgrLiveThinkingText(managerThinkingAccumulated2);
            } else if (evType === "raw_token" || evType === "manager_token") {
              managerAccumulated2 += ev.token;
              flushMgrReconnectSnapshot();
              if (isCurrentProject) setMgrLiveNarrationText(stripProjectNameMarker(managerAccumulated2));
            } else if (evType === "communicator_token") {
              if (isCurrentProject) setMgrLiveNarrationText(ev.token || "");
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
                useIDEStore.getState().clearManagerPlan();
                const steps = normalizeSteps(plan);
                for (const step of steps) updateTaskStatus(String(step.step), "pending");
                useIDEStore.getState().setManagerPlan(plan);
                addManagerMessage({
                  role: "assistant",
                  content: "",
                  plan,
                  thinking: managerThinkingAccumulated2 || undefined,
                });
              }
            } else if (evType === "manager_done" || evType === "manager_error") {
              break;
            }
          }
        }
      } catch (err: any) {
        if (err?.name !== "AbortError" && mgrSessionIdRef.current) {
          const maxRetries = 8;
          if (mgrReconnectRetryRef.current < maxRetries) {
            mgrReconnectRetryRef.current++;
            const retrySessionId = mgrSessionIdRef.current;
            const retryLastEventId = mgrLastEventIdRef.current;
            const backoffMs = Math.min(1000 * Math.pow(2, mgrReconnectRetryRef.current - 1), 16000);
            mgrReconnectTimerRef.current = setTimeout(async () => {
              mgrReconnectTimerRef.current = null;
              try {
                const statusRes = await fetch(`/api/manager-chat/${retrySessionId}/status`);
                if (!statusRes.ok || !(await statusRes.json()).active) {
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
              connectToMgrStreamRef.current?.(retrySessionId, retryLastEventId);
            }, backoffMs);
            return;
          }
        }
      } finally {
        if (!mgrReconnectTimerRef.current) {
          useIDEStore.getState().setStreamingSnapshot(null);
          mgrSessionIdRef.current = null;
          if (projectId) {
            try { localStorage.removeItem(`codestart-mgr-session-${projectId}`); } catch {}
          }
          if (mgrLiveClearTimerRef.current) clearTimeout(mgrLiveClearTimerRef.current);
          mgrLiveClearTimerRef.current = setTimeout(() => {
            setMgrLiveThinkingText("");
            setMgrLiveNarrationText("");
            setMgrLiveActionLog([]);
            mgrLiveClearTimerRef.current = null;
          }, 300);
          if (!buildSessionIdRef.current) {
            setManagerResponding(false);
          }
        }
      }
    },
    [
      projectId,
      addManagerMessage,
      updateTaskStatus,
      setManagerResponding,
    ],
  );

  connectToMgrStreamRef.current = connectToMgrStream;

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const attemptManagerReconnect = () => {
      const snapshot = useIDEStore.getState().streamingSnapshot;
      const savedMgrSessionId = (() => {
        try { return localStorage.getItem(`codestart-mgr-session-${projectId}`); } catch { return null; }
      })();
      const sessionIdToReconnect = (snapshot?.type === "manager" && snapshot.projectId === projectId ? snapshot.sessionId : null) || savedMgrSessionId;

      if (snapshot?.type === "manager" && snapshot.projectId === projectId) {
        setMgrLiveThinkingText(snapshot.thinkingText || "");
        setMgrLiveNarrationText(snapshot.narrationText || "");
        setManagerResponding(true);
      }

      if (sessionIdToReconnect) {
        const resumeEventId = (snapshot?.type === "manager" && typeof snapshot.lastEventId === "number")
          ? snapshot.lastEventId : -1;
        fetch(`/api/manager-chat/${sessionIdToReconnect}/status`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (cancelled) return;
            if (data?.active) {
              setManagerResponding(true);
              connectToMgrStream(sessionIdToReconnect, resumeEventId);
            } else {
              useIDEStore.getState().setStreamingSnapshot(null);
              try { localStorage.removeItem(`codestart-mgr-session-${projectId}`); } catch {}
              setManagerResponding(false);
              setMgrLiveThinkingText("");
              setMgrLiveNarrationText("");
            }
          })
          .catch(() => {
            useIDEStore.getState().setStreamingSnapshot(null);
            try { localStorage.removeItem(`codestart-mgr-session-${projectId}`); } catch {}
            setManagerResponding(false);
            setMgrLiveThinkingText("");
            setMgrLiveNarrationText("");
          });
      } else if (snapshot?.type === "manager" && snapshot.projectId === projectId) {
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
          if (!data?.active || (staleProjectId && staleProjectId !== projectId)) {
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

    const buildSnapshot = useIDEStore.getState().streamingSnapshot;
    if (buildSnapshot?.type === "build" && buildSnapshot.projectId === projectId) {
      setLiveThinkingText(buildSnapshot.thinkingText || "");
      setLiveNarrationText(buildSnapshot.narrationText || "");
      const savedBuildSessionId = (() => {
        try { return localStorage.getItem(`codestart-build-session-${projectId}`); } catch { return null; }
      })();
      const buildSessionToReconnect = buildSnapshot.sessionId || savedBuildSessionId;
      if (buildSessionToReconnect && !buildSessionIdRef.current) {
        const resumeBuildEventId = typeof buildSnapshot.lastEventId === "number" ? buildSnapshot.lastEventId : -1;
        fetch(`/api/build-session/${buildSessionToReconnect}/status`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (cancelled) return;
            if (data?.active) {
              connectToBuildStreamRef.current?.(buildSessionToReconnect, resumeBuildEventId);
            } else {
              useIDEStore.getState().setStreamingSnapshot(null);
              try { localStorage.removeItem(`codestart-build-session-${projectId}`); } catch {}
              setLiveThinkingText("");
              setLiveNarrationText("");
            }
          })
          .catch(() => {
            useIDEStore.getState().setStreamingSnapshot(null);
            try { localStorage.removeItem(`codestart-build-session-${projectId}`); } catch {}
            setLiveThinkingText("");
            setLiveNarrationText("");
          });
      } else if (!buildSessionToReconnect) {
        setTimeout(() => {
          if (cancelled) return;
          useIDEStore.getState().setStreamingSnapshot(null);
          setLiveThinkingText("");
          setLiveNarrationText("");
        }, 2000);
      }
    }

    return () => { cancelled = true; };
  }, [projectId, connectToMgrStream, setManagerResponding]);

  const handleContinueExecution = useCallback(
    (userInput?: string) => {
      const plan = useIDEStore.getState().managerPlan;
      if (!plan) return;

      const inputText =
        userInput || useIDEStore.getState().userConfirmationInput || "";

      if (inputText.trim()) {
        addChatMessage({ role: "user", content: inputText.trim() });
        userConfirmationRef.current = inputText.trim();
      } else {
        userConfirmationRef.current = "";
      }

      setPendingConfirmation(null);
      setUserConfirmationInput("");

      const steps = normalizeSteps(plan);
      for (const t2 of steps) {
        const key = String(t2.step);
        if (useIDEStore.getState().taskStatuses[key] === "needs-input") {
          updateTaskStatus(key, "pending");
        }
      }
      handleExecutePlan();
    },
    [
      handleExecutePlan,
      updateTaskStatus,
      addChatMessage,
      setPendingConfirmation,
      setUserConfirmationInput,
    ],
  );

  useEffect(() => {
    pendingHandled.current = false;
  }, [projectId]);

  useEffect(() => {
    if (
      pendingPrompt &&
      !pendingHandled.current &&
      !isAiResponding &&
      !isManagerResponding
    ) {
      pendingHandled.current = true;
      const prompt = pendingPrompt;
      handleManagerSend(prompt).then(() => {
        clearPendingPrompt();
      });
    }
  }, [
    pendingPrompt,
    isAiResponding,
    isManagerResponding,
    clearPendingPrompt,
    handleManagerSend,
  ]);

  useEffect(() => {
    if (!isManagerResponding && autoExecutePlanRef.current) {
      autoExecutePlanRef.current = false;
      handleExecutePlan();
    }
  }, [isManagerResponding, handleExecutePlan]);

  const isExecuting = executingTaskIndex !== null;

  const handleStop = useCallback(() => {
    if (isExecuting) {
      handleStopExecution();
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setAiResponding(false);
    setManagerResponding(false);
    setMgrPreparingPlan(false);
    setMgrLiveThinkingText("");
    setMgrLiveNarrationText("");
    setMgrLiveActionLog([]);
  }, [setAiResponding, setManagerResponding, isExecuting, handleStopExecution]);

  const handleToggleMode = useCallback(() => {
    const next = chatMode === "manager" ? "build" : "manager";
    setChatMode(next);
  }, [chatMode, setChatMode]);

  const handleRevisePlan = useCallback(() => {
    setChatMode("manager");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [setChatMode]);

  const handleCurrentSend = useCallback(() => {
    if (pendingConfirmation) {
      const trimmed = input.trim();
      if (trimmed) {
        setInput("");
        handleContinueExecution(trimmed);
      }
      return;
    }
    if (chatMode === "build" && managerPlan && !isExecuting && !input.trim()) {
      handleExecutePlan();
      return;
    }
    if (chatMode === "build") {
      handleEditorSend();
      return;
    }
    handleManagerSend();
  }, [
    handleManagerSend,
    handleEditorSend,
    pendingConfirmation,
    input,
    handleContinueExecution,
    chatMode,
    managerPlan,
    isExecuting,
    handleExecutePlan,
  ]);

  const handleCurrentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleCurrentSend();
    }
  };

  const handleSmartResponse = useCallback(async () => {
    const validRoles = new Set(["user", "assistant"]);
    const msgs = (chatMode === "manager" ? managerMessages : chatMessages)
      .filter(
        (m) =>
          !m.hidden && !("typing" in m && m.typing) && validRoles.has(m.role) && m.content?.trim(),
      )
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    if (msgs.length === 0) return;

    const hasChinese = msgs.some((m) => /[\u4e00-\u9fff]/.test(m.content));
    const language = hasChinese ? "Chinese" : "English";

    setSmartResponseLoading(true);
    try {
      const res = await fetch("/api/smart-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, mode: chatMode, language }),
      });
      const data = await res.json();
      if (data.suggestion) {
        setInput(data.suggestion);
        setTimeout(() => textareaRef.current?.focus(), 50);
      } else if (data.error) {
        console.error("Smart response error:", data.error);
        toast({
          title: "Smart response failed",
          description: data.error,
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Smart response fetch error:", err);
      toast({
        title: "Smart response failed",
        description: "Network error",
        variant: "destructive",
      });
    } finally {
      setSmartResponseLoading(false);
    }
  }, [chatMode, chatMessages, managerMessages]);

  const isBusy = isAiResponding || isManagerResponding || isExecuting;

  return (
    <div className="h-full flex flex-col" data-testid="chat-panel">
      <div className="flex items-center justify-between gap-2 px-3 h-9 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span
            className="text-xs font-medium text-foreground"
            data-testid="text-chat-title"
          >
            {chatTitle}
          </span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setActiveTool(null)}
          aria-label={tGlobal("chat.close")}
          data-testid="button-close-chat"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto py-2 space-y-2"
        ref={scrollRef}
      >
        {(() => {
          const lastPlanMsgId = [...managerMessages]
            .reverse()
            .find((m) => m.plan)?.id;
          const lastChatIdx = chatMessages.length - 1;
          type MergedItem =
            | { kind: "chat"; msg: ChatMessage; idx: number; order: number }
            | {
                kind: "manager";
                msg: (typeof managerMessages)[number];
                order: number;
              };
          const merged: MergedItem[] = [
            ...chatMessages.map((msg, idx) => ({
              kind: "chat" as const,
              msg,
              idx,
              order: idx,
            })),
            ...managerMessages.map((msg, idx) => ({
              kind: "manager" as const,
              msg,
              order: idx,
            })),
          ].sort(
            (a, b) => a.msg.timestamp - b.msg.timestamp || a.order - b.order,
          );

          const seenCheckpointIds = new Set<string>();

          return merged.map((item) => {
            if (item.kind === "chat") {
              const { msg, idx } = item;
              if (msg.hidden) return null;
              if (msg.role === "checkpoint" && msg.checkpointId) {
                if (seenCheckpointIds.has(msg.checkpointId)) return null;
                seenCheckpointIds.add(msg.checkpointId);
              }
              const isLastAssistant =
                msg.role === "assistant" && idx === lastChatIdx;
              return msg.role === "checkpoint" ? (
                <CheckpointMarker key={`c-${msg.id}`} message={msg} />
              ) : (
                <MessageBubble
                  key={`c-${msg.id}`}
                  message={msg}
                  autoApplied={autoAppliedMessageIds.has(msg.id)}
                  appliedBlockIndices={
                    isLastAssistant ? appliedBlockIndices : undefined
                  }
                />
              );
            } else {
              const { msg } = item;
              if (msg.role === "checkpoint" && msg.checkpointId) {
                if (seenCheckpointIds.has(msg.checkpointId)) return null;
                seenCheckpointIds.add(msg.checkpointId);
                return (
                  <CheckpointMarker
                    key={`m-${msg.id}`}
                    message={{
                      id: msg.id,
                      role: "checkpoint",
                      content: msg.content,
                      timestamp: msg.timestamp,
                      checkpointId: msg.checkpointId,
                    }}
                  />
                );
              }
              if (msg.buildResult && !msg.plan) {
                return (
                  <div key={`m-${msg.id}`} className="space-y-2">
                    {msg.buildResult.actionLog.length > 0 && (
                      <div className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden">
                        <ActionLogCollapsed
                          entries={
                            msg.buildResult.actionLog as ActionLogEntry[]
                          }
                        />
                      </div>
                    )}
                    <BuildCompletionCard
                      changedFiles={msg.buildResult.completionData.changedFiles}
                      userLang={msg.buildResult.completionData.userLang}
                      summary={msg.buildResult.completionData.summary}
                    />
                  </div>
                );
              }
              const isLastPlan = msg.plan && msg.id === lastPlanMsgId;
              return (
                <div key={`m-${msg.id}`} className="space-y-2">
                  <ManagerMessageBubble
                    message={msg}
                    taskStatuses={isLastPlan ? taskStatuses : {}}
                    taskFailureReasons={
                      isLastPlan ? taskFailureReasons : undefined
                    }
                    onExecute={isLastPlan ? handleExecutePlan : undefined}
                    onRevise={isLastPlan ? handleRevisePlan : undefined}
                    isExecuting={isLastPlan ? isExecuting : undefined}
                    onStop={isLastPlan ? handleStopExecution : undefined}
                    onContinueWithInput={
                      isLastPlan ? handleContinueExecution : undefined
                    }
                    pendingConfirmation={
                      isLastPlan ? pendingConfirmation : undefined
                    }
                    confirmationInput={
                      isLastPlan ? userConfirmationInput : undefined
                    }
                    onConfirmationInputChange={
                      isLastPlan ? setUserConfirmationInput : undefined
                    }
                    reviewPhase={isLastPlan ? reviewPhase : undefined}
                    holisticReview={isLastPlan ? holisticReview : undefined}
                    fixCycle={isLastPlan ? fixCycle : undefined}
                  />
                  {msg.buildResult && (
                    <>
                      {msg.buildResult.actionLog.length > 0 && (
                        <div className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden">
                          <ActionLogCollapsed
                            entries={
                              msg.buildResult.actionLog as ActionLogEntry[]
                            }
                          />
                        </div>
                      )}
                      <BuildCompletionCard
                        changedFiles={
                          msg.buildResult.completionData.changedFiles
                        }
                        userLang={msg.buildResult.completionData.userLang}
                        summary={msg.buildResult.completionData.summary}
                      />
                    </>
                  )}
                </div>
              );
            }
          });
        })()}
        {isAiResponding &&
          chatMessages[chatMessages.length - 1]?.content === "" &&
          chatMode !== "manager" && <TypingIndicator />}
        {!isExecuting &&
          (mgrLiveThinkingText ||
          mgrLiveNarrationText ||
          mgrLiveActionLog.length > 0 ? (
            <div className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden">
              <ActionLogLive
                entries={mgrLiveActionLog}
                thinkingText={mgrLiveThinkingText || undefined}
                narrationText={mgrLiveNarrationText || undefined}
              />
              {mgrPreparingPlan && (
                <div className="px-3 py-1.5 border-t border-border/20 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-blue-400/80" />
                  <span className="text-[11px] text-muted-foreground/80 font-medium">
                    Preparing plan…
                  </span>
                </div>
              )}
            </div>
          ) : isManagerResponding ? (
            mgrPreparingPlan ? (
              <div className="mx-3 mb-2 px-3 py-2 rounded-lg border border-border/30 bg-card/30 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-blue-400/80" />
                <span className="text-[12px] text-muted-foreground/90 font-medium">
                  Preparing plan…
                </span>
              </div>
            ) : (
              <TypingIndicator text={t(planCardLang, "planning")} />
            )
          ) : null)}
        {(liveActionLog.length > 0 ||
          !!liveThinkingText ||
          !!liveNarrationText) && (
          <div className="mx-3 rounded-lg border border-border/30 bg-card/30 overflow-hidden">
            <ActionLogLive
              entries={liveActionLog}
              thinkingText={liveThinkingText || undefined}
              narrationText={liveNarrationText || undefined}
            />
          </div>
        )}
      </div>
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
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            <span className="text-[11px] text-muted-foreground">
              {buildPhase === "thinking" && "Agent is thinking..."}
              {buildPhase === "working" && "Agent is working..."}
              {buildPhase === "verifying" && "Agent is verifying..."}
              {buildPhase === "fixing" && "Agent is fixing..."}
            </span>
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
              ? "border-primary ring-2 ring-primary/40"
              : "border-border/60",
          )}
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleCurrentKeyDown}
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
              onClick={handleToggleMode}
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
              onClick={handleSmartResponse}
              disabled={
                isBusy ||
                smartResponseLoading ||
                (chatMode === "manager"
                  ? !managerMessages.some((m) => m.role === "assistant")
                  : !chatMessages.some((m) => m.role === "assistant"))
              }
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
                onClick={handleStop}
                data-testid="button-stop-chat"
              >
                <Square className="w-3 h-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-7 w-7 rounded-lg shrink-0"
                onClick={handleCurrentSend}
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
    </div>
  );
}
