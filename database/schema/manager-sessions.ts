import { pgTable, text, varchar, integer, bigint, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { projects } from "./projects";

/**
 * Persists active manager-chat sessions so they survive server restarts.
 * The in-memory `events[]` buffer is stored as a JSON text column — it's
 * only needed for reconnect replay and can be large, but sessions are
 * short-lived (max 30 min) so storage pressure is low.
 */
export const managerSessions = pgTable("manager_sessions", {
  id: varchar("id").primaryKey(),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  done: boolean("done").notNull().default(false),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  doneAt: bigint("done_at", { mode: "number" }),
  nextEventId: integer("next_event_id").notNull().default(0),
  // JSON-encoded Array<{ eventId: number; data: Record<string, unknown> }>
  events: text("events").notNull().default("[]"),
}, (t) => ({
  projectActiveIdx: index("manager_sessions_project_active_idx").on(t.projectId, t.done),
}));

export const insertManagerSessionSchema = createInsertSchema(managerSessions);
export type InsertManagerSession = z.infer<typeof insertManagerSessionSchema>;
export type ManagerSessionRow = typeof managerSessions.$inferSelect;
