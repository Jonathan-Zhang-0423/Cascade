import { pgTable, varchar, timestamp, index, unique } from "drizzle-orm/pg-core";

export const appLikes = pgTable("app_likes", {
  id: varchar("id").primaryKey(),
  appId: varchar("app_id").notNull(),
  userId: varchar("user_id").notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("app_likes_app_id_idx").on(t.appId),
  index("app_likes_user_id_idx").on(t.userId),
  unique("app_likes_app_user_uniq").on(t.appId, t.userId),
]);

export type AppLike = typeof appLikes.$inferSelect;
