import { eq, and, lt, gt, inArray, desc, sql } from "drizzle-orm";
import { db, withDbRetry } from "../../infra/db";
import { agentSessions, agentSessionEvents, type AgentSessionRow } from "@cascade/database";
import type { BufferedEvent } from "../../infra/sse";

/**
 * Session types supported by the unified session management system.
 */
export type SessionType = "build" | "manager" | "review" | "aigc";

/**
 * Session lifecycle states (state machine).
 *
 * pending      → session created, not yet running
 * running      → orchestrator actively executing
 * done         → completed successfully
 * error        → failed with an error
 * interrupted  → was running when server restarted/crashed
 * aborted      → user explicitly cancelled
 */
export type SessionStatus = "pending" | "running" | "done" | "error" | "interrupted" | "aborted";

const LEGACY_EVENT_CACHE_LIMIT = 500;

/**
 * The persisted session shape returned by the store.
 */
export interface PersistedSession {
  id: string;
  type: SessionType;
  projectId: string | null;
  userId: string | null;
  chatSessionId: string;
  runType: string | null;
  runGroupId: string | null;
  status: SessionStatus;
  createdAt: number;
  doneAt: number | null;
  nextEventId: number;
  lastEventId: number;
  lastHeartbeatAt: number | null;
  events: BufferedEvent[];
  payload: Record<string, unknown>;
  currentSnapshot: Record<string, unknown>;
  ledgerSnapshot: Record<string, unknown>;
  finalArtifact: Record<string, unknown> | null;
}

/**
 * SessionStore — Postgres persistence layer for agent sessions.
 *
 * Responsibilities:
 * - CRUD for session records
 * - Periodic event flush (batch JSON overwrite)
 * - Startup recovery (mark interrupted sessions)
 * - GC (delete old sessions)
 *
 * Does NOT manage in-memory state or SSE writers — that's SessionManager's job.
 */
export class SessionStore {
  private warnedEventTableUnavailable = false;

