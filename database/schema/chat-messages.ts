import { pgTable, text, varchar, integer, bigint, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { projects } from "./projects";

export const chatMessages = pgTable("chat_messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull(),
  kind: text("kind").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  thinking: text("thinking"),
  source: text("source"),
  seq: integer("seq").notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  metadata: text("metadata"),
}, (t) => ({
  clientUnique: uniqueIndex("chat_messages_project_client_unique").on(t.projectId, t.clientId),
  projectKindSeqIdx: index("chat_messages_project_kind_seq_idx").on(t.projectId, t.kind, t.seq),
}));

export const insertChatMessageSchema = createInsertSchema(chatMessages);
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
