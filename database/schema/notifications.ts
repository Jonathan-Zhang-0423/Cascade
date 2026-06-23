import { pgTable, integer, varchar, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const notifications = pgTable("notifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 20 }).notNull(), // "changelog" | "admin_reply"
  title: text("title").notNull(),
  body: text("body"),
  refId: integer("ref_id"), // changelog_entries.id 或 user_feedback.id
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("notifications_user_idx").on(t.userId),
  createdIdx: index("notifications_created_idx").on(t.createdAt),
}));

export type Notification = typeof notifications.$inferSelect;
