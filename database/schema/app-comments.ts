import { pgTable, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const appComments = pgTable("app_comments", {
  id: varchar("id").primaryKey(),
  appId: varchar("app_id").notNull(),
  userId: varchar("user_id").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("app_comments_app_id_idx").on(t.appId),
  index("app_comments_user_id_idx").on(t.userId),
  index("app_comments_created_at_idx").on(t.createdAt),
]);

export const insertAppCommentSchema = createInsertSchema(appComments).omit({
  createdAt: true,
  updatedAt: true,
}).extend({
  content: z.string().min(1).max(500),
});

export type AppComment = typeof appComments.$inferSelect;
export type InsertAppComment = z.infer<typeof insertAppCommentSchema>;
