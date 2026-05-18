import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const projects = pgTable("projects", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id"),
  name: text("name").notNull(),
  emoji: text("emoji"),
  framework: text("framework").notNull().default("web"),
  language: text("language").notNull().default("html"),
  targetPlatform: text("target_platform"),
  lastPlan: text("last_plan"),
  lastBuildResult: text("last_build_result"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  createdAt: true,
  lastPlan: true,
  lastBuildResult: true,
}).extend({
  framework: z.enum(["web", "rn-expo", "flutter", "swiftui", "kotlin", "wechat"]).optional(),
  language: z.enum(["html", "typescript", "dart", "swift", "kotlin", "wxml"]).optional(),
  targetPlatform: z.enum(["ios", "android", "both"]).optional(),
  userId: z.string().optional(),
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;
