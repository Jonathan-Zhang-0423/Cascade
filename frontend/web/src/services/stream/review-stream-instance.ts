import { ObservableState } from "./observable-state";
import {
  type ReviewStreamState,
  type StoreActions,
  INITIAL_REVIEW_STREAM_STATE,
} from "./types";
import type { ReviewSseEvent } from "@/components/ide/chat/chat-types";
import { KNOWN_REVIEW_EVENT_TYPES, REVIEW_SOURCE_MAP, validateReviewEvent } from "@/components/ide/chat/chat-types";
import { detectLanguage, normalizeSteps } from "@/components/ide/chat/chat-utils";
import { parseSseStream, createHeartbeatWatchdog } from "@/components/ide/chat/hooks/useSSEStream";
import { useLLMMonitorStore, type LLMEventType } from "@/stores/llm-monitor-store";
import { useLanguageStore } from "@/stores/language-store";
import { useProjectStore } from "@/stores/project-store";
import { tr } from "@/lib/i18n";

/**
 * ReviewStreamInstance — owns the SSE connection for a single project's
 * standalone review step. Mirrors BuildStreamInstance but is read-mostly: the
 * reviewer narrates, an internal fixer may apply code (code_applied), and a
 * single consolidated report arrives at the end (review_report). No mid-loop
 * needs_input — the user is only involved after the loop settles.
 */
export class ReviewStreamInstance {
  readonly projectId: string;
  readonly state: ObservableState<ReviewStreamState>;

  private actions: StoreActions;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private sessionId: string | null = null;
  private lastEventId = -1;
  private generation = 0;
  private reconnectRetry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(projectId: string, actions: StoreActions) {
    this.projectId = projectId;
    this.actions = actions;
    this.state = new ObservableState<ReviewStreamState>({ ...INITIAL_REVIEW_STREAM_STATE });
  }

  get isActive(): boolean {
    return this.sessionId !== null;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Run a standalone review pass over the current project files.
   */
  async execute(): Promise<void> {
    if (this.disposed) return;

    // Self-heal: if a session is already running, don't start another.
    if (this.sessionId) {
      try {
        const r = await fetch(`/api/review-session/${this.sessionId}/status`, {
          cache: "no-store", headers: { "Cache-Control": "no-cache" },
        });
        if (r.ok) {
          const data = await r.json();
          if (data?.active && !data?.done) return;
        }
      } catch {}
      this.sessionId = null;
      this.reader = null;
    }

    const plan = this.actions.getManagerPlan();
    const planSteps = plan ? normalizeSteps(plan) : [];
    const messages = this.actions.getManagerMessages();
    const firstUserMsg = messages.find((m) => m.role === "user");
    const userRequest = plan?.summary || firstUserMsg?.content || "";
    const userLang = firstUserMsg ? detectLanguage(firstUserMsg.content) : "English";
    const files = this.actions.getFiles().map((f) => ({ path: f.path, content: f.content || "" }));
    const strictness = this.actions.getReviewStrictness();

    const sessionId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    this.sessionId = sessionId;
    this.lastEventId = -1;
    this.reconnectRetry = 0;
    const myGen = ++this.generation;

    this.state.set({ ...INITIAL_REVIEW_STREAM_STATE, sessionId, phase: "reviewing" });
    this.actions.setReviewPhase("reviewing");
    this.actions.setHolisticReview(null);

    try { localStorage.setItem(`cascade-review-session-${this.projectId}`, sessionId); } catch {}

    try {
      const framework = useProjectStore.getState().projects.find((p) => p.id === this.projectId)?.framework;
      const response = await fetch("/api/review-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          files,
          userRequest,
          planSteps: planSteps.length > 0 ? planSteps : undefined,
          userLang,
          strictness,
          projectId: this.projectId || undefined,
          framework: framework || undefined,
        }),
      });

      if (!response.ok || !response.body) {
        this.actions.setReviewPhase("idle");
        this.state.set({ phase: "idle", sessionId: null });
        this.sessionId = null;
        return;
      }

