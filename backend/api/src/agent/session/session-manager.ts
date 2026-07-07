import { createSessionEmit, attachSseWriter, type SseEmit, type BufferedEvent, type SseCapableSession } from "../../infra/sse";
import { userSessions } from "../../infra/concurrency";
import { normalizeChatSessionId, SessionStore, type SessionType, type SessionStatus, type PersistedSession } from "./session-store";

/**
 * Disposable resource registered on a session. Guaranteed cleanup on session end.
 */
export interface Disposable {
  name: string;
  dispose(): Promise<void>;
}

/**
 * AgentSession — the live in-memory representation of an active session.
 * Combines SSE streaming state with lifecycle metadata and registered resources.
 */
export interface AgentSession extends SseCapableSession {
  readonly id: string;
  readonly type: SessionType;
  readonly projectId: string | null;
  readonly userId: string | null;
  readonly chatSessionId: string;
  readonly runType: string;
  readonly runGroupId: string | null;
  readonly createdAt: number;
  status: SessionStatus;
  doneAt?: number;
  /** SSE event buffer (source of truth for replay). */
  events: BufferedEvent[];
  nextEventId: number;
  /** Active SSE writers for live streaming. */
  sseWriters: Set<(line: string) => void>;
  /** Whether the session's main work is finished. */
  done: boolean;
  /** Type-specific payload (plan, userRequest, files, framework, etc.). */
  payload: Record<string, unknown>;
  currentSnapshot: Record<string, unknown>;
  ledgerSnapshot: Record<string, unknown>;
  finalArtifact: Record<string, unknown> | null;
  /** Registered disposable resources (LSP, shell, MCP, tmpdir). */
  resources: Disposable[];
  /** Tracks whether events have been flushed since last modification. */
  _dirty: boolean;
  /** Backoff state for transient DB flush failures. */
  _flushRetryCount?: number;
  _nextFlushAt?: number;
}

export interface CreateSessionOpts {
  id: string;
  type: SessionType;
  projectId?: string | null;
  userId?: string | null;
  chatSessionId?: string | null;
  runType?: string | null;
  runGroupId?: string | null;
  payload?: Record<string, unknown>;
}

export interface AgentSessionIdentity {
  userId: string | null;
  projectId: string | null;
  chatSessionId: string;
  agentSessionId: string;
  runType: string;
  runGroupId?: string | null;
  runAttempt?: number;
  planId?: string | null;
  stepId?: string | number | null;
  toolCallId?: string | null;
  parentSessionId?: string | null;
}

/**
 * Valid state transitions in the session lifecycle.
 */
const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  pending: ["running", "error", "aborted"],
  running: ["done", "error", "aborted", "interrupted"],
  done: [],        // terminal
  error: [],       // terminal
  interrupted: [], // terminal
  aborted: [],     // terminal
};

const SNAPSHOT_TEXT_LIMIT = 8_000;
const SNAPSHOT_ACTION_LOG_LIMIT = 300;

/**
 * SessionManager — unified lifecycle management for all agent session types.
 *
 * Responsibilities:
 * - Create/get/delete sessions (live cache + DB persistence)
 * - State machine enforcement (valid transitions only)
 * - SSE emit + writer attachment with replay
 * - Periodic event flush to DB (5s interval)
 * - GC of expired sessions (60s interval)
 * - Guaranteed resource cleanup (Disposable pattern)
 * - Server startup recovery (mark interrupted)
 * - User session slot management (register/unregister)
 */
export class SessionManager {
  private live = new Map<string, AgentSession>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  private readonly FLUSH_INTERVAL_MS = 5000;
  private readonly GC_INTERVAL_MS = 60_000;
  private readonly MAX_AGE_MS = 60 * 60 * 1000; // 60 min (complex builds can take 30-45 min)
  private readonly DONE_RETENTION_MS = 30 * 60 * 1000; // 30 min post-done

  constructor(private readonly store: SessionStore) {}

  /**
   * Start background timers (flush + GC). Call once on server startup.
   */
  start(): void {
    this.flushTimer = setInterval(() => this.flushAll(), this.FLUSH_INTERVAL_MS);
    this.gcTimer = setInterval(() => this.gc(), this.GC_INTERVAL_MS);
  }

  /**
   * Stop background timers (for graceful shutdown / tests).
   */
  stop(): void {
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    if (this.gcTimer) { clearInterval(this.gcTimer); this.gcTimer = null; }
  }

  /**
   * Server startup recovery: mark any in-progress sessions as interrupted.
   * Call this ONCE during server boot, before accepting requests.
   */
  async onStartup(): Promise<number> {
    const count = await this.store.markInterruptedOnStartup();
    if (count > 0) {
      console.log(`[SessionManager] marked ${count} session(s) as interrupted after restart`);
    }
    return count;
  }

