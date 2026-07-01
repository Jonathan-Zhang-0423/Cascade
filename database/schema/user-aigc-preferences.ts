import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const userAigcPreferences = pgTable("user_aigc_preferences", {
  userId: text("user_id").primaryKey(),
  styleHistory: text("style_history").array().notNull().default(sql`'{}'::text[]`),
  colorTone: text("color_tone"),       // e.g. "冷色调"
  lastStyle: text("last_style"),       // most recently used style preset
  generationCount: integer("generation_count").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export type UserAigcPreferences = typeof userAigcPreferences.$inferSelect;
