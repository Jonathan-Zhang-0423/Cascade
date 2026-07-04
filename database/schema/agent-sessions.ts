import { pgTable, text, varchar, integer, bigint, index, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Unified agent session persistence. Generalizes the existing manager_sessions
 * table to support all session types (build, manager, review, aigc).
 *
 * Design principles:
 * - events[] is the replay buffer (JSON text, periodically flushed)
 * - payload holds type-specific data (plan, userRequest, files summary)
 * - status is the state machine (pending → running → done/error/interrupted/aborted)
 * - On server restart, running/pending sessions are marked "interrupted"
 * - Milestone events (step_completed, all_complete) trigger immediate flush
 * - Token-level events flush every ~5s (bounded data loss on crash)
 *
 * project_id is a SOFT reference (no FK constraint): a session can legitimately
 * start before the project row is committed (e.g. first build of a new project),
 * so enforcing a foreign key would crash session creation. It's used only for
 * lookup/filtering.
 */
export const agentSessions = pgTable("agent_sessions", {
  id: varchar("id").primaryKey(),
  type: varchar("type", { length: 32 }).notNull(), // 'build' | 'manager' | 'review' | 'aigc'
  projectId: varchar("project_id"),
  userId: varchar("user_id"),
  chatSessionId: varchar("chat_session_id").notNull().default("main"),
  runType: varchar("run_type", { length: 32 }),
  runGroupId: varchar("run_group_id"),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  doneAt: bigint("done_at", { mode: "number" }),
  nextEventId: integer("next_event_id").notNull().default(0),
  lastEventId: integer("last_event_id").notNull().default(-1),
  lastHeartbeatAt: bigint("last_heartbeat_at", { mode: "number" }),
  // JSON-encoded Array<{ eventId: number; data: Record<string, unknown> }>
  // Legacy compatibility cache. New replay writes are also stored append-only
  // in agent_session_events.
  events: text("events").notNull().default("[]"),
  // JSON-encoded type-specific payload (plan, userRequest, framework, etc.)
  payload: text("payload").notNull().default("{}"),
  // JSON snapshots used to rebuild the UI after a hard refresh without
  // replaying every token event.
  currentSnapshot: text("current_snapshot").notNull().default("{}"),
  ledgerSnapshot: text("ledger_snapshot").notNull().default("{}"),
  finalArtifact: text("final_artifact"),
}, (t) => ({
  projectActiveIdx: index("agent_sessions_project_active_idx").on(t.projectId, t.status),
  projectChatActiveIdx: index("agent_sessions_project_chat_active_idx").on(t.projectId, t.chatSessionId, t.status),
  typeStatusIdx: index("agent_sessions_type_status_idx").on(t.type, t.status),
  userIdx: index("agent_sessions_user_idx").on(t.userId),
}));

export const agentSessionEvents = pgTable("agent_session_events", {
  sessionId: varchar("session_id").notNull().references(() => agentSessions.id, { onDelete: "cascade" }),
  eventId: integer("event_id").notNull(),
  data: text("data").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.sessionId, t.eventId] }),
  sessionIdx: index("agent_session_events_session_idx").on(t.sessionId, t.eventId),
}));

export const insertAgentSessionSchema = createInsertSchema(agentSessions);
export type InsertAgentSession = z.infer<typeof insertAgentSessionSchema>;
export type AgentSessionRow = typeof agentSessions.$inferSelect;
export type AgentSessionEventRow = typeof agentSessionEvents.$inferSelect;