  /**
   * Create a new session record in the DB.
   */
  async create(session: {
    id: string;
    type: SessionType;
    projectId?: string | null;
    userId?: string | null;
    chatSessionId?: string | null;
    runType?: string | null;
    runGroupId?: string | null;
    status: SessionStatus;
    createdAt: number;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await withDbRetry("agent session create", () => db.insert(agentSessions).values({
      id: session.id,
      type: session.type,
      projectId: session.projectId ?? null,
      userId: session.userId ?? null,
      chatSessionId: normalizeChatSessionId(session.chatSessionId),
      runType: session.runType ?? session.type,
      runGroupId: session.runGroupId ?? null,
      status: session.status,
      createdAt: session.createdAt,
      nextEventId: 0,
      lastEventId: -1,
      lastHeartbeatAt: session.createdAt,
      events: "[]",
      payload: JSON.stringify(session.payload ?? {}),
      currentSnapshot: "{}",
      ledgerSnapshot: "{}",
      finalArtifact: null,
    }));
  }

  /**
   * Update session status (state machine transition).
   */
  async updateStatus(id: string, status: SessionStatus, doneAt?: number): Promise<void> {
    await withDbRetry("agent session updateStatus", () => db.update(agentSessions)
      .set({ status, doneAt: doneAt ?? null })
      .where(eq(agentSessions.id, id)));
  }

  /**
   * Flush the event buffer to DB. New writes are append-only into
   * agent_session_events, while the legacy JSON column is kept as a compact
   * compatibility cache for old callers/tests.
   */
  async flushEvents(id: string, events: BufferedEvent[], nextEventId: number): Promise<void> {
    await withDbRetry("agent session flushEvents", async () => {
      const [existing] = await db.select({ lastEventId: agentSessions.lastEventId })
        .from(agentSessions)
        .where(eq(agentSessions.id, id))
        .limit(1);
      const persistedLastEventId = existing?.lastEventId ?? -1;
      const newEvents = events.filter((event) => event.eventId > persistedLastEventId);
      let eventAppendSucceeded = true;
      if (newEvents.length > 0) {
        try {
          await db.insert(agentSessionEvents)
            .values(newEvents.map((event) => ({
              sessionId: id,
              eventId: event.eventId,
              data: JSON.stringify(event.data),
              createdAt: Date.now(),
            })))
            .onConflictDoNothing();
        } catch (err) {
          eventAppendSucceeded = false;
          if (!this.warnedEventTableUnavailable) {
            this.warnedEventTableUnavailable = true;
            console.warn("[SessionStore] append-only event table write failed; falling back to legacy session event cache:", err instanceof Error ? err.message : err);
          }
        }
      }
      const bufferedLastEventId = events.length > 0 ? events[events.length - 1].eventId : nextEventId - 1;
      const appendSafeLastEventId = eventAppendSucceeded ? bufferedLastEventId : persistedLastEventId;
      const legacyEvents = events.slice(-LEGACY_EVENT_CACHE_LIMIT);
      await db.update(agentSessions)
        .set({
          events: sql`case when ${agentSessions.nextEventId} <= ${nextEventId} then ${JSON.stringify(legacyEvents)} else ${agentSessions.events} end`,
          nextEventId: sql`greatest(${agentSessions.nextEventId}, ${nextEventId})`,
          lastEventId: sql`greatest(${agentSessions.lastEventId}, ${appendSafeLastEventId})`,
          lastHeartbeatAt: Date.now(),
        })
        .where(eq(agentSessions.id, id));
    });
  }

  async saveSnapshot(
    id: string,
    snapshot: Record<string, unknown>,
    opts: { ledger?: Record<string, unknown>; finalArtifact?: Record<string, unknown> | null } = {},
  ): Promise<void> {
    await withDbRetry("agent session saveSnapshot", () => db.update(agentSessions)
      .set({
        currentSnapshot: JSON.stringify(snapshot ?? {}),
        ...(opts.ledger !== undefined ? { ledgerSnapshot: JSON.stringify(opts.ledger ?? {}) } : {}),
        ...(opts.finalArtifact !== undefined ? { finalArtifact: opts.finalArtifact ? JSON.stringify(opts.finalArtifact) : null } : {}),
        lastHeartbeatAt: Date.now(),
      })
      .where(eq(agentSessions.id, id)));
  }

  /**
   * Load a session from DB (for rehydration after restart / reconnect).
   */
  async load(id: string): Promise<PersistedSession | null> {
    const [row] = await withDbRetry("agent session load", () =>
      db.select().from(agentSessions).where(eq(agentSessions.id, id)),
    );
    if (!row) return null;
    const session = this.rowToSession(row);
    session.events = await this.loadEvents(id, -1, session.events);
    return session;
  }

  /**
   * Load all non-terminal sessions for a project (for reconnection after restart).
   */
  async loadActiveForProject(projectId: string, opts: { chatSessionId?: string | null; type?: SessionType } = {}): Promise<PersistedSession[]> {
    const conditions = [
      eq(agentSessions.projectId, projectId),
      inArray(agentSessions.status, ["pending", "running"]),
    ];
    if (opts.chatSessionId !== undefined) {
      conditions.push(eq(agentSessions.chatSessionId, normalizeChatSessionId(opts.chatSessionId)));
    }
    if (opts.type) conditions.push(eq(agentSessions.type, opts.type));
    const rows = await withDbRetry("agent session loadActiveForProject", () => db.select().from(agentSessions)
      .where(and(...conditions)));
    const sessions = rows.map(r => this.rowToSession(r));
    for (const session of sessions) {
      session.events = await this.loadEvents(session.id, -1, session.events);
    }
    return sessions;
  }

  async loadEvents(id: string, afterEventId = -1, fallbackEvents: BufferedEvent[] = []): Promise<BufferedEvent[]> {
    try {
      const rows = await withDbRetry("agent session loadEvents", () => db.select()
        .from(agentSessionEvents)
        .where(and(
          eq(agentSessionEvents.sessionId, id),
          gt(agentSessionEvents.eventId, afterEventId),
        ))
        .orderBy(agentSessionEvents.eventId));
      const tableEvents = rows
        .filter((row) => row.eventId > afterEventId)
        .map((row) => {
          let data: Record<string, unknown> = {};
          try { data = JSON.parse(row.data); } catch {}
          return { eventId: row.eventId, data };
        });
      return mergeBufferedEvents(tableEvents, fallbackEvents, afterEventId);
    } catch (err) {
      if (!this.warnedEventTableUnavailable) {
        this.warnedEventTableUnavailable = true;
        console.warn("[SessionStore] append-only event replay failed; using legacy session event cache:", err instanceof Error ? err.message : err);
      }
      return fallbackEvents.filter((event) => event.eventId > afterEventId);
    }
  }

  async getLatestForProject(
    projectId: string,
    opts: { chatSessionId?: string | null; type?: SessionType; includeDone?: boolean } = {},
  ): Promise<PersistedSession | null> {
    const conditions = [eq(agentSessions.projectId, projectId)];
    if (opts.chatSessionId !== undefined) {
      conditions.push(eq(agentSessions.chatSessionId, normalizeChatSessionId(opts.chatSessionId)));
    }
    if (opts.type) conditions.push(eq(agentSessions.type, opts.type));
    if (!opts.includeDone) conditions.push(inArray(agentSessions.status, ["pending", "running"]));
    const [row] = await withDbRetry("agent session getLatestForProject", () => db.select()
      .from(agentSessions)
      .where(and(...conditions))
      .orderBy(desc(agentSessions.createdAt))
      .limit(1));
    if (!row) return null;
    const session = this.rowToSession(row);
    session.events = await this.loadEvents(session.id, -1, session.events);
    return session;
  }

  /**
   * Server startup recovery: mark all pending/running sessions as interrupted.
   * These were in-flight when the server crashed — the LLM call cannot be resumed.
   *
   * Safety guard: only marks sessions created MORE than 10 seconds ago. This
   * prevents a race where a session created during the startup sequence (between
   * server boot and this call) gets incorrectly marked as interrupted.
   */
  async markInterruptedOnStartup(): Promise<number> {
    const safetyWindowMs = 10_000; // 10 seconds
    const cutoff = Date.now() - safetyWindowMs;
    const result = await withDbRetry("agent session markInterruptedOnStartup", () => db.update(agentSessions)
      .set({ status: "interrupted", doneAt: Date.now() })
      .where(and(
        inArray(agentSessions.status, ["pending", "running"]),
        lt(agentSessions.createdAt, cutoff),
      ))
      .returning({ id: agentSessions.id }));
    return result.length;
  }

  /**
   * GC: delete sessions older than maxAgeMs (measured from createdAt).
   */
  async deleteOld(maxAgeMs: number): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    await withDbRetry("agent session deleteOld", () =>
      db.delete(agentSessions).where(lt(agentSessions.createdAt, cutoff)),
    );
  }

