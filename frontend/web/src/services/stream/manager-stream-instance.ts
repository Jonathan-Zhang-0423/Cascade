import { ObservableState } from "./observable-state";
import {
  type ManagerStreamState,
  type StoreActions,
  type StreamingSnapshot,
  INITIAL_MANAGER_STREAM_STATE,
} from "./types";
import type { ActionLogEntry, ManagerSseEvent } from "@/components/ide/chat/chat-types";
import {
  KNOWN_MGR_EVENT_TYPES,
  MGR_SOURCE_MAP,
  PROJECT_NAME_REGEX,
  validateManagerEvent,
} from "@/components/ide/chat/chat-types";
import { stripProjectNameMarker } from "@/components/ide/chat/chat-utils";
import { parseSseStream } from "@/components/ide/chat/hooks/useSSEStream";
import { useLLMMonitorStore, type LLMEventType } from "@/stores/llm-monitor-store";
import { useLanguageStore } from "@/stores/language-store";
import { tr } from "@/lib/i18n";
import { useProjectStore } from "@/stores/project-store";

/**
 * ManagerStreamInstance — owns the SSE connection and live state for a single
 * project's manager (planning) stream. Not tied to React lifecycle.
 */
export class ManagerStreamInstance {
  readonly projectId: string;
  readonly state: ObservableState<ManagerStreamState>;

  private actions: StoreActions;
  private abortController: AbortController | null = null;
  private reconnectAbortController: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private sessionId: string | null = null;
  // Set synchronously the instant send() begins — BEFORE the POST resolves and
  // the server's session_id event arrives. isActive must reflect this so the
  // mount-time attemptReconnect() (fires ~200ms after project load) cannot race
  // an in-flight send, find the same session via /active, and replay it from
  // event 0 — which rendered the reply twice on a fresh project.
  private sendInFlight = false;
  private lastEventId = -1;
  private lastActivityTs = 0;
  private generation = 0;
  private reconnectRetry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private liveClearTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionErrorAdded = false;
  private disposed = false;
  autoExecutePlan = false;

  constructor(projectId: string, actions: StoreActions) {
    this.projectId = projectId;
    this.actions = actions;
    this.state = new ObservableState<ManagerStreamState>({ ...INITIAL_MANAGER_STREAM_STATE });
  }

  // ─── Public API ───────────────────────────────────────────────────────

  get isActive(): boolean {
    return this.sendInFlight || this.sessionId !== null;
  }

