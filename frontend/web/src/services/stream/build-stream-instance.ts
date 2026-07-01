import { ObservableState } from "./observable-state";
import {
  type BuildStreamState,
  type StoreActions,
  INITIAL_BUILD_STREAM_STATE,
} from "./types";
import type { ActionLogEntry, BuildSseEvent, NormalizedStep } from "@/components/ide/chat/chat-types";
import { KNOWN_BUILD_EVENT_TYPES, BUILD_SOURCE_MAP, validateBuildEvent } from "@/components/ide/chat/chat-types";
import { detectLanguage, normalizeSteps } from "@/components/ide/chat/chat-utils";
import { parseSseStream, createHeartbeatWatchdog } from "@/components/ide/chat/hooks/useSSEStream";
import { useLLMMonitorStore, type LLMEventType } from "@/stores/llm-monitor-store";
import { useLanguageStore } from "@/stores/language-store";
import { useProjectStore } from "@/stores/project-store";
import { tr } from "@/lib/i18n";
import type { ManagerPlan, BuildResultData } from "@/stores/ide-store";
import type { BuildPhase } from "@/components/ide/chat/BuildPhaseIndicator";

/**
 * BuildStreamInstance — owns the SSE connection and live state for a single
 * project's build stream. Not tied to React lifecycle.
 */
export class BuildStreamInstance {
  readonly projectId: string;
  readonly chatSessionId: string;   // 对话 session（主会话为 "main"），用于隔离 localStorage key
  readonly state: ObservableState<BuildStreamState>;

  private actions: StoreActions;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private sessionId: string | null = null;
  private lastEventId = -1;
  private lastActivityTs = 0;
  private generation = 0;
  private reconnectRetry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatWatchdog: ReturnType<typeof setTimeout> | null = null;
  private thinkingFadeTimer: ReturnType<typeof setTimeout> | null = null;
  private liveClearTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionErrorAdded = false;
  private disposed = false;
  private actionLog: ActionLogEntry[] = [];
  private thinkingStartTime: number | null = null;
  private currentStepNum = 0;   // 当前执行步骤号，用于给 actionLog entry 打标
  private executing = false;    // 防止并发 execute() 调用
  userConfirmation = "";

  constructor(projectId: string, actions: StoreActions, chatSessionId: string = "main") {
    this.projectId = projectId;
    this.chatSessionId = chatSessionId;
    this.actions = actions;
    this.state = new ObservableState<BuildStreamState>({ ...INITIAL_BUILD_STREAM_STATE });
  }

