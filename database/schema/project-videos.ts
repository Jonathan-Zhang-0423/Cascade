import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const projectVideos = pgTable("project_videos", {
  id: varchar("id").primaryKey(),
  projectId: varchar("project_id").notNull(),
  userId: varchar("user_id"),
  status: text("status").notNull().default("pending"), // pending|running|done|error
  localPath: text("local_path"),       // absolute path on disk (stage 1)
  cosUrl: text("cos_url"),             // COS URL after upload (stage 2)
  duration: integer("duration"),       // recorded seconds
  style: text("style").notNull().default("raw"), // raw | styled variant
  parentVideoId: varchar("parent_video_id"), // derived from this raw video
  actionSequence: text("action_sequence"),   // DSL snapshot used for this recording
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  finishedAt: timestamp("finished_at"),
});

export const insertProjectVideoSchema = createInsertSchema(projectVideos).omit({
  createdAt: true,
  finishedAt: true,
}).extend({
  status: z.enum(["pending", "running", "done", "error"]).optional(),
  style: z.string().optional(),
  duration: z.number().int().positive().optional(),
});

export type InsertProjectVideo = z.infer<typeof insertProjectVideoSchema>;
export type ProjectVideo = typeof projectVideos.$inferSelect;
