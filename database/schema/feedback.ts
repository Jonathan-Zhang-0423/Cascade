import { pgTable, serial, text, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";

export const userFeedback = pgTable("user_feedback", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  email: text("email"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  status: text("status").notNull().default("new"), // "new" | "reviewed"
});

export const changelogEntries = pgTable("changelog_entries", {
  id: serial("id").primaryKey(),
  version: text("version"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  isPublished: boolean("is_published").notNull().default(true),
});

export const insertUserFeedbackSchema = createInsertSchema(userFeedback).pick({
  userId: true,
  email: true,
  content: true,
  ipAddress: true,
});

export const insertChangelogEntrySchema = createInsertSchema(changelogEntries).pick({
  version: true,
  title: true,
  content: true,
  isPublished: true,
});

export type InsertUserFeedback = z.infer<typeof insertUserFeedbackSchema>;
export type UserFeedback = typeof userFeedback.$inferSelect;
export type InsertChangelogEntry = z.infer<typeof insertChangelogEntrySchema>;
export type ChangelogEntry = typeof changelogEntries.$inferSelect;
