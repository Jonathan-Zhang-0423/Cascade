import { pgTable, serial, text, timestamp, integer, boolean, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { waitlistSubscribers } from "./waitlist";

export const inviteCodes = pgTable("invite_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  isEdu: boolean("is_edu").notNull().default(false),
  trialDays: integer("trial_days").notNull(),
  expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  redeemedByUserId: varchar("redeemed_by_user_id").references(() => users.id),
  redeemedAt: timestamp("redeemed_at", { mode: "date", withTimezone: true }),
  waitlistSubscriberId: integer("waitlist_subscriber_id").references(() => waitlistSubscribers.id),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
});

export const insertInviteCodeSchema = createInsertSchema(inviteCodes).pick({
  code: true,
  isEdu: true,
  trialDays: true,
  expiresAt: true,
  waitlistSubscriberId: true,
});

export type InsertInviteCode = z.infer<typeof insertInviteCodeSchema>;
export type InviteCode = typeof inviteCodes.$inferSelect;
