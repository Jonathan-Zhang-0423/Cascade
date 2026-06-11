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
import type { ManagerPlan } from "@/stores/ide-store";
import type { BuildPhase } from "@/components/ide/chat/BuildPhaseIndicator";

/**
 * BuildStreamInstance — owns the SSE connection and live state for a single
 * project's build stream. Not tied to React lifecycle.
 */
export class BuildStreamInstance {
  readonly projectId: string;
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
  userConfirmation = "";

  constructor(projectId: string, actions: StoreActions) {
    this.projectId = projectId;
    this.actions = actions;
    this.state = new ObservableState<BuildStreamState>({ ...INITIAL_BUILD_STREAM_STATE });
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

    const isDirect = !!opts?.userMessage;
    const existingPlan = this.actions.getManagerPlan();
    if (!isDirect && !existingPlan) return;

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
      if (stillActive) return;
      this.sessionId = null;
      this.reader = null;
      try { localStorage.removeItem(`cascade-build-session-${this.projectId}`); } catch {}
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
    this.state.set({ buildPhase: "thinking" });
    this.actions.setChatMode("build");
    this.actions.setFixCycle(0);
    this.actions.setHolisticReview(null);
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

    try { localStorage.setItem(`cascade-build-session-${this.projectId}`, sessionId); } catch {}

    this.actionLog = [];
    this.state.set({ actionLog: [], thinkingText: "", thinkingElapsedSec: null });
    this.thinkingStartTime = null;

    // Accumulator state
    let thinkingAccumulated = "";
    let commAccumulated = "";

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

      const reader = response.body?.getReader();
      if (!reader) return;
      this.reader = reader;
      this.lastActivityTs = Date.now();

      const watchdog = createHeartbeatWatchdog(15000, () => {
        try { reader.cancel(); } catch {}
      });

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
            thinkingAccumulated = "";
            commAccumulated = "";
            this.state.set({ buildPhase: "thinking", thinkingText: "", narrationText: "", thinkingElapsedSec: null });
            this.thinkingStartTime = null;
            const stepNum = ev.stepNumber ?? 1;
            this.appendActionLog({ type: "step", label: `Step ${stepNum}/${normalizedSteps.length}: ${ev.stepTitle || ""}`, detail: "", timestamp: Date.now() });
            if (isCurrentProject) {
              this.actions.setExecutingTaskIndex(stepNum - 1);
              this.actions.updateTaskStatus(String(stepNum), "running");
            }
          } else if (type === "thinking_token") {
            const token = ev.token || "";
            if (token) {
              if (!this.thinkingStartTime) this.thinkingStartTime = Date.now();
              thinkingAccumulated += token;
              flushSnapshot();
              this.state.set({ thinkingText: thinkingAccumulated });
            }
          } else if (type === "narration_token" || type === "communicator_token") {
            // Transition from thinking to working
            if (thinkingAccumulated && this.thinkingFadeTimer === null) {
              this.thinkingFadeTimer = setTimeout(() => {
                this.state.set({ thinkingText: "" });
                this.thinkingFadeTimer = null;
              }, 400);
            }
            commAccumulated += ev.token || "";
            flushSnapshot();
            this.state.set({ narrationText: commAccumulated, buildPhase: "working" });
          } else if (type === "code_applied") {
            this.state.set({ buildPhase: "working" });
            if (isCurrentProject) {
              const filePath = ev.filePath || "";
              const newCode = ev.code || "";
              const files = this.actions.getFiles();
              const oldContent = files.find((f) => f.path === filePath)?.content ?? "";
              this.actions.setLastBuildFileDiff(filePath, oldContent, newCode);
              await this.actions.applyCodeBlock({ filePath, code: newCode, language: "" });
              this.actions.refreshPreview();
            }
          } else if (type === "step_completed") {
            this.state.set({ narrationText: "" });
            commAccumulated = "";
            const rawNum = ev.stepNumber;
            const parsedNum = typeof rawNum === "number" ? rawNum : parseInt(String(rawNum), 10);
            let resolvedKey: string;
            if (!isNaN(parsedNum)) {
              resolvedKey = String(parsedNum);
            } else {
              const matched = normalizedSteps.find((s) => s.sub_task_id === String(rawNum));
              resolvedKey = matched ? String(matched.step) : String(rawNum);
            }
            if (isCurrentProject) this.actions.updateTaskStatus(resolvedKey, "done");
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
          } else if (type === "all_complete") {
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
            }
            this.actions.setStreamingSnapshot(null);
            try { localStorage.removeItem(`cascade-build-session-${this.projectId}`); } catch {}
            this.state.set({ buildPhase: null });
            this.actions.setExecutingTaskIndex(null);

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
    } catch (error: unknown) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const stillCurrent = myGen === this.generation;

      if (!isAbort && stillCurrent && this.sessionId) {
        if (this.reconnectRetry < 3) {
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
      if (this.heartbeatWatchdog) { clearTimeout(this.heartbeatWatchdog); this.heartbeatWatchdog = null; }
      const isCurrentGen = myGen === this.generation;
      if (isCurrentGen) {
        this.sessionId = null;
        this.state.set({ sessionId: null, isReconnecting: false });
        this.reader = null;
        try { localStorage.removeItem(`cascade-build-session-${this.projectId}`); } catch {}
        if (this.thinkingFadeTimer) { clearTimeout(this.thinkingFadeTimer); this.thinkingFadeTimer = null; }
      }
      if (isCurrentGen) {
        this.actions.setStreamingSnapshot(null);
        this.state.set({ buildPhase: null });
        this.clearLive();
        if (this.actions.getProjectId() === this.projectId) {
          normalizedSteps.forEach((step) => {
            const key = String(step.step);
            const s = this.actions.getTaskStatuses()[key];
            if (s === "pending" || s === "running") this.actions.updateTaskStatus(key, "done");
          });
          this.actions.setExecutingTaskIndex(null);
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

    // Restore from snapshot
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
        try { localStorage.removeItem(`cascade-build-session-${this.projectId}`); } catch {}
        return;
      }

      const reader = response.body.getReader();
      this.reader = reader;
      this.lastActivityTs = Date.now();
      this.state.set({ isReconnecting: false });
      this.reconnectRetry = 0;

      const watchdog = createHeartbeatWatchdog(15000, () => {
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
            const stepNum = ev.stepNumber ?? 1;
            this.state.set({ buildPhase: "thinking", thinkingText: "", narrationText: "" });
            thinkingAccumulated = "";
            commAccumulated = "";
            if (isCurrentProject) {
              this.actions.setExecutingTaskIndex(stepNum - 1);
              this.actions.updateTaskStatus(String(stepNum), "running");
            }
          } else if (type === "thinking_token") {
            thinkingAccumulated += ev.token || "";
            this.state.set({ thinkingText: thinkingAccumulated });
          } else if (type === "narration_token" || type === "communicator_token") {
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
            if (isCurrentProject) {
              nSteps.forEach((step) => {
                const key = String(step.step);
                const s = this.actions.getTaskStatuses()[key];
                if (s !== "done") this.actions.updateTaskStatus(key, "done");
              });
              this.actions.freezeLatestPlanStatuses();
              this.actions.setCompletionData({
                changedFiles: ev.changedFiles || [],
                summary: ev.summaryText || "",
              });
              // Background build finished while we were away: pull the latest
              // files and refresh the preview so the user sees the result
              // without a manual page refresh. The primary path does this via
              // code_applied events, but on reconnect those were already
              // consumed server-side, so refetch here.
              this.refreshFilesAfterBuild();
            }
            this.actions.setStreamingSnapshot(null);
            try { localStorage.removeItem(`cascade-build-session-${this.projectId}`); } catch {}
            this.state.set({ buildPhase: null });
            this.actions.setExecutingTaskIndex(null);
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
      if (!isAbort && myGen === this.generation && this.sessionId) {
        this.scheduleReconnect();
      }
    } finally {
      if (myGen === this.generation && !this.reconnectTimer) {
        this.state.set({ sessionId: null, isReconnecting: false });
        this.sessionId = null;
        this.reader = null;
        try { localStorage.removeItem(`cascade-build-session-${this.projectId}`); } catch {}
        this.actions.setStreamingSnapshot(null);
        this.state.set({ buildPhase: null });
        this.clearLive();
        if (this.actions.getProjectId() === this.projectId) {
          this.actions.setExecutingTaskIndex(null);
          this.actions.setAiResponding(false);
        }
      }
    }
  }

  /**
   * Stop the current build.
   */
  stop(): void {
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
      try { return localStorage.getItem(`cascade-build-session-${this.projectId}`); }
      catch { return null; }
    })();

    if (!savedSessionId) {
      // Try active endpoint
      try {
        const resp = await fetch(`/api/build-session/active/${this.projectId}`, {
          cache: "no-store", headers: { "Cache-Control": "no-cache" },
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.sessionId && data?.active === true) {
            this.actions.setExecutingTaskIndex(0);
            this.actions.setChatMode("build");
            this.state.set({ buildPhase: "thinking" });
            await this.connect(data.sessionId, -1);
          }
        }
      } catch {}
      return;
    }

    // Check session status
    this.state.set({ isReconnecting: true });
    try {
      const resp = await fetch(`/api/build-session/${savedSessionId}/status`, {
        cache: "no-store", headers: { "Cache-Control": "no-cache" },
      });
      const data = resp.ok ? await resp.json() : null;
      if (data?.active) {
        this.actions.setExecutingTaskIndex(0);
        this.actions.setChatMode("build");
        this.state.set({ buildPhase: "thinking" });
        await this.connect(savedSessionId, -1);
      } else {
        try { localStorage.removeItem(`cascade-build-session-${this.projectId}`); } catch {}
        this.state.set({ isReconnecting: false });
      }
    } catch {
      try { localStorage.removeItem(`cascade-build-session-${this.projectId}`); } catch {}
      this.state.set({ isReconnecting: false });
    }
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    this.disposed = true;
    this.abort();
    this.clearTimers();
    this.state.reset({ ...INITIAL_BUILD_STREAM_STATE });
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private abort(): void {
    if (this.reader) {
      this.reader.cancel().catch(() => {});
      this.reader = null;
    }
    this.sessionId = null;
    this.state.set({ sessionId: null });
    try { localStorage.removeItem(`cascade-build-session-${this.projectId}`); } catch {}
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
    this.actionLog.push(entry);
    this.state.set({ actionLog: [...this.actionLog] });
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
