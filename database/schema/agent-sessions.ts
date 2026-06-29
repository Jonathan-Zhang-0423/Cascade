import { pgTable, text, varchar, integer, bigint, index } from "drizzle-orm/pg-core";
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
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  doneAt: bigint("done_at", { mode: "number" }),
  nextEventId: integer("next_event_id").notNull().default(0),
  // JSON-encoded Array<{ eventId: number; data: Record<string, unknown> }>
  events: text("events").notNull().default("[]"),
  // JSON-encoded type-specific payload (plan, userRequest, framework, etc.)
  payload: text("payload").notNull().default("{}"),
}, (t) => ({
  projectActiveIdx: index("agent_sessions_project_active_idx").on(t.projectId, t.status),
  typeStatusIdx: index("agent_sessions_type_status_idx").on(t.type, t.status),
  userIdx: index("agent_sessions_user_idx").on(t.userId),
}));

export const insertAgentSessionSchema = createInsertSchema(agentSessions);
export type InsertAgentSession = z.infer<typeof insertAgentSessionSchema>;
export type AgentSessionRow = typeof agentSessions.$inferSelect;
