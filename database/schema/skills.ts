import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { projects } from "./projects.js";

export const userSkills = pgTable("user_skills", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  type: text("type").notNull().default("knowledge"),
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
  type: text("type").notNull().default("knowledge"),
  content: text("content").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({
  projectNameUnique: uniqueIndex("project_skills_project_name_unique").on(t.projectId, t.name),
}));

export const insertProjectSkillSchema = createInsertSchema(projectSkills).omit({ createdAt: true });
export type InsertProjectSkill = z.infer<typeof insertProjectSkillSchema>;
export type ProjectSkill = typeof projectSkills.$inferSelect;
