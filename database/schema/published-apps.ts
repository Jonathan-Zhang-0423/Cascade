import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, index, unique, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const publishedApps = pgTable("published_apps", {
  id: varchar("id").primaryKey(),
  projectId: varchar("project_id").notNull(),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  isOpenSource: boolean("is_open_source").notNull().default(false),
  visibility: text("visibility").notNull().default("public"),
  previewScreenshot: text("preview_screenshot"),
  previewVideo: text("preview_video"),
  framework: text("framework").notNull().default("web"),
  viewCount: integer("view_count").notNull().default(0),
  forkCount: integer("fork_count").notNull().default(0),
  adminTakenDown: boolean("admin_taken_down").notNull().default(false),
  publishedAt: timestamp("published_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("published_apps_visibility_published_at_idx").on(table.visibility, table.publishedAt),
  index("published_apps_user_id_idx").on(table.userId),
  index("published_apps_project_id_idx").on(table.projectId),
  index("published_apps_view_count_idx").on(table.viewCount),
  unique("published_apps_project_user_uniq").on(table.projectId, table.userId),
]);

export const insertPublishedAppSchema = createInsertSchema(publishedApps).omit({
  publishedAt: true,
  updatedAt: true,
  viewCount: true,
  forkCount: true,
}).extend({
  visibility: z.enum(["public", "link_only", "private"]).optional(),
  framework: z.string().optional(),
});

export type InsertPublishedApp = z.infer<typeof insertPublishedAppSchema>;
export type PublishedApp = typeof publishedApps.$inferSelect;
