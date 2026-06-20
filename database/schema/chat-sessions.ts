import { pgTable, varchar, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { projects } from "./projects";

export const chatSessions = pgTable("chat_sessions", {
  id: varchar("id").primaryKey(),                                                    // nanoid
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("新对话"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { mode: "date", withTimezone: true }),
  messageCount: integer("message_count").notNull().default(0),
}, (t) => ({
  projectIdx: index("chat_sessions_project_idx").on(t.projectId, t.createdAt),
}));

export type ChatSession = typeof chatSessions.$inferSelect;
