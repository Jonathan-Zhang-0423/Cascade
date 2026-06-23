import { pgTable, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const changelogEntries = pgTable("changelog_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  version: text("version"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  isPublished: boolean("is_published").notNull().default(true),
}, (t) => ({
  publishedAtIdx: index("changelog_published_at_idx").on(t.publishedAt),
}));

export type ChangelogEntry = typeof changelogEntries.$inferSelect;
