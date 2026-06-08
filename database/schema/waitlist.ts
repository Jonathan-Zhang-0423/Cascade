import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const waitlistSubscribers = pgTable("waitlist_subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  isEdu: boolean("is_edu").notNull().default(false),
  status: text("status").notNull().default("pending"),
  batchId: integer("batch_id"),
  confirmationEmailSentAt: timestamp("confirmation_email_sent_at", { mode: "date", withTimezone: true }),
});

export const insertWaitlistSubscriberSchema = createInsertSchema(waitlistSubscribers).pick({
  email: true,
  ipAddress: true,
  isEdu: true,
});

export type InsertWaitlistSubscriber = z.infer<typeof insertWaitlistSubscriberSchema>;
export type WaitlistSubscriber = typeof waitlistSubscribers.$inferSelect;