  /**
   * Create a new session, persist to DB, register in live cache.
   * Also registers the user's session slot (if userId provided).
   */
  async create(opts: CreateSessionOpts): Promise<AgentSession> {
    const session: AgentSession = {
      id: opts.id,
      type: opts.type,
      projectId: opts.projectId ?? null,
      userId: opts.userId ?? null,
      chatSessionId: normalizeChatSessionId(opts.chatSessionId),
      runType: opts.runType ?? opts.type,
      runGroupId: opts.runGroupId ?? null,
      createdAt: Date.now(),
      status: "pending",
      events: [],
      nextEventId: 0,
      sseWriters: new Set(),
      done: false,
      payload: opts.payload ?? {},
      currentSnapshot: {},
      ledgerSnapshot: {},
      finalArtifact: null,
      resources: [],
      _dirty: false,
    };

    // Persist to DB
    await this.store.create({
      id: session.id,
      type: session.type,
      projectId: session.projectId,
      userId: session.userId,
      chatSessionId: session.chatSessionId,
      runType: session.runType,
      runGroupId: session.runGroupId,
      status: session.status,
      createdAt: session.createdAt,
      payload: session.payload,
    });

    // Register in live cache
    this.live.set(session.id, session);

    // Register user session slot
    if (session.userId) {
      userSessions.register(session.userId, session.id);
    }

    return session;
  }

  /**
   * Get a live session from cache, or load from DB if not in memory (reconnect scenario).
   */
  async get(id: string): Promise<AgentSession | null> {
    // Check live cache first (hot path)
    const cached = this.live.get(id);
    if (cached) return cached;

    // Load from DB (cold path — session was persisted before restart)
    const persisted = await this.store.load(id);
    if (!persisted) return null;

    // Rehydrate into live cache (read-only — no orchestrator resumes)
    const session: AgentSession = {
      ...persisted,
      runType: persisted.runType ?? persisted.type,
      sseWriters: new Set(),
      done: ["done", "error", "interrupted", "aborted"].includes(persisted.status),
      resources: [],
      _dirty: false,
      doneAt: persisted.doneAt ?? undefined,
    };
    this.live.set(id, session);
    return session;
  }

  /**
   * Get the SSE emit function for a session.
   */
  getEmit(id: string): SseEmit {
    const session = this.live.get(id);
    if (!session) throw new Error(`[SessionManager] getEmit: session ${id} not in live cache`);
    const emit = createSessionEmit(session);
    // Wrap to mark dirty on every emit
    return (data: Record<string, unknown>) => {
      const enriched = this.withIdentity(session, data);
      emit(enriched);
      session._dirty = true;
      this.updateSnapshotsFromEvent(session, enriched);
    };
  }

  createEmit(session: AgentSession): SseEmit {
    const emit = createSessionEmit(session);
    return (data: Record<string, unknown>) => {
      const enriched = this.withIdentity(session, data);
      emit(enriched);
      session._dirty = true;
      this.updateSnapshotsFromEvent(session, enriched);
    };
  }

  /**
   * Attach an SSE writer (HTTP response) with replay support.
   */
  attachWriter(id: string, res: any, lastEventId: number): void {
    const session = this.live.get(id);
    if (!session) throw new Error(`[SessionManager] attachWriter: session ${id} not in live cache`);
    attachSseWriter(session, res, lastEventId);
  }

  /**
   * Transition session status (state machine with validation).
   * Persists the new status immediately.
   */
  async transition(id: string, to: SessionStatus): Promise<void> {
    const session = this.live.get(id);
    if (!session) throw new Error(`[SessionManager] transition: session ${id} not found`);

    const allowed = VALID_TRANSITIONS[session.status];
    if (!allowed.includes(to)) {
      throw new Error(`[SessionManager] invalid transition: ${session.status} → ${to} for session ${id}`);
    }

    session.status = to;
    if (["done", "error", "interrupted", "aborted"].includes(to)) {
      session.done = true;
      session.doneAt = Date.now();
    }

    // Persist status change immediately
    await this.store.updateStatus(id, to, session.doneAt);
  }

  /**
   * Register a disposable resource on a session. Guaranteed cleanup on session end.
   */
  registerResource(id: string, name: string, dispose: () => Promise<void>): void {
    const session = this.live.get(id);
    if (!session) return;
    session.resources.push({ name, dispose });
  }

  /**
   * Immediately flush events for a session to DB (call on milestones).
   */
  async flushEvents(id: string): Promise<void> {
    const session = this.live.get(id);
    if (!session || !session._dirty) return;
    try {
      await this.store.flushEvents(id, session.events, session.nextEventId);
      await this.store.saveSnapshot(id, session.currentSnapshot, {
        ledger: session.ledgerSnapshot,
        finalArtifact: session.finalArtifact,
      }).catch(() => {});
      session._dirty = false;
      session._flushRetryCount = 0;
      session._nextFlushAt = undefined;
    } catch (err) {
      this.scheduleFlushRetry(session, err);
      throw err;
    }
  }

