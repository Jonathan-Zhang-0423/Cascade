import { sql } from "drizzle-orm";
import { pgTable, varchar, integer, text, timestamp } from "drizzle-orm/pg-core";

export const subscriptionGrants = pgTable("subscription_grants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  grantedDays: integer("granted_days").notNull(),
  reason: text("reason"),
  relatedUserId: varchar("related_user_id"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export type SubscriptionGrant = typeof subscriptionGrants.$inferSelect;
