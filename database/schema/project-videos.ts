import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const projectVideos = pgTable("project_videos", {
  id: varchar("id").primaryKey(),
  projectId: varchar("project_id").notNull(),
  userId: varchar("user_id"),
  status: text("status").notNull().default("pending"), // pending|running|done|error
  localPath: text("local_path"),       // 阶段一：本地持久路径
  cosUrl: text("cos_url"),             // 阶段二：COS 上传后的 URL
  duration: integer("duration"),       // 录制时长（秒）
  style: text("style").notNull().default("raw"), // raw | 后期风格化类型
  parentVideoId: varchar("parent_video_id"), // 派生视频指向原始视频
  actionSequence: text("action_sequence"), // 生成时使用的 JSON DSL 快照
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