      const reader = response.body.getReader();
      this.reader = reader;
      await this.consume(reader, myGen, planSteps);
    } catch (error: unknown) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      if (!isAbort && myGen === this.generation && this.sessionId && this.reconnectRetry < 3) {
        this.scheduleReconnect(planSteps);
        return;
      }
    } finally {
      this.finalize(myGen);
    }
  }

  /**
   * Reconnect to an in-flight review session (e.g. after a page reload).
   */
  async connect(sessionId: string, lastEventId: number): Promise<void> {
    if (this.disposed) return;
    this.sessionId = sessionId;
    this.state.set({ sessionId, isReconnecting: true });
    const myGen = ++this.generation;
    const plan = this.actions.getManagerPlan();
    const planSteps = plan ? normalizeSteps(plan) : [];

    try {
      const response = await fetch(
        `/api/review-session/${sessionId}/stream?lastEventId=${lastEventId}`,
        { cache: "no-store", headers: { "Cache-Control": "no-cache" } },
      );
      if (!response.ok || !response.body) {
        this.sessionId = null;
        this.state.set({ sessionId: null, isReconnecting: false });
        try { localStorage.removeItem(`cascade-review-session-${this.projectId}`); } catch {}
        return;
      }
      const reader = response.body.getReader();
      this.reader = reader;
      this.state.set({ isReconnecting: false });
      this.reconnectRetry = 0;
      await this.consume(reader, myGen, planSteps);
    } catch (error: unknown) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      if (!isAbort && myGen === this.generation && this.sessionId) {
        this.scheduleReconnect(planSteps);
        return;
      }
    } finally {
      this.finalize(myGen);
    }
  }

  /**
   * Attempt to reconnect to an active review session for this project.
   */
  async attemptReconnect(): Promise<void> {
    if (this.disposed || this.sessionId) return;
    const saved = (() => {
      try { return localStorage.getItem(`cascade-review-session-${this.projectId}`); }
      catch { return null; }
    })();
    if (!saved) return;
    try {
      const resp = await fetch(`/api/review-session/${saved}/status`, {
        cache: "no-store", headers: { "Cache-Control": "no-cache" },
      });
      const data = resp.ok ? await resp.json() : null;
      if (data?.active) {
        this.actions.setReviewPhase("reviewing");
        await this.connect(saved, -1);
      } else {
        try { localStorage.removeItem(`cascade-review-session-${this.projectId}`); } catch {}
      }
    } catch {
      try { localStorage.removeItem(`cascade-review-session-${this.projectId}`); } catch {}
    }
  }

  stop(): void {
    if (this.sessionId) {
      fetch(`/api/review-session/${this.sessionId}`, { method: "DELETE" }).catch(() => {});
    }
    this.abort();
    this.state.set({ phase: "idle" });
    this.actions.setReviewPhase("idle");
  }

  dispose(): void {
    this.disposed = true;
    this.abort();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.state.reset({ ...INITIAL_REVIEW_STREAM_STATE });
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private async consume(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    myGen: number,
    planSteps: ReturnType<typeof normalizeSteps>,
  ): Promise<void> {
    const watchdog = createHeartbeatWatchdog(15000, () => {
      try { reader.cancel(); } catch {}
    });

    let thinkingAccumulated = "";
    let commAccumulated = "";

    await parseSseStream<ReviewSseEvent>(reader, {
      onHeartbeat: () => watchdog.reset(),
      validate: validateReviewEvent,
      onEvent: async (ev) => {
        watchdog.reset();
        if (typeof ev.eventId === "number") this.lastEventId = ev.eventId;
        const type = ev.type;
        const isCurrentProject = this.actions.getProjectId() === this.projectId;

        if (KNOWN_REVIEW_EVENT_TYPES.has(type)) {
          const content = ev.token || ev.label || ev.message || ev.filePath || type;
          useLLMMonitorStore.getState().addEvent(
            REVIEW_SOURCE_MAP[type] || "verifier",
            type as LLMEventType,
            typeof content === "string" ? content : String(content),
          );
        }

        if (type === "thinking_token") {
          thinkingAccumulated += ev.token || "";
          this.state.set({ thinkingText: thinkingAccumulated });
        } else if (type === "narration_token" || type === "communicator_token") {
          commAccumulated += ev.token || "";
          this.state.set({ narrationText: commAccumulated });
        } else if (type === "review_started") {
          this.state.set({ phase: "reviewing", thinkingText: "", narrationText: "" });
          thinkingAccumulated = "";
          commAccumulated = "";
          if (isCurrentProject) this.actions.setReviewPhase("reviewing");
        } else if (type === "review_round") {
          thinkingAccumulated = "";
          commAccumulated = "";
          this.state.set({
            phase: "reviewing",
            round: ev.round ?? 1,
            maxRounds: ev.maxRounds ?? 0,
            thinkingText: "",
            narrationText: "",
          });
          if (isCurrentProject) {
            this.actions.setReviewPhase("reviewing");
            this.actions.setFixCycle(ev.round ?? 1);
          }
        } else if (type === "review_fixing") {
          this.state.set({ phase: "fixing", narrationText: "" });
          commAccumulated = "";
          if (isCurrentProject) this.actions.setReviewPhase("fixing");
        } else if (type === "code_applied") {
          if (isCurrentProject) {
            const filePath = ev.filePath || "";
            const newCode = ev.code || "";
            const files = this.actions.getFiles();
            const oldContent = files.find((f) => f.path === filePath)?.content ?? "";
            this.actions.setLastBuildFileDiff(filePath, oldContent, newCode);
            await this.actions.applyCodeBlock({ filePath, code: newCode, language: ev.language || "" });
            this.actions.refreshPreview();
          }
        } else if (type === "review_report") {
          // Final consolidated report — store the holistic shape for the UI.
          if (isCurrentProject && ev.review) {
            this.actions.setHolisticReview(ev.review as unknown);
          }
        } else if (type === "review_passed") {
          // Mirror event carrying the holistic review payload + phase.
          if (isCurrentProject) {
            if (ev.review) this.actions.setHolisticReview(ev.review as unknown);
            const passed = (ev.review as { overall_status?: string } | undefined)?.overall_status === "pass";
            this.actions.setReviewPhase(passed ? "review_passed" : "review_failed");
          }
        } else if (type === "review_done") {
          this.state.set({ phase: "idle", thinkingText: "", narrationText: "" });
          try { localStorage.removeItem(`cascade-review-session-${this.projectId}`); } catch {}
          if (isCurrentProject) {
            this.actions.refreshPreview();
          }
        } else if (type === "review_error") {
          this.state.set({ phase: "idle" });
          if (isCurrentProject) {
            this.actions.setReviewPhase("idle");
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
  }

  private finalize(myGen: number): void {
    if (myGen !== this.generation) return;
    if (this.reconnectTimer) return;
    this.sessionId = null;
    this.reader = null;
    this.state.set({ sessionId: null, isReconnecting: false, phase: "idle" });
    try { localStorage.removeItem(`cascade-review-session-${this.projectId}`); } catch {}
  }

  private abort(): void {
    if (this.reader) {
      this.reader.cancel().catch(() => {});
      this.reader = null;
    }
    this.sessionId = null;
    this.state.set({ sessionId: null });
    try { localStorage.removeItem(`cascade-review-session-${this.projectId}`); } catch {}
  }

  private scheduleReconnect(planSteps: ReturnType<typeof normalizeSteps>): void {
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
}
