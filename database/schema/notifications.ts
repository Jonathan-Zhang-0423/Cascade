import { pgTable, integer, varchar, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const notifications = pgTable("notifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull().default("admin_reply"), // "admin_reply" | "system"
  title: text("title").notNull(),
  body: text("body").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("notifications_user_idx").on(t.userId, t.createdAt),
}));

export type Notification = typeof notifications.$inferSelect;
