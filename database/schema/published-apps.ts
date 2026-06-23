import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, index } from "drizzle-orm/pg-core";
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
  framework: text("framework").notNull().default("web"),
  publishedAt: timestamp("published_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("published_apps_visibility_published_at_idx").on(table.visibility, table.publishedAt),
  index("published_apps_user_id_idx").on(table.userId),
  index("published_apps_project_id_idx").on(table.projectId),
]);

export const insertPublishedAppSchema = createInsertSchema(publishedApps).omit({
  publishedAt: true,
  updatedAt: true,
}).extend({
  visibility: z.enum(["public", "link_only", "private"]).optional(),
  framework: z.string().optional(),
});

export type InsertPublishedApp = z.infer<typeof insertPublishedAppSchema>;
export type PublishedApp = typeof publishedApps.$inferSelect;
