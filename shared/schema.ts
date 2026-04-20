import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const projects = pgTable("projects", {
  id: varchar("id").primaryKey(),
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
  framework: z.enum(["web", "rn-expo", "flutter", "swiftui", "kotlin"]).optional(),
  language: z.enum(["html", "typescript", "dart", "swift", "kotlin"]).optional(),
  targetPlatform: z.enum(["ios", "android", "both"]).optional(),
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

export const projectFiles = pgTable("project_files", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
});

export const insertProjectFileSchema = createInsertSchema(projectFiles);

export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;
export type ProjectFile = typeof projectFiles.$inferSelect;

export const userSkills = pgTable("user_skills", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  type: text("type").notNull().default("knowledge"), // "knowledge" | "tool"
  content: text("content").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  userNameUnique: uniqueIndex("user_skills_user_name_unique").on(t.userId, t.name),
}));

export const insertUserSkillSchema = createInsertSchema(userSkills).omit({ createdAt: true });
export type InsertUserSkill = z.infer<typeof insertUserSkillSchema>;
export type UserSkill = typeof userSkills.$inferSelect;

export const projectSkills = pgTable("project_skills", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  type: text("type").notNull().default("knowledge"), // "knowledge" | "tool"
  content: text("content").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  projectNameUnique: uniqueIndex("project_skills_project_name_unique").on(t.projectId, t.name),
}));

export const insertProjectSkillSchema = createInsertSchema(projectSkills).omit({ createdAt: true });
export type InsertProjectSkill = z.infer<typeof insertProjectSkillSchema>;
export type ProjectSkill = typeof projectSkills.$inferSelect;
