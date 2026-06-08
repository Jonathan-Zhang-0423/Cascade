import { pgTable, text, varchar, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { projects } from "./projects";

export const projectFiles = pgTable("project_files", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
}, (t) => ({
  // One row per (project, path). Required for the atomic ON CONFLICT upsert and
  // to prevent duplicate rows under concurrent writes.
  projectPathUnique: unique("project_files_project_id_path_key").on(t.projectId, t.path),
}));

export const insertProjectFileSchema = createInsertSchema(projectFiles);

export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;
export type ProjectFile = typeof projectFiles.$inferSelect;