  /** Send debug trace to server so we can see it in pm2 logs */
  private _dbg(msg: string): void {
    const full = `[BuildStream:${this.projectId?.slice(0,8)}] ${msg}`;
    console.warn(full);
    fetch("/api/_dbg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg: full }),
      keepalive: true,
    }).catch(() => {});
  }

  // localStorage key：含 chatSessionId，确保各会话的后端 session 持久化互不干扰
  private get storageKey(): string {
    return `cascade-build-session-${this.projectId}-${this.chatSessionId}`;
  }

  // ─── Public API ───────────────────────────────────────────────────────

  get isActive(): boolean {
    return this.sessionId !== null;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Execute a build plan (or direct build).
   */
  async execute(opts?: { userMessage?: string }): Promise<void> {
    if (this.disposed) return;
    // 防止并发 execute()：同一 slot 上第二次点击直接忽略
    if (this.executing) { this._dbg("execute: already executing, ignoring"); return; }
    this.executing = true;
    this._dbg("execute() called");
    try {
      await this._executeInner(opts);
    } finally {
      this.executing = false;
    }
  }

  private async _executeInner(opts?: { userMessage?: string }): Promise<void> {
    if (this.disposed) { this._dbg("disposed, returning"); return; }

    const isDirect = !!opts?.userMessage;
    const existingPlan = this.actions.getManagerPlan();
    if (!isDirect && !existingPlan) { this._dbg("no plan and not direct, returning"); return; }
    this._dbg("START isDirect=" + isDirect);

    // Self-heal stale session
    if (this.sessionId) {
      let stillActive = false;
      try {
        const r = await fetch(`/api/build-session/${this.sessionId}/status`, {
          cache: "no-store", headers: { "Cache-Control": "no-cache" },
        });
        if (r.ok) {
          const data = await r.json();
          stillActive = !!data?.active && !data?.done;
        }
      } catch {}
      if (stillActive) {
        // Session 还在跑但 SSE 断了（如刷新页面）——重连，不要启动新 session
        if (!this.reader) {
          this.actions.setChatMode("build");
          this.state.set({ buildPhase: "thinking" });
          await this.connect(this.sessionId, this.lastEventId);
        }
        return;
      }
      this.sessionId = null;
      this.reader = null;
      try { localStorage.removeItem(this.storageKey); } catch {}
    }

    this.clearLiveTimer();
    // Direct build (no plan step) skips the manager send path, so the user's
    // prompt is never recorded in the chat. Add it here so the message shows up
    // just like in plan mode instead of the build silently starting.
    if (isDirect) {
      this.actions.addManagerMessage({ role: "user", content: opts!.userMessage! });
    }
    this.actions.setExecutingTaskIndex(0);
    this.actions.setManagerResponding(false);
    this.actions.setChatMode("build");
    this.actions.setFixCycle(0);
    this.actions.setCompletionData(null);

    const plan: ManagerPlan = isDirect
      ? { mode: "direct" as const, summary: opts!.userMessage!, steps: [{ step: 1, title: opts!.userMessage!, description: opts!.userMessage! }], needs_input: [] }
      : existingPlan!;

    const normalizedSteps = normalizeSteps(plan);
    const messages = this.actions.getManagerMessages();
    const firstUserMsg = messages.find((m) => m.role === "user");
    const userRequest = isDirect ? opts!.userMessage! : (plan.summary || firstUserMsg?.content || "");
    const userLang = isDirect
      ? detectLanguage(opts!.userMessage!)
      : firstUserMsg ? detectLanguage(firstUserMsg.content) : "English";

    const files = this.actions.getFiles().map((f) => ({ path: f.path, content: f.content || "" }));
    const taskStatuses = this.actions.getTaskStatuses();
    const userConfirmation = this.userConfirmation;
    this.userConfirmation = "";

    const sessionId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    this.sessionId = sessionId;
    this.state.set({ sessionId });
    this.lastEventId = -1;
    this.reconnectRetry = 0;
    const myGen = ++this.generation;
    this.connectionErrorAdded = false;

    // Write localStorage key immediately alongside the loading indicator.
    // A refresh before POST completes leaves a key pointing to a session
    // that may not exist yet; attemptReconnect handles this with a short retry.
    try { localStorage.setItem(this.storageKey, sessionId); } catch {}
    this.state.set({ buildPhase: "thinking" });

    this.actionLog = [];
    this.state.set({ actionLog: [], thinkingText: "", thinkingElapsedSec: null });
    this.thinkingStartTime = null;

    // Accumulator state
    let thinkingAccumulated = "";
    let commAccumulated = "";
    let receivedAllComplete = false;
    this.currentStepNum = 0;

    let lastSnapshotFlush = 0;
    const flushSnapshot = () => {
      const now = Date.now();
      if (now - lastSnapshotFlush < 500) return;
      lastSnapshotFlush = now;
      this.actions.setStreamingSnapshot({
        type: "build",
        thinkingText: thinkingAccumulated,
        narrationText: commAccumulated,
        sessionId,
        projectId: this.projectId,
        updatedAt: now,
        lastEventId: this.lastEventId,
      });
    };

    try {
      // Pre-register the session so that a page refresh during the main POST
      // (which can take hundreds of ms for large file payloads) still finds the
      // session via /status. This is a fire-and-forget with keepalive so it
      // survives page unload.
      fetch("/api/build-session/pre-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
        keepalive: true,
      }).catch(() => {});

      const framework = useProjectStore.getState().projects.find((p) => p.id === this.projectId)?.framework;
      const response = await fetch("/api/build-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          mode: isDirect ? "direct" : "plan",
          ...(isDirect ? { userMessage: opts!.userMessage } : { plan, userRequest }),
          userLang,
          files,
          taskStatuses,
          userConfirmation: userConfirmation || undefined,
          projectId: this.projectId || undefined,
          framework: framework || undefined,
          // Include recent console errors for bug-fix context (direct mode only)
          ...(isDirect ? { consoleErrors: this.actions.getConsoleErrors?.() } : {}),
        }),
      });

      if (!response.ok) {
        this.actions.addManagerMessage({
          role: "assistant",
          content: tr(useLanguageStore.getState().lang, "chat.errorBuildStart"),
          source: "communicator",
        });
        this.state.set({ buildPhase: null });
        this.actions.setExecutingTaskIndex(null);
        this.actions.setAiResponding(false);
        return;
      }

      // POST succeeded — backend session now exists. Safe to persist the key
      // and show the loading indicator. A refresh after this point will find
      // the session via localStorage and can reconnect successfully.
      try { localStorage.setItem(this.storageKey, sessionId); } catch {}
      this.state.set({ buildPhase: "thinking" });

      const reader = response.body?.getReader();
      if (!reader) return;
      this.reader = reader;
      this.lastActivityTs = Date.now();

      const watchdog = createHeartbeatWatchdog(45000, () => {
        this._dbg("WATCHDOG FIRED 45s inactivity gen=" + myGen);
        try { reader.cancel(); } catch {}
      });

      this._dbg("parseSseStream starting gen=" + myGen);
      await parseSseStream<BuildSseEvent>(reader, {
        onHeartbeat: () => {
          this.lastActivityTs = Date.now();
          watchdog.reset();
        },
        validate: validateBuildEvent,
        onEvent: async (ev) => {
          this.lastActivityTs = Date.now();
          watchdog.reset();
          if (typeof ev.eventId === "number") this.lastEventId = ev.eventId;

          const type = ev.type;
          const isCurrentProject = this.actions.getProjectId() === this.projectId;

          if (KNOWN_BUILD_EVENT_TYPES.has(type)) {
            const content = ev.token || ev.label || ev.message || ev.filePath || type;
            useLLMMonitorStore.getState().addEvent(
              BUILD_SOURCE_MAP[type] || "editor",
              type as LLMEventType,
              typeof content === "string" ? content : String(content),
            );
          }

          // ─── Event handling ─────────────────────────────────────────
          if (type === "step_starting") {
            // Flush any pending thinking from the previous step before moving on
            if (thinkingAccumulated) {
              const lastIsThinking = this.actionLog.length > 0 &&
                this.actionLog[this.actionLog.length - 1].type === "thinking";
              if (!lastIsThinking) {
                this.appendActionLog({
                  type: "thinking",
                  label: "thinking",
                  detail: thinkingAccumulated,
                  timestamp: this.thinkingStartTime ?? Date.now(),
                });
              }
              thinkingAccumulated = "";
            }
            commAccumulated = "";
            this.state.set({ buildPhase: "thinking", thinkingText: "", narrationText: "", thinkingElapsedSec: null });
            this.thinkingStartTime = null;
            const stepNum = ev.stepNumber ?? 1;
            this.currentStepNum = stepNum; const currentStepNum = this.currentStepNum;
            this.appendActionLog({ type: "step", label: `Step ${stepNum}/${normalizedSteps.length}: ${ev.stepTitle || ""}`, detail: "", timestamp: Date.now() });
            // Emit plan action on first step — shows plan steps as detail
            if (stepNum === 1 && normalizedSteps.length > 0) {
              const planDetail = normalizedSteps
                .map((s) => `${s.step}. ${s.title}`)
                .join("\n");
              this.appendActionLog({
                type: "plan",
                label: `${normalizedSteps.length} 个步骤`,
                detail: planDetail,
                timestamp: Date.now(),
              });
            }
            if (isCurrentProject) {
              this.actions.setExecutingTaskIndex(stepNum - 1);
              this.actions.updateTaskStatus(String(stepNum), "running");
            }
            this.trackTaskStatus(String(stepNum), "running");
          } else if (type === "thinking_token") {
            const token = ev.token || "";
            if (token) {
              if (!this.thinkingStartTime) this.thinkingStartTime = Date.now();
              thinkingAccumulated += token;
              flushSnapshot();
              this.state.set({ thinkingText: thinkingAccumulated });
            }
          } else if (type === "narration_token" || type === "communicator_token") {
            // Flush thinking once at the start of narration phase, then clear it
            if (thinkingAccumulated) {
              const lastIsThinking = this.actionLog.length > 0 &&
                this.actionLog[this.actionLog.length - 1].type === "thinking";
              if (!lastIsThinking) {
                this.appendActionLog({
                  type: "thinking",
                  label: "thinking",
                  detail: thinkingAccumulated,
                  timestamp: this.thinkingStartTime ?? Date.now(),
                });
              }
              thinkingAccumulated = "";
            }
            commAccumulated += ev.token || "";
            flushSnapshot();
            // Write per-step narration so StepItem can display it inline
            const prevNarrations = this.state.get().stepNarrations;
            this.state.set({
              narrationText: commAccumulated,
              buildPhase: "working",
              stepNarrations: { ...prevNarrations, [this.currentStepNum]: commAccumulated },
            });
          } else if (type === "action_log") {
            const actionType = ev.actionType as ActionLogEntry["type"] | undefined;
            if (actionType) {
              this.appendActionLog({
                type: actionType,
                label: (ev.label as string) || "",
                detail: (ev.detail as string) || "",
                timestamp: Date.now(),
                filePath: (ev.filePath as string) || undefined,
                precedingNarration: commAccumulated || undefined,
              });
            }
          } else if (type === "code_applied") {
            // Write code_applied action entry so it shows in the step's action row
            const filePath = ev.filePath || "";
            this.appendActionLog({
              type: "code_applied",
              label: filePath.split("/").pop() || filePath,
              detail: "",
              timestamp: Date.now(),
              filePath: filePath || undefined,
              precedingNarration: commAccumulated || undefined,
            });
            this.state.set({ buildPhase: "working" });
            if (isCurrentProject) {
              const newCode = ev.code || "";
              const files = this.actions.getFiles();
              const oldContent = files.find((f) => f.path === filePath)?.content ?? "";
              this.actions.setLastBuildFileDiff(filePath, oldContent, newCode);
              await this.actions.applyCodeBlock({ filePath, code: newCode, language: "" });
              this.actions.refreshPreview();
            }
          } else if (type === "file_deleted") {
            const filePath = ev.filePath || "";
            this.appendActionLog({
              type: "file_delete",
              label: filePath.split("/").pop() || filePath,
              detail: "",
              timestamp: Date.now(),
              filePath: filePath || undefined,
              precedingNarration: commAccumulated || undefined,
            });
            if (isCurrentProject && filePath) {
              this.actions.deleteFile(filePath);
              this.actions.refreshPreview();
            }
          } else if (type === "step_completed") {
            const rawNum = ev.stepNumber;
            const parsedNum = typeof rawNum === "number" ? rawNum : parseInt(String(rawNum), 10);
            let resolvedKey: string;
            if (!isNaN(parsedNum)) {
              resolvedKey = String(parsedNum);
            } else {
              const matched = normalizedSteps.find((s) => s.sub_task_id === String(rawNum));
              resolvedKey = matched ? String(matched.step) : String(rawNum);
            }
            // Write the step summary from mark_step_complete into stepNarrations.
            // This is the authoritative one-line summary of what the step did —
            // zero latency, no extra LLM call, replaces the raw editor narration.
            const stepSummary = (ev.summary as string | undefined)?.trim() || "";
            if (stepSummary && !isNaN(parsedNum)) {
              const prev = this.state.get().stepNarrations;
              this.state.set({ stepNarrations: { ...prev, [parsedNum]: stepSummary } });
            }
            this.state.set({ narrationText: "" });
            commAccumulated = "";
            if (isCurrentProject) this.actions.updateTaskStatus(resolvedKey, "done");
            this.trackTaskStatus(resolvedKey, "done");
          } else if (type === "step_failed") {
            this.state.set({ narrationText: "" });
            commAccumulated = "";
            if (isCurrentProject) {
              const key = String(ev.stepNumber ?? 0);
              this.actions.updateTaskStatus(key, "failed");
              if (ev.reason) this.actions.setTaskFailureReason(key, ev.reason as string);
            }
          } else if (type === "build_complete") {
            // Build finished. Completion/cleanup is handled by all_complete; this
            // is just the deterministic "editor is done" signal. Review is a
            // separate, user-invoked step and is NOT part of the build stream.
            this.state.set({ narrationText: "" });
            commAccumulated = "";
          } else if (type === "capabilities_active") {
            const caps = Array.isArray(ev.capabilities)
              ? (ev.capabilities as Array<{ name: string; score?: number }>)
                  .map((c) => c.name)
                  .join("、")
              : "";
            this.appendActionLog({
              type: "capabilities",
              label: caps || "能力激活",
              detail: caps,
              timestamp: Date.now(),
              precedingNarration: commAccumulated || undefined,
            });
          } else if (type === "all_complete") {
            receivedAllComplete = true;
            if (isCurrentProject) {
              this.actions.createCheckpoint("Build complete", { includeManagerThread: true });
              normalizedSteps.forEach((step) => {
                const key = String(step.step);
                const s = this.actions.getTaskStatuses()[key];
                if (s === "bug" || s === "failed" || s === "running" || s === "pending") {
                  this.actions.updateTaskStatus(key, "done");
                }
              });
              this.actions.freezeLatestPlanStatuses();
              const changedFiles: string[] = ev.changedFiles || [];
              const summaryText = ev.summaryText || "";
              this.actions.setCompletionData({ changedFiles, summary: summaryText });
              if (this.actionLog.length > 0) {
                // Group by step entry — each "step" action_log entry starts a new segment.
                // Narration comes from stepNarrations (keyed by step number), which is populated
                // as communicator tokens arrive and finalized at step_completed. This is more
                // reliable than precedingNarration (which is empty when actions fire before narration).
                const stepNarrations = this.state.get().stepNarrations;
                const segs: Array<{ id: string; narration: string; actions: ActionLogEntry[]; isLive: boolean; stepLabel?: string }> = [];
                let currentSegStepNum = 0;
                for (const entry of this.actionLog) {
                  if (entry.type === "narration") continue;
                  if (entry.type === "step") {
                    // Extract step number from label e.g. "Step 2/4: ..."
                    const stepMatch = entry.label?.match(/Step\s*(\d+)/i);
                    currentSegStepNum = stepMatch ? parseInt(stepMatch[1], 10) : currentSegStepNum + 1;
                    const narration = stepNarrations[currentSegStepNum] ?? "";
                    segs.push({ id: String(segs.length), narration, actions: [], isLive: false, stepLabel: entry.label });
                  } else {
                    if (segs.length === 0) segs.push({ id: "0", narration: stepNarrations[1] ?? "", actions: [], isLive: false });
                    segs[segs.length - 1].actions.push(entry);
                  }
                }
                this._dbg("all_complete: actionLog.length=" + this.actionLog.length + " segs.length=" + segs.length);
                this.actions.addManagerMessage({
                  role: "assistant",
                  content: "",
                  buildResult: {
                    actionLog: [...this.actionLog],
                    segments: segs,
                    completionData: { changedFiles, summary: summaryText },
                    tokenUsage: ev.tokenUsage as { input: number; output: number; total: number } | undefined,
                  },
                });
                this._dbg("all_complete: addManagerMessage called with buildResult");
              } else {
                this._dbg("all_complete: actionLog EMPTY, skipping buildResult message");
              }
            }
            this.actions.setStreamingSnapshot(null);
            try { localStorage.removeItem(this.storageKey); } catch {}
            this.state.set({ buildPhase: null });
            this.actions.setExecutingTaskIndex(null);
            // The finalized build is now persisted as a buildResult message; clear
            // the live action-log/thinking/narration so the live BuildLivePanel
            // stops rendering a duplicate of the same content below the plan card.
            // (Without this it shows twice until a refresh wipes the live state.)
            this.clearLive();

            // Refresh preview immediately (files were applied live via
            // code_applied), then reconcile against the server's authoritative
            // copy to catch any files the live stream missed.
            if (isCurrentProject) {
              this.actions.refreshPreview();
              this.refreshFilesAfterBuild();
            }
          } else if (type === "done") {
            // Final cleanup handled in finally
          } else if (type === "build_error") {
            this.state.set({ buildPhase: null });
            this.actions.setExecutingTaskIndex(null);
            if (isCurrentProject && !this.connectionErrorAdded) {
              this.connectionErrorAdded = true;
              this.actions.addManagerMessage({
                role: "assistant",
                content: tr(useLanguageStore.getState().lang, "chat.errorBuildGeneric"),
                source: "communicator",
              });
            }
          }
        },
      });

      watchdog.clear();
      this._dbg("parseSseStream exited normally gen=" + myGen + " allComplete=" + receivedAllComplete);
    } catch (error: unknown) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const stillCurrent = myGen === this.generation;
      this._dbg("CATCH isAbort=" + isAbort + " stillCurrent=" + stillCurrent + " sessionId=" + this.sessionId + " allComplete=" + receivedAllComplete + " gen=" + myGen + "/" + this.generation + " err=" + (error instanceof Error ? error.message : String(error)));

      // If all_complete was already received, the build finished successfully —
      // don't attempt reconnection or show error for the stream closing.
      if (!receivedAllComplete && !isAbort && stillCurrent && this.sessionId) {
        if (this.reconnectRetry < 10) {
          this.scheduleReconnect();
          return;
        }
        if (!this.connectionErrorAdded && this.actions.getProjectId() === this.projectId) {
          this.connectionErrorAdded = true;
          this.actions.addManagerMessage({
            role: "assistant",
            content: tr(useLanguageStore.getState().lang, "chat.errorBuildInterrupted"),
            source: "communicator",
          });
        }
      }
    } finally {
      this._dbg("FINALLY gen=" + myGen + "/" + this.generation + " allComplete=" + receivedAllComplete + " reconnectTimer=" + !!this.reconnectTimer);
      if (this.heartbeatWatchdog) { clearTimeout(this.heartbeatWatchdog); this.heartbeatWatchdog = null; }
      const isCurrentGen = myGen === this.generation;
      if (isCurrentGen) {
        this.sessionId = null;
        this.state.set({ sessionId: null, isReconnecting: false });
        this.reader = null;
        // Only remove the localStorage key if we are NOT waiting to reconnect.
        // If reconnectTimer is set, we still need the key for the next attempt
        // (e.g. page refresh while waiting for reconnect).
        if (!this.reconnectTimer) {
          try { localStorage.removeItem(this.storageKey); } catch {}
        }
        if (this.thinkingFadeTimer) { clearTimeout(this.thinkingFadeTimer); this.thinkingFadeTimer = null; }
      }
      // Only clear build UI state if all_complete didn't already handle it.
      // When all_complete fires, it persists the build result and clears the
      // live panel. Running this again is redundant — and if we got here via
      // a watchdog timeout BEFORE all_complete, we should attempt reconnection
      // (handled in catch above), not show a false "completed" state.
      if (isCurrentGen && !receivedAllComplete) {
        this._dbg("FINALLY: clearing build state (no all_complete)");
        this.actions.setStreamingSnapshot(null);
        this.state.set({ buildPhase: null });
        this.clearLive();
        if (this.actions.getProjectId() === this.projectId) {
          // 不在这里把步骤标记为 done — 如果后端还在跑，步骤尚未完成，
          // 错误地标记 done 会让 plan card 显示全部完成但实际没完成。
          // 只有 all_complete 事件到来时才标记完成。
          // 如果 session 结束时还有 pending/running 步骤，保持原状，
          // 下次重连后会从后端拉取真实状态。
          this.actions.setExecutingTaskIndex(null);
          this.actions.setAiResponding(false);
        }
      } else if (isCurrentGen && receivedAllComplete) {
        // all_complete already cleaned up build state; just ensure
        // aiResponding is cleared so the input box re-enables.
        if (this.actions.getProjectId() === this.projectId) {
          this.actions.setAiResponding(false);
        }
      }
    }
  }

  /**
   * Reconnect to an existing build session.
   */
  async connect(sessionId: string, lastEventId: number): Promise<void> {
    if (this.disposed) return;
    this.sessionId = sessionId;
    this.state.set({ sessionId, isReconnecting: true });
    const myGen = ++this.generation;

    const plan = this.actions.getManagerPlan();
    const nSteps = plan ? normalizeSteps(plan) : [];
    const messages = this.actions.getManagerMessages();
    const firstUserMsg = messages.find((m) => m.role === "user");
    const userLang = firstUserMsg ? detectLanguage(firstUserMsg.content || "") : "English";

    this.clearLiveTimer();

    let thinkingAccumulated = "";
    let commAccumulated = "";
    let receivedAllComplete = false;
    const snapshot = this.actions.getStreamingSnapshot();
    if (snapshot?.type === "build") {
      thinkingAccumulated = snapshot.thinkingText || "";
      commAccumulated = snapshot.narrationText || "";
    }

    try {
      const response = await fetch(
        `/api/build-session/${sessionId}/stream?lastEventId=${lastEventId}`,
        { cache: "no-store", headers: { "Cache-Control": "no-cache" } },
      );
      if (!response.ok || !response.body) {
        this.sessionId = null;
        this.state.set({ sessionId: null, isReconnecting: false });
        try { localStorage.removeItem(this.storageKey); } catch {}
        return;
      }

      const reader = response.body.getReader();
      this.reader = reader;
      this.lastActivityTs = Date.now();
      this.state.set({ isReconnecting: false });
      this.reconnectRetry = 0;

      const watchdog = createHeartbeatWatchdog(45000, () => {
        try { reader.cancel(); } catch {}
      });

      await parseSseStream<BuildSseEvent>(reader, {
        onHeartbeat: () => { this.lastActivityTs = Date.now(); watchdog.reset(); },
        validate: validateBuildEvent,
        onEvent: async (ev) => {
          this.lastActivityTs = Date.now();
          watchdog.reset();
          if (typeof ev.eventId === "number") this.lastEventId = ev.eventId;
          const type = ev.type;
          const isCurrentProject = this.actions.getProjectId() === this.projectId;

          if (type === "step_starting") {
            // Flush pending thinking from previous step
            if (thinkingAccumulated) {
              const lastIsThinking = this.actionLog.length > 0 &&
                this.actionLog[this.actionLog.length - 1].type === "thinking";
              if (!lastIsThinking) {
                this.appendActionLog({
                  type: "thinking",
                  label: "thinking",
                  detail: thinkingAccumulated,
                  timestamp: Date.now(),
                });
              }
              thinkingAccumulated = "";
            }
            const stepNum = ev.stepNumber ?? 1;
            this.state.set({ buildPhase: "thinking", thinkingText: "", narrationText: "" });
            commAccumulated = "";
            if (isCurrentProject) {
              this.actions.setExecutingTaskIndex(stepNum - 1);
              this.actions.updateTaskStatus(String(stepNum), "running");
            }
            this.trackTaskStatus(String(stepNum), "running");
          } else if (type === "action_log") {
            const actionType = ev.actionType as ActionLogEntry["type"] | undefined;
            if (actionType) {
              this.appendActionLog({
                type: actionType,
                label: (ev.label as string) || "",
                detail: (ev.detail as string) || "",
                timestamp: Date.now(),
                filePath: (ev.filePath as string) || undefined,
                precedingNarration: commAccumulated || undefined,
              });
            }
          } else if (type === "thinking_token") {
            thinkingAccumulated += ev.token || "";
            this.state.set({ thinkingText: thinkingAccumulated });
          } else if (type === "narration_token" || type === "communicator_token") {
            // Flush thinking once at narration start
            if (thinkingAccumulated) {
              const lastIsThinking = this.actionLog.length > 0 &&
                this.actionLog[this.actionLog.length - 1].type === "thinking";
              if (!lastIsThinking) {
                this.appendActionLog({
                  type: "thinking",
                  label: "thinking",
                  detail: thinkingAccumulated,
                  timestamp: Date.now(),
                });
              }
              thinkingAccumulated = "";
            }
            commAccumulated += ev.token || "";
            this.state.set({ narrationText: commAccumulated, buildPhase: "working" });
          } else if (type === "step_completed") {
            this.state.set({ narrationText: "" });
            commAccumulated = "";
            if (isCurrentProject) {
              const key = String(ev.stepNumber ?? 0);
              this.actions.updateTaskStatus(key, "done");
            }
          } else if (type === "build_complete") {
            this.state.set({ narrationText: "" });
            commAccumulated = "";
          } else if (type === "all_complete") {
            receivedAllComplete = true;
            if (isCurrentProject) {
              nSteps.forEach((step) => {
                const key = String(step.step);
                const s = this.actions.getTaskStatuses()[key];
                if (s !== "done") this.actions.updateTaskStatus(key, "done");
              });
              this.actions.freezeLatestPlanStatuses();
              const changedFiles2: string[] = ev.changedFiles || [];
              const summaryText2 = ev.summaryText || "";
              this.actions.setCompletionData({ changedFiles: changedFiles2, summary: summaryText2 });
              if (this.actionLog.length > 0) {
                const segs2: Array<{ id: string; narration: string; actions: ActionLogEntry[]; isLive: boolean; stepLabel?: string }> = [];
                for (const entry of this.actionLog) {
                  if (entry.type === "narration") continue;
                  if (entry.type === "step") {
                    segs2.push({ id: String(segs2.length), narration: "", actions: [], isLive: false, stepLabel: entry.label });
                  } else {
                    if (segs2.length === 0) segs2.push({ id: "0", narration: "", actions: [], isLive: false });
                    const last = segs2[segs2.length - 1];
                    if (!last.narration && entry.precedingNarration) {
                      last.narration = entry.precedingNarration;
                    }
                    last.actions.push(entry);
                  }
                }
                this.actions.addChatMessage({
                  role: "assistant",
                  content: "",
                  buildResult: {
                    actionLog: [...this.actionLog],
                    segments: segs2,
                    completionData: { changedFiles: changedFiles2, summary: summaryText2 },
                  } as any,
                });
              }
              // Background build finished while we were away: pull the latest
              // files and refresh the preview so the user sees the result
              // without a manual page refresh. The primary path does this via
              // code_applied events, but on reconnect those were already
              // consumed server-side, so refetch here.
              this.refreshFilesAfterBuild();
            }
            this.actions.setStreamingSnapshot(null);
            try { localStorage.removeItem(this.storageKey); } catch {}
            this.state.set({ buildPhase: null });
            this.actions.setExecutingTaskIndex(null);
            // Clear live state so the BuildLivePanel doesn't duplicate the
            // finalized buildResult card (see primary all_complete path).
            this.clearLive();
          } else if (type === "done") {
            // handled in finally
          } else if (type === "build_error") {
            this.state.set({ buildPhase: null });
            this.actions.setExecutingTaskIndex(null);
          }
        },
      });

      watchdog.clear();
    } catch (error: unknown) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      if (!receivedAllComplete && !isAbort && myGen === this.generation && this.sessionId) {
        this.scheduleReconnect();
      }
    } finally {
      if (myGen === this.generation && !this.reconnectTimer) {
        this.state.set({ sessionId: null, isReconnecting: false });
        this.sessionId = null;
        this.reader = null;
        try { localStorage.removeItem(this.storageKey); } catch {}
        if (!receivedAllComplete) {
          this.actions.setStreamingSnapshot(null);
          this.state.set({ buildPhase: null });
          this.clearLive();
          if (this.actions.getProjectId() === this.projectId) {
            this.actions.setExecutingTaskIndex(null);
            this.actions.setAiResponding(false);
          }
        } else {
          // all_complete already cleaned up build state; just ensure
          // aiResponding is cleared so the input box re-enables.
          if (this.actions.getProjectId() === this.projectId) {
            this.actions.setAiResponding(false);
          }
        }
      }
    }
  }

  /**
   * Stop the current build.
   */
  stop(): void {
    this._dbg("stop() called sessionId=" + this.sessionId);
    if (this.sessionId) {
      fetch(`/api/build-session/${this.sessionId}`, { method: "DELETE" }).catch(() => {});
    }
    this.abort();
    this.state.set({ buildPhase: null });
    this.actions.setExecutingTaskIndex(null);
    this.actions.setAiResponding(false);
    this.clearLive();
  }

  /**
   * Attempt to reconnect to an active build session for this project.
   */
  async attemptReconnect(): Promise<void> {
    if (this.disposed || this.sessionId) return;

    const savedSessionId = (() => {
      try { return localStorage.getItem(this.storageKey); }
      catch { return null; }
    })();

    if (!savedSessionId) {
      // 不再 fallback 到 /active/${projectId}：该接口只按 projectId 查活跃 build，
      // 不区分 chatSessionId，会导致新会话误重连到其他会话的 build 流（session 串流）。
      // 只通过本会话 localStorage key 保存的 sessionId 重连。
      return;
    }

    // Check session status — retry once after a short delay in case the page
    // was refreshed while the POST /api/build-session was still in-flight
    // (session exists in backend but response hadn't arrived yet).
    this.state.set({ isReconnecting: true });
    const checkStatus = async (): Promise<{ active: boolean } | null> => {
      try {
        const resp = await fetch(`/api/build-session/${savedSessionId}/status`, {
          cache: "no-store", headers: { "Cache-Control": "no-cache" },
        });
        return resp.ok ? await resp.json() : null;
      } catch { return null; }
    };

    try {
      let data = await checkStatus();

      // 404 / inactive: the POST may still be in-flight. Wait up to 2s with
      // 500ms polls before giving up so a fast refresh doesn't miss the session.
      if (!data?.active) {
        for (let i = 0; i < 4 && !data?.active; i++) {
          await new Promise((r) => setTimeout(r, 500));
          if (this.disposed || this.sessionId) return; // aborted or new send started
          data = await checkStatus();
        }
      }

      if (data?.active) {
        this.actions.setExecutingTaskIndex(0);
        this.actions.setChatMode("build");
        this.state.set({ buildPhase: "thinking" });
        await this.connect(savedSessionId, -1);
      } else {
        try { localStorage.removeItem(this.storageKey); } catch {}
        this.state.set({ isReconnecting: false });
      }
    } catch {
      try { localStorage.removeItem(this.storageKey); } catch {}
      this.state.set({ isReconnecting: false });
    }
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    this._dbg("dispose()");
    this.disposed = true;
    this.abort();
    this.clearTimers();
    this.state.reset({ ...INITIAL_BUILD_STREAM_STATE });
  }

  /**
   * Reset live UI state without disposing the instance.
   * Used when switching INTO this session's slot so stale build output from a
   * previous run doesn't bleed into the freshly-shown session.
   */
  resetLive(): void {
    this._dbg("resetLive() isActive=" + this.isActive);
    this.state.reset({ ...INITIAL_BUILD_STREAM_STATE });
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private abort(): void {
    this._dbg("abort() hasReader=" + !!this.reader);
    if (this.reader) {
      this.reader.cancel().catch(() => {});
      this.reader = null;
    }
    this.sessionId = null;
    this.state.set({ sessionId: null });
    try { localStorage.removeItem(this.storageKey); } catch {}
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectRetry), 15000);
    this.reconnectRetry++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.sessionId && !this.disposed) {
        this.connect(this.sessionId, this.lastEventId).catch(() => {});
      }
    }, delay);
  }

  private appendActionLog(entry: ActionLogEntry): void {
    // 给每个 entry 打上当前步骤号，供前端分段渲染使用
    const entryWithStep = entry.stepNum !== undefined ? entry : { ...entry, stepNum: this.currentStepNum };
    this.actionLog.push(entryWithStep);
    this.state.set({ actionLog: [...this.actionLog] });
  }

  /** Track task status in per-session state (survives project switch). */
  private trackTaskStatus(key: string, status: "running" | "done" | "failed"): void {
    const prev = this.state.get().taskStatuses;
    this.state.set({ taskStatuses: { ...prev, [key]: status } });
  }

  /**
   * Restore per-session task statuses into the global store. Call when the
   * user returns to this project after viewing another one.
   */
  restoreTaskStatuses(): void {
    const statuses = this.state.get().taskStatuses;
    const keys = Object.keys(statuses);
    if (keys.length === 0) return;
    for (const key of keys) {
      this.actions.updateTaskStatus(key, statuses[key]);
    }
    // Also restore executingTaskIndex to the highest running step
    const runningSteps = keys.filter(k => statuses[k] === "running").map(Number).filter(n => !isNaN(n));
    if (runningSteps.length > 0) {
      this.actions.setExecutingTaskIndex(Math.max(...runningSteps) - 1);
    }
  }

  /**
   * Pull the latest files from the server and apply any that changed, then
   * refresh the preview. Used after a build completes on the reconnect path,
   * where the per-file code_applied events were already consumed server-side
   * and the local file tree is stale. Without this the user must refresh the
   * page to see the build result.
   */
  private async refreshFilesAfterBuild(): Promise<void> {
    if (this.actions.getProjectId() !== this.projectId) return;
    try {
      const resp = await fetch(`/api/projects/${this.projectId}/files`, {
        cache: "no-store", headers: { "Cache-Control": "no-cache" },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const files: Array<{ path: string; content: string }> = data?.files ?? [];
      if (!files.length) return;
      if (this.actions.getProjectId() !== this.projectId) return;
      const current = new Map(this.actions.getFiles().map((f) => [f.path, f.content ?? ""]));
      for (const f of files) {
        if (current.get(f.path) !== f.content) {
          await this.actions.applyCodeBlock({ filePath: f.path, code: f.content, language: "" });
        }
      }
      this.actions.refreshPreview();
    } catch {
      // Network failure — leave existing files; user can refresh manually.
    }
  }

  private clearLive(): void {
    // Keep stepNarrations — narration tokens can arrive after all_complete,
    // and BuildLivePanel uses them to fill persisted segment narrations.
    this.state.set({ thinkingText: "", narrationText: "", actionLog: [] });
  }

  private clearLiveTimer(): void {
    if (this.liveClearTimer) { clearTimeout(this.liveClearTimer); this.liveClearTimer = null; }
  }

  private clearTimers(): void {
    this.clearLiveTimer();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.heartbeatWatchdog) { clearTimeout(this.heartbeatWatchdog); this.heartbeatWatchdog = null; }
    if (this.thinkingFadeTimer) { clearTimeout(this.thinkingFadeTimer); this.thinkingFadeTimer = null; }
  }
}