  /**
   * Send a new manager message and start the planning stream.
   */
  async send(message: string): Promise<boolean> {
    if (this.disposed) return false;
    const trimmed = message.trim();
    if (!trimmed) return false;

    // Readiness guards run BEFORE mutating any state. If the store is still
    // showing another project, bail. If this project's messages haven't loaded
    // from the DB yet, don't swallow the prompt (which used to append the user
    // message, return false, and leave nothing running — forcing the user to
    // resend and piling up duplicate messages). Instead wait briefly for the
    // async load and retry.
    if (this.actions.getProjectId() !== this.projectId) {
      return false;
    }
    if (!this.actions.getMessagesReady()) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        if (this.disposed || this.actions.getProjectId() !== this.projectId) return false;
        if (this.actions.getMessagesReady()) break;
      }
      // Still not ready after waiting — give up without mutating state.
      if (!this.actions.getMessagesReady()) return false;
    }

    // Mark in-flight synchronously so a concurrent mount-time reconnect can't
    // race this send (see field comment). Cleared in the finally block.
    this.sendInFlight = true;
    this.clearLiveTimer();
    this.actions.addManagerMessage({ role: "user", content: trimmed });
    this.actions.setManagerResponding(true);
    this.connectionErrorAdded = false;
    this.resetInactivityTimer();
    this.state.set({
      preparingPlan: false,
      thinkingText: "",
      narrationText: "",
      actionLog: [],
    });

    const historyMessages = this.actions.getManagerMessages()
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content && !m.typing)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const controller = new AbortController();
    this.abortController = controller;

    let managerAccumulated = "";
    let managerThinkingAccumulated = "";
    let commAccumulated = "";
    let planEmitted = false;
    const myGen = ++this.generation;
    let mgrDoneSeen = false;

    let lastSnapshotFlush = 0;
    const SNAPSHOT_INTERVAL = 500;
    const flushSnapshot = () => {
      const now = Date.now();
      if (now - lastSnapshotFlush < SNAPSHOT_INTERVAL) return;
      lastSnapshotFlush = now;
      if (this.sessionId) {
        this.actions.setStreamingSnapshot({
          type: "manager",
          thinkingText: managerThinkingAccumulated,
          narrationText: managerAccumulated,
          projectId: this.projectId,
          updatedAt: now,
          sessionId: this.sessionId,
          lastEventId: this.lastEventId,
        });
      }
    };

    try {
      const files = this.actions.getFiles().map((f) => ({ path: f.path, content: f.content || "" }));
      const response = await fetch("/api/manager-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: historyMessages,
          files,
          projectId: this.projectId,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        this.handleStreamError("connect");
        return false;
      }

      const reader = response.body.getReader();
      this.reader = reader;
      this.lastActivityTs = Date.now();

      await parseSseStream<ManagerSseEvent>(reader, {
        signal: controller.signal,
        validate: validateManagerEvent,
        onHeartbeat: () => { this.lastActivityTs = Date.now(); },
        onEvent: async (ev) => {
          this.lastActivityTs = Date.now();
          this.resetInactivityTimer();
          if (typeof ev.eventId === "number") this.lastEventId = ev.eventId;

          const evType = ev.type;

          if (evType === "session_id") {
            this.sessionId = ev.sessionId || "";
            this.state.set({ sessionId: this.sessionId });
            this.reconnectRetry = 0;
            if (this.projectId && ev.sessionId) {
              try { localStorage.setItem(`cascade-mgr-session-${this.projectId}`, ev.sessionId); } catch {}
            }
            return;
          }

          if (KNOWN_MGR_EVENT_TYPES.has(evType)) {
            const source = MGR_SOURCE_MAP[evType] || "manager";
            const monitorContent = ev.token || ev.label || evType;
            useLLMMonitorStore.getState().addEvent(
              source,
              evType as LLMEventType,
              typeof monitorContent === "string" ? monitorContent : String(monitorContent),
            );
          }

          const isCurrentProject = this.actions.getProjectId() === this.projectId;

          if (evType === "thinking_token") {
            managerThinkingAccumulated += (ev.token || "");
            flushSnapshot();
            if (isCurrentProject) {
              this.state.set({ thinkingText: managerThinkingAccumulated });
            }
          } else if (evType === "raw_token" || evType === "manager_token") {
            managerAccumulated += ev.token;
            flushSnapshot();
            if (isCurrentProject) {
              this.state.set({ narrationText: stripProjectNameMarker(managerAccumulated) });
            }
          } else if (evType === "communicator_narration_starting") {
            commAccumulated = "";
          } else if (evType === "communicator_token") {
            commAccumulated += ev.token || "";
            if (isCurrentProject) {
              this.state.set({ narrationText: commAccumulated });
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
              this.state.set({ actionLog: [...this.state.get().actionLog, actionEntry] });
            }
          } else if (evType === "plan_preparing") {
            if (isCurrentProject) this.state.set({ preparingPlan: true });
          } else if (evType === "plan_ready") {
            if (isCurrentProject) {
              const plan = ev.plan;
              if (plan) {
                this.actions.setManagerPlan(plan);
                this.actions.addManagerMessage({
                  role: "assistant",
                  content: "",
                  plan,
                  thinking: managerThinkingAccumulated || undefined,
                });
                planEmitted = true;
              }
            }
          } else if (evType === "manager_done") {
            mgrDoneSeen = true;
            this.actions.setStreamingSnapshot(null);
            this.sessionId = null;
            this.state.set({ sessionId: null });
            this.reconnectRetry = 0;
            if (this.projectId) {
              try { localStorage.removeItem(`cascade-mgr-session-${this.projectId}`); } catch {}
            }

            if (isCurrentProject) {
              // Persist accumulated text as a permanent message BEFORE clearing
              // live state. Without this, clearLive() wipes the narration from
              // the UI and nothing takes its place — the message "flashes" away.
              if (!planEmitted) {
                // Write comm narration (Stage 1 friendly text) if present
                if (commAccumulated.trim()) {
                  this.actions.addManagerMessage({
                    role: "assistant",
                    content: commAccumulated.trim(),
                    source: "communicator",
                    thinking: managerThinkingAccumulated || undefined,
                  });
                  commAccumulated = ""; // consumed
                }
                // Write raw manager narration if no comm was written and there's content
                const stripped = stripProjectNameMarker(managerAccumulated).trim();
                if (stripped && !commAccumulated) {
                  this.actions.addManagerMessage({
                    role: "assistant",
                    content: stripped,
                    thinking: managerThinkingAccumulated || undefined,
                  });
                }
              }

              this.state.set({ preparingPlan: false });
              this.clearLive();
              // Always release the responding flag once the manager stream is
              // done — even when a plan was emitted. Previously this was skipped
              // for the plan-emitted case and deferred to the finally block,
              // which is itself guarded by !this.reconnectTimer; a pending
              // reconnect left isManagerResponding stuck true, which froze the
              // live "thinking" panel and caused the next user prompt to be
              // swallowed by the busy guard in chat-panel.
              this.actions.setManagerResponding(false);
            }

            if (!planEmitted && isCurrentProject) {
              // Try to parse plan from accumulated text
              let plan = ev.plan;
              if (!plan && managerAccumulated) {
                try {
                  const jsonMatch = managerAccumulated.match(/```json\s*([\s\S]*?)```/);
                  if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[1]);
                    const stepsArr = Array.isArray(parsed?.steps)
                      ? parsed.steps
                      : Array.isArray(parsed?.sub_tasks) ? parsed.sub_tasks : null;
                    if (parsed && stepsArr && stepsArr.length > 0) plan = parsed;
                  }
                } catch {}
              }
              if (plan) {
                this.actions.setManagerPlan(plan);
                this.actions.addManagerMessage({
                  role: "assistant",
                  content: "",
                  plan,
                  thinking: managerThinkingAccumulated || undefined,
                });
              }
            }
          } else if (evType === "manager_error") {
            this.actions.setStreamingSnapshot(null);
            this.sessionId = null;
            this.state.set({ sessionId: null });
            this.reconnectRetry = 0;
            if (this.projectId) {
              try { localStorage.removeItem(`cascade-mgr-session-${this.projectId}`); } catch {}
            }
            if (isCurrentProject) {
              this.actions.setManagerResponding(false);
              this.state.set({ preparingPlan: false });
              this.clearLive(0);
              if (!this.connectionErrorAdded) {
                this.connectionErrorAdded = true;
                const reason = (ev as { reason?: string }).reason;
                const i18nKey = reason === "empty_plan" ? "chat.errorPlanEmpty" : "chat.errorConnect";
                this.actions.addManagerMessage({
                  role: "assistant",
                  content: tr(useLanguageStore.getState().lang, i18nKey),
                  source: "communicator",
                });
              }
            }
          }
        },
      });

      // Post-stream: comm content was already persisted in manager_done handler.
      // Only write here if the stream ended without a manager_done event (abnormal).
      if (!mgrDoneSeen && !planEmitted && this.actions.getProjectId() === this.projectId && commAccumulated) {
        const friendlyComm = commAccumulated.trim();
        if (friendlyComm) {
          this.actions.addManagerMessage({
            role: "assistant",
            content: friendlyComm,
            source: "communicator",
            thinking: managerThinkingAccumulated || undefined,
          });
        }
      }

      // Extract project name from marker — only if user hasn't set a custom name
      if (this.actions.getProjectId() === this.projectId && managerAccumulated) {
        const nameFromMarker = managerAccumulated.match(PROJECT_NAME_REGEX)?.[1]?.trim();
        if (nameFromMarker && this.projectId) {
          const currentProject = useProjectStore.getState().projects.find((p) => p.id === this.projectId);
          if (!currentProject?.userNamed) {
            this.actions.renameProject(this.projectId, nameFromMarker);
          }
        }
      }

      if (!mgrDoneSeen && myGen === this.generation && this.sessionId) {
        throw new Error("mgr_stream_closed_before_done");
      }
      return true;
    } catch (error: unknown) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const stillCurrent = myGen === this.generation;

      if (!isAbort && stillCurrent && this.sessionId) {
        this.scheduleReconnect();
      }

      if (!isAbort && !this.connectionErrorAdded && stillCurrent) {
        this.handleStreamError("connect");
      }
      return false;
    } finally {
      // The in-flight window is over for this send. Clear the synchronous guard
      // unless a newer send has already superseded this generation.
      if (myGen === this.generation) this.sendInFlight = false;
      if (myGen === this.generation && !this.reconnectTimer) {
        this.actions.setStreamingSnapshot(null);
        this.sessionId = null;
        this.state.set({ sessionId: null });
        if (this.projectId) {
          try { localStorage.removeItem(`cascade-mgr-session-${this.projectId}`); } catch {}
        }
        this.clearLive();
        this.actions.setManagerResponding(false);
      }
    }
  }

  /**
   * Reconnect to an existing manager session (e.g. after page refresh).
   */
  async connect(sessionId: string, lastEventId: number): Promise<void> {
    if (this.disposed) return;
    this.sessionId = sessionId;
    this.state.set({ sessionId });
    const myGen = ++this.generation;

    if (this.reconnectAbortController) {
      try { this.reconnectAbortController.abort(); } catch {}
    }
    const controller = new AbortController();
    this.reconnectAbortController = controller;

    try {
      const response = await fetch(
        `/api/manager-chat/${sessionId}/stream?lastEventId=${lastEventId}`,
        { cache: "no-store", headers: { "Cache-Control": "no-cache" }, signal: controller.signal },
      );
      if (!response.ok || !response.body) {
        this.actions.setStreamingSnapshot(null);
        this.sessionId = null;
        this.state.set({ sessionId: null });
        if (this.projectId) {
          try { localStorage.removeItem(`cascade-mgr-session-${this.projectId}`); } catch {}
        }
        this.actions.setManagerResponding(false);
        return;
      }

      this.reconnectRetry = 0;
      const reader = response.body.getReader();
      this.reader = reader;
      this.lastActivityTs = Date.now();

      const existingSnapshot = this.actions.getStreamingSnapshot();
      let managerAccumulated = (existingSnapshot?.type === "manager" ? existingSnapshot.narrationText : "") || "";
      let managerThinkingAccumulated = (existingSnapshot?.type === "manager" ? existingSnapshot.thinkingText : "") || "";

      let lastReconnectSnapshotFlush = 0;
      const flushReconnectSnapshot = () => {
        const now = Date.now();
        if (now - lastReconnectSnapshotFlush < 500) return;
        lastReconnectSnapshotFlush = now;
        this.actions.setStreamingSnapshot({
          type: "manager",
          thinkingText: managerThinkingAccumulated,
          narrationText: managerAccumulated,
          projectId: this.projectId,
          updatedAt: now,
          sessionId,
          lastEventId: this.lastEventId,
        });
      };

      await parseSseStream<ManagerSseEvent>(reader, {
        signal: controller.signal,
        validate: validateManagerEvent,
        onHeartbeat: () => { this.lastActivityTs = Date.now(); },
        onEvent: async (ev) => {
          this.lastActivityTs = Date.now();
          if (typeof ev.eventId === "number") this.lastEventId = ev.eventId;
          const evType = ev.type;
          const isCurrentProject = this.actions.getProjectId() === this.projectId;

          if (evType === "thinking_token") {
            managerThinkingAccumulated += (ev.token || "");
            flushReconnectSnapshot();
            if (isCurrentProject) this.state.set({ thinkingText: managerThinkingAccumulated });
          } else if (evType === "raw_token" || evType === "manager_token") {
            managerAccumulated += ev.token;
            flushReconnectSnapshot();
            if (isCurrentProject) this.state.set({ narrationText: stripProjectNameMarker(managerAccumulated) });
          } else if (evType === "communicator_token") {
            managerAccumulated += ev.token || "";
            if (isCurrentProject) this.state.set({ narrationText: managerAccumulated });
          } else if (evType === "plan_ready") {
            if (isCurrentProject) {
              const plan = ev.plan;
              if (plan) {
                this.actions.setManagerPlan(plan);
                // Skip re-adding the plan message when this is a replayed event
                // (server resends history on reconnect). It was already
                // persisted on the original stream; re-adding mints a new UUID
                // and duplicates the plan card.
                if (!ev.replay) {
                  this.actions.addManagerMessage({
                    role: "assistant",
                    content: "",
                    plan,
                    thinking: managerThinkingAccumulated || undefined,
                  });
                }
              }
            }
          } else if (evType === "manager_done") {
            if (isCurrentProject && !ev.replay && managerAccumulated.trim()) {
              const stripped = stripProjectNameMarker(managerAccumulated).trim();
              if (stripped) {
                this.actions.addManagerMessage({
                  role: "assistant",
                  content: stripped,
                  thinking: managerThinkingAccumulated || undefined,
                });
              }
            }
            // Reconnect path: clear live state + responding flag here rather than
            // relying solely on the finally block (which is gated by
            // !this.reconnectTimer). Mirrors the primary send() path so a stuck
            // "thinking" panel / swallowed-prompt state can't survive a reconnect.
            if (isCurrentProject) {
              this.state.set({ preparingPlan: false });
              this.clearLive();
              this.actions.setManagerResponding(false);
            }
            return;
          } else if (evType === "manager_error") {
            this.actions.setStreamingSnapshot(null);
            this.sessionId = null;
            this.state.set({ sessionId: null });
            if (this.projectId) {
              try { localStorage.removeItem(`cascade-mgr-session-${this.projectId}`); } catch {}
            }
            if (isCurrentProject) {
              this.actions.setManagerResponding(false);
              this.state.set({ preparingPlan: false });
              this.clearLive(0);
            }
            return;
          }
        },
      });
    } catch (error: unknown) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      if (!isAbort && myGen === this.generation && this.sessionId) {
        this.scheduleReconnect();
      }
    } finally {
      if (myGen === this.generation && !this.reconnectTimer) {
        this.actions.setStreamingSnapshot(null);
        this.sessionId = null;
        this.state.set({ sessionId: null });
        if (this.projectId) {
          try { localStorage.removeItem(`cascade-mgr-session-${this.projectId}`); } catch {}
        }
        this.clearLive();
        this.actions.setManagerResponding(false);
      }
    }
  }

  /**
   * Abort the current stream.
   */
  abort(): void {
    this.sendInFlight = false;
    if (this.abortController) {
      try { this.abortController.abort(); } catch {}
      this.abortController = null;
    }
    if (this.reconnectAbortController) {
      try { this.reconnectAbortController.abort(); } catch {}
      this.reconnectAbortController = null;
    }
    if (this.reader) {
      this.reader.cancel().catch(() => {});
      this.reader = null;
    }
  }

  /**
   * Reset all live state.
   */
  resetLive(): void {
    this.clearTimers();
    this.abort();
    this.sessionId = null;
    this.lastEventId = -1;
    this.reconnectRetry = 0;
    this.autoExecutePlan = false;
    this.state.reset({ ...INITIAL_MANAGER_STREAM_STATE });
  }

  /**
   * Attempt to reconnect to an active session for this project.
   * Called on project load / visibility change.
   */
  async attemptReconnect(): Promise<void> {
    if (this.disposed) return;

    const savedSessionId = (() => {
      try { return localStorage.getItem(`cascade-mgr-session-${this.projectId}`); }
      catch { return null; }
    })();

    const snapshot = this.actions.getStreamingSnapshot();
    const sessionIdToReconnect =
      (snapshot?.type === "manager" && snapshot.projectId === this.projectId
        ? snapshot.sessionId
        : null) || savedSessionId;

    if (!sessionIdToReconnect) {
      // Try the /active endpoint
      try {
        const resp = await fetch(`/api/manager-chat/active/${this.projectId}`, {
          cache: "no-store", headers: { "Cache-Control": "no-cache" },
        });
        if (resp.ok) {
          const data = await resp.json();
          // Only reconnect to a still-active session. A done session would
          // replay plan_ready/manager_done, and the reconnect handlers would
          // re-add those assistant messages under fresh UUIDs — duplicating
          // history on every refresh. Finished sessions are already persisted
          // and loaded by fetchMessagesFromServer.
          if (data?.sessionId && data?.active === true) {
            this.state.set({ isReconnecting: true });
            await this.connect(data.sessionId, -1);
            this.state.set({ isReconnecting: false });
          }
        }
      } catch {}
      return;
    }

    // Check session status
    this.state.set({ isReconnecting: true });
    try {
      const resp = await fetch(`/api/manager-chat/${sessionIdToReconnect}/status`, {
        cache: "no-store", headers: { "Cache-Control": "no-cache" },
      });
      const data = resp.ok ? await resp.json() : null;
      if (data?.active) {
        const resumeEventId = (snapshot?.type === "manager" && snapshot.sessionId === sessionIdToReconnect
          && typeof snapshot.lastEventId === "number")
          ? snapshot.lastEventId
          : this.lastEventId;
        this.actions.setManagerResponding(true);
        await this.connect(sessionIdToReconnect, resumeEventId);
      } else {
        // Session is done or not found — no need to reconnect.
        // Messages are already persisted in DB and loaded by fetchMessagesFromServer.
        try { localStorage.removeItem(`cascade-mgr-session-${this.projectId}`); } catch {}
      }
    } catch {
      try { localStorage.removeItem(`cascade-mgr-session-${this.projectId}`); } catch {}
    } finally {
      this.state.set({ isReconnecting: false });
    }
  }

  /**
   * Clean up all resources. Called when removing from registry.
   */
  dispose(): void {
    this.disposed = true;
    this.abort();
    this.clearTimers();
    this.state.reset({ ...INITIAL_MANAGER_STREAM_STATE });
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private handleStreamError(errorCode: "connect" | "build_interrupted" | "build_generic"): void {
    if (this.connectionErrorAdded) return;
    this.connectionErrorAdded = true;
    this.actions.setManagerResponding(false);
    this.state.set({ preparingPlan: false });
    this.clearLive(0);
    this.actions.addManagerMessage({
      role: "assistant",
      content: tr(useLanguageStore.getState().lang, "chat.errorConnect"),
      source: "communicator",
      errorCode,
    });
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

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      this.inactivityTimer = null;
      this.actions.setManagerResponding(false);
      this.state.set({ preparingPlan: false });
      this.clearLive(0);
    }, 60_000);
  }

  private clearLive(delay?: number): void {
    if (typeof delay === "number" && delay > 0) {
      this.liveClearTimer = setTimeout(() => {
        this.state.set({ thinkingText: "", narrationText: "", actionLog: [] });
        this.liveClearTimer = null;
      }, delay);
    } else {
      this.state.set({ thinkingText: "", narrationText: "", actionLog: [] });
    }
  }

  private clearLiveTimer(): void {
    if (this.liveClearTimer) {
      clearTimeout(this.liveClearTimer);
      this.liveClearTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearLiveTimer();
    if (this.inactivityTimer) { clearTimeout(this.inactivityTimer); this.inactivityTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }
}
