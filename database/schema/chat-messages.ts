import { pgTable, text, varchar, integer, bigint, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { projects } from "./projects";

export const chatMessages = pgTable("chat_messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // session_id：普通字符串字段（无外键），主会话固定为 "main"，命名会话为其 id。
  // 不用外键是因为 "main" 不对应 chat_sessions 表里的真实记录。
  sessionId: varchar("session_id").notNull().default("main"),
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
  // 唯一约束加入 sessionId：同一 client_id 在不同 session 视为不同消息
  clientUnique: uniqueIndex("chat_messages_project_session_client_unique").on(t.projectId, t.sessionId, t.clientId),
  projectSessionKindSeqIdx: index("chat_messages_project_session_kind_seq_idx").on(t.projectId, t.sessionId, t.kind, t.seq),
  sessionIdx: index("chat_messages_session_idx").on(t.sessionId),
}));

export const insertChatMessageSchema = createInsertSchema(chatMessages);
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
