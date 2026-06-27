import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password"),
  email: text("email").unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  phone: text("phone").unique(),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  githubId: text("github_id").unique(),
  avatarUrl: text("avatar_url"),
  experienceLevel: text("experience_level").notNull().default("intermediate"),
  hasSetExperienceLevel: boolean("has_set_experience_level").notNull().default(false),
  inviteCode: text("invite_code"),
  trialExpiresAt: timestamp("trial_expires_at", { mode: "date", withTimezone: true }),
  // Referral system
  referralCode: text("referral_code").unique(),   // this user's shareable code
  referredBy: varchar("referred_by"),             // id of the user who referred them
  wechatOpenId: text("wechat_open_id").unique(),
  wechatUnionId: text("wechat_union_id").unique(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
