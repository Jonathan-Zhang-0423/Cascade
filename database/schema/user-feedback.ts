import { pgTable, integer, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userFeedback = pgTable("user_feedback", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  source: varchar("source", { length: 20 }).notNull().default("pc"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  repliedAt: timestamp("replied_at", { mode: "date", withTimezone: true }),
  replyContent: text("reply_content"),
}, (t) => ({
  userIdx: index("user_feedback_user_idx").on(t.userId),
  createdIdx: index("user_feedback_created_idx").on(t.createdAt),
}));

export type UserFeedback = typeof userFeedback.$inferSelect;
