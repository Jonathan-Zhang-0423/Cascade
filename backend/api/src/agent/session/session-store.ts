import { eq, and, lt, inArray } from "drizzle-orm";
import { db } from "../../infra/db";
import { agentSessions, type AgentSessionRow } from "@cascade/database";
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

/**
 * The persisted session shape returned by the store.
 */
export interface PersistedSession {
  id: string;
  type: SessionType;
  projectId: string | null;
  userId: string | null;
  status: SessionStatus;
  createdAt: number;
  doneAt: number | null;
  nextEventId: number;
  events: BufferedEvent[];
  payload: Record<string, unknown>;
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
  /**
   * Create a new session record in the DB.
   */
  async create(session: {
    id: string;
    type: SessionType;
    projectId?: string | null;
    userId?: string | null;
    status: SessionStatus;
    createdAt: number;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await db.insert(agentSessions).values({
      id: session.id,
      type: session.type,
      projectId: session.projectId ?? null,
      userId: session.userId ?? null,
      status: session.status,
      createdAt: session.createdAt,
      nextEventId: 0,
      events: "[]",
      payload: JSON.stringify(session.payload ?? {}),
    });
  }

  /**
   * Update session status (state machine transition).
   */
  async updateStatus(id: string, status: SessionStatus, doneAt?: number): Promise<void> {
    await db.update(agentSessions)
      .set({ status, doneAt: doneAt ?? null })
      .where(eq(agentSessions.id, id));
  }

  /**
   * Flush the event buffer to DB (periodic batch overwrite).
   * Called every ~5s for active sessions and immediately on milestones.
   */
  async flushEvents(id: string, events: BufferedEvent[], nextEventId: number): Promise<void> {
    await db.update(agentSessions)
      .set({
        events: JSON.stringify(events),
        nextEventId,
      })
      .where(eq(agentSessions.id, id));
  }

  /**
   * Load a session from DB (for rehydration after restart / reconnect).
   */
  async load(id: string): Promise<PersistedSession | null> {
    const [row] = await db.select().from(agentSessions).where(eq(agentSessions.id, id));
    return row ? this.rowToSession(row) : null;
  }

  /**
   * Load all non-terminal sessions for a project (for reconnection after restart).
   */
  async loadActiveForProject(projectId: string): Promise<PersistedSession[]> {
    const rows = await db.select().from(agentSessions)
      .where(and(
        eq(agentSessions.projectId, projectId),
        inArray(agentSessions.status, ["pending", "running"]),
      ));
    return rows.map(r => this.rowToSession(r));
  }

  /**
   * Server startup recovery: mark all pending/running sessions as interrupted.
   * These were in-flight when the server crashed — the LLM call cannot be resumed.
   */
  async markInterruptedOnStartup(): Promise<number> {
    const result = await db.update(agentSessions)
      .set({ status: "interrupted", doneAt: Date.now() })
      .where(inArray(agentSessions.status, ["pending", "running"]))
      .returning({ id: agentSessions.id });
    return result.length;
  }

  /**
   * GC: delete sessions older than maxAgeMs (measured from createdAt).
   */
  async deleteOld(maxAgeMs: number): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    await db.delete(agentSessions).where(lt(agentSessions.createdAt, cutoff));
  }

  /**
   * Delete a specific session by ID.
   */
  async delete(id: string): Promise<void> {
    await db.delete(agentSessions).where(eq(agentSessions.id, id));
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private rowToSession(row: AgentSessionRow): PersistedSession {
    let events: BufferedEvent[] = [];
    try { events = JSON.parse(row.events); } catch {}
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(row.payload); } catch {}
    return {
      id: row.id,
      type: row.type as SessionType,
      projectId: row.projectId,
      userId: row.userId,
      status: row.status as SessionStatus,
      createdAt: row.createdAt,
      doneAt: row.doneAt,
      nextEventId: row.nextEventId,
      events,
      payload,
    };
  }
}