  async saveSnapshot(
    id: string,
    snapshot: Record<string, unknown>,
    opts: { ledger?: Record<string, unknown>; finalArtifact?: Record<string, unknown> | null } = {},
  ): Promise<void> {
    const session = this.live.get(id);
    if (session) {
      session.currentSnapshot = snapshot ?? {};
      if (opts.ledger !== undefined) session.ledgerSnapshot = opts.ledger ?? {};
      if (opts.finalArtifact !== undefined) session.finalArtifact = opts.finalArtifact;
    }
    await this.store.saveSnapshot(id, snapshot, opts);
  }

  async findActiveForProject(
    projectId: string,
    opts: { chatSessionId?: string | null; type?: SessionType } = {},
  ): Promise<AgentSession | null> {
    const chatSessionId = opts.chatSessionId === undefined ? undefined : normalizeChatSessionId(opts.chatSessionId);
    const live = Array.from(this.live.values())
      .filter((s) => {
        if (s.projectId !== projectId || s.done) return false;
        if (opts.type && s.type !== opts.type) return false;
        if (chatSessionId !== undefined && s.chatSessionId !== chatSessionId) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (live) return live;

    const dbSession = await this.store.getLatestForProject(projectId, {
      chatSessionId,
      type: opts.type,
      includeDone: false,
    });
    if (!dbSession) return null;
    const existing = await this.get(dbSession.id);
    return existing && !existing.done ? existing : null;
  }

  getIdentity(id: string): AgentSessionIdentity | null {
    const session = this.live.get(id);
    return session ? this.identityFor(session) : null;
  }

  /**
   * Guaranteed cleanup: dispose all resources + release user slot + persist final state.
   * Safe to call multiple times (idempotent — guarded by _cleaningUp flag).
   */
  async cleanup(id: string): Promise<void> {
    const session = this.live.get(id);
    if (!session) return;
    // Prevent concurrent cleanup (GC + normal completion racing)
    if ((session as any)._cleaningUp) return;
    (session as any)._cleaningUp = true;

    // Dispose all registered resources
    for (const r of session.resources) {
      try { await r.dispose(); } catch (err) {
        console.warn(`[SessionManager] resource '${r.name}' dispose failed for session ${id}:`, err instanceof Error ? err.message : err);
      }
    }
    session.resources = [];

    // Release user session slot
    if (session.userId) {
      userSessions.unregister(session.userId, session.id);
    }

    // Persist final state
    await this.store.updateStatus(id, session.status, session.doneAt).catch(() => {});
    await this.store.flushEvents(id, session.events, session.nextEventId).catch(() => {});
    await this.store.saveSnapshot(id, session.currentSnapshot, {
      ledger: session.ledgerSnapshot,
      finalArtifact: session.finalArtifact,
    }).catch(() => {});

    // Remove from live cache (after a retention period for late reconnectors)
    setTimeout(() => {
      this.live.delete(id);
    }, this.DONE_RETENTION_MS);
  }

  /**
   * Delete a session entirely (user-initiated or admin).
   */
  async delete(id: string): Promise<void> {
    await this.cleanup(id);
    this.live.delete(id);
    await this.store.delete(id).catch(() => {});
  }

  /**
   * Check if a session exists and is active (not terminal).
   */
  isActive(id: string): boolean {
    const session = this.live.get(id);
    return !!session && !session.done;
  }

  /**
   * Get session count for metrics/debugging.
   */
  getMetrics(): { live: number; active: number } {
    let active = 0;
    for (const s of this.live.values()) {
      if (!s.done) active++;
    }
    return { live: this.live.size, active };
  }

  // ─── Background tasks ──────────────────────────────────────────────────────

  /**
   * Periodic flush: persist events for all dirty active sessions.
   */
  private async flushAll(): Promise<void> {
    const now = Date.now();
    for (const [id, session] of this.live) {
      if (session._nextFlushAt && session._nextFlushAt > now) continue;
      if (session._dirty && !session.done) {
        try {
          await this.store.flushEvents(id, session.events, session.nextEventId);
          await this.store.saveSnapshot(id, session.currentSnapshot, {
            ledger: session.ledgerSnapshot,
            finalArtifact: session.finalArtifact,
          }).catch(() => {});
          session._dirty = false;
          session._flushRetryCount = 0;
          session._nextFlushAt = undefined;
        } catch (err) {
          console.warn(`[SessionManager] flush failed for ${id}:`, err instanceof Error ? err.message : err);
          this.scheduleFlushRetry(session, err);
        }
      }
    }
  }

  private identityFor(session: AgentSession): AgentSessionIdentity {
    return {
      userId: session.userId,
      projectId: session.projectId,
      chatSessionId: session.chatSessionId,
      agentSessionId: session.id,
      runType: session.runType,
      runGroupId: session.runGroupId,
    };
  }

  private withIdentity(session: AgentSession, data: Record<string, unknown>): Record<string, unknown> {
    return {
      ...data,
      sessionId: typeof data.sessionId === "string" ? data.sessionId : session.id,
      projectId: typeof data.projectId === "string" ? data.projectId : session.projectId ?? undefined,
      chatSessionId: typeof data.chatSessionId === "string" ? data.chatSessionId : session.chatSessionId,
      runType: typeof data.runType === "string" ? data.runType : session.runType,
      runGroupId: typeof data.runGroupId === "string" ? data.runGroupId : session.runGroupId ?? undefined,
    };
  }

  private updateSnapshotsFromEvent(session: AgentSession, data: Record<string, unknown>): void {
    const type = typeof data.type === "string" ? data.type : "";
    const snapshot = session.currentSnapshot ?? {};
    const appendText = (key: "thinkingText" | "narrationText", token: unknown): void => {
      if (typeof token !== "string" || !token) return;
      const prev = typeof snapshot[key] === "string" ? snapshot[key] as string : "";
      snapshot[key] = (prev + token).slice(-SNAPSHOT_TEXT_LIMIT);
    };

    if (type === "thinking_token") {
      appendText("thinkingText", data.token);
    }
    if (type === "narration_token" || type === "communicator_token" || type === "manager_token" || type === "raw_token") {
      appendText("narrationText", data.token);
    }
    if (type === "step_starting") {
      const stepNumber = typeof data.stepNumber === "number" && Number.isFinite(data.stepNumber)
        ? data.stepNumber
        : undefined;
      if (stepNumber) snapshot.currentStepNum = stepNumber;
    }
    if (type === "action_log") {
      const existing = Array.isArray(snapshot.actionLog) ? snapshot.actionLog as Record<string, unknown>[] : [];
      snapshot.actionLog = existing.concat({
        type: typeof data.actionType === "string" ? data.actionType : "tool_call",
        label: typeof data.label === "string" ? data.label : "",
        detail: typeof data.detail === "string" ? data.detail : "",
        filePath: typeof data.filePath === "string" ? data.filePath : undefined,
        stepNum: typeof data.stepNumber === "number" ? data.stepNumber : snapshot.currentStepNum,
        eventId: typeof data.eventId === "number" ? data.eventId : undefined,
        timestamp: Date.now(),
      }).slice(-SNAPSHOT_ACTION_LOG_LIMIT);
    }
    if (type === "ledger_snapshot" && data.ledger && typeof data.ledger === "object") {
      session.ledgerSnapshot = data.ledger as Record<string, unknown>;
      snapshot.ledger = session.ledgerSnapshot;
    }
    if (type === "all_complete" || type === "review_done" || type === "plan_ready") {
      session.finalArtifact = { ...data, completedAt: Date.now() };
      snapshot.finalArtifact = session.finalArtifact;
    }
    session.currentSnapshot = {
      ...snapshot,
      lastEventType: type,
      updatedAt: Date.now(),
      ledger: session.ledgerSnapshot,
      finalArtifact: session.finalArtifact ?? undefined,
    };
  }

  private scheduleFlushRetry(session: AgentSession, err: unknown): void {
    const retryCount = Math.min((session._flushRetryCount ?? 0) + 1, 6);
    session._flushRetryCount = retryCount;
    const delay = Math.min(60_000, 5_000 * Math.pow(2, retryCount - 1));
    session._nextFlushAt = Date.now() + delay;
    console.warn(
      `[SessionManager] next flush retry for ${session.id} in ${Math.round(delay / 1000)}s:`,
      err instanceof Error ? err.message : err,
    );
  }

  /**
   * GC: clean up expired sessions from live cache and DB.
   */
  private async gc(): Promise<void> {
    const now = Date.now();
    for (const [id, session] of this.live) {
      // Remove done sessions past retention
      if (session.done && session.doneAt && now - session.doneAt > this.DONE_RETENTION_MS) {
        this.live.delete(id);
        continue;
      }
      // Force-interrupt stuck sessions past maxAge
      if (!session.done && now - session.createdAt > this.MAX_AGE_MS) {
        console.warn(`[SessionManager] force-interrupting stuck session ${id} (age: ${Math.round((now - session.createdAt) / 1000)}s)`);
        session.status = "interrupted";
        session.done = true;
        session.doneAt = now;
        await this.cleanup(id).catch(() => {});
      }
    }
    // DB-level GC
    await this.store.deleteOld(this.MAX_AGE_MS + this.DONE_RETENTION_MS).catch(() => {});
  }
}