  /**
   * Delete a specific session by ID.
   */
  async delete(id: string): Promise<void> {
    await withDbRetry("agent session delete", () =>
      db.delete(agentSessions).where(eq(agentSessions.id, id)),
    );
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private rowToSession(row: AgentSessionRow): PersistedSession {
    let events: BufferedEvent[] = [];
    try { events = JSON.parse(row.events); } catch {}
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(row.payload); } catch {}
    let currentSnapshot: Record<string, unknown> = {};
    try { currentSnapshot = JSON.parse(row.currentSnapshot ?? "{}"); } catch {}
    let ledgerSnapshot: Record<string, unknown> = {};
    try { ledgerSnapshot = JSON.parse(row.ledgerSnapshot ?? "{}"); } catch {}
    let finalArtifact: Record<string, unknown> | null = null;
    try { finalArtifact = row.finalArtifact ? JSON.parse(row.finalArtifact) : null; } catch {}
    return {
      id: row.id,
      type: row.type as SessionType,
      projectId: row.projectId,
      userId: row.userId,
      chatSessionId: normalizeChatSessionId(row.chatSessionId),
      runType: row.runType,
      runGroupId: row.runGroupId,
      status: row.status as SessionStatus,
      createdAt: row.createdAt,
      doneAt: row.doneAt,
      nextEventId: row.nextEventId,
      lastEventId: row.lastEventId,
      lastHeartbeatAt: row.lastHeartbeatAt,
      events,
      payload,
      currentSnapshot,
      ledgerSnapshot,
      finalArtifact,
    };
  }
}

export function normalizeChatSessionId(value?: string | null): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || "main";
}

function mergeBufferedEvents(
  primary: BufferedEvent[],
  fallback: BufferedEvent[],
  afterEventId: number,
): BufferedEvent[] {
  const byId = new Map<number, BufferedEvent>();
  for (const event of fallback) {
    if (event.eventId > afterEventId) byId.set(event.eventId, event);
  }
  for (const event of primary) {
    if (event.eventId > afterEventId) byId.set(event.eventId, event);
  }
  return Array.from(byId.values()).sort((a, b) => a.eventId - b.eventId);
}
