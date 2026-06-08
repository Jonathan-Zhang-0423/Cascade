import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: serial("id").primaryKey(),
    channel: text("channel").notNull(),
    target: text("target").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    targetPurposeCreatedIdx: index("otp_codes_target_purpose_created_idx").on(
      t.target,
      t.purpose,
      t.createdAt,
    ),
  }),
);

export type OtpCode = typeof otpCodes.$inferSelect;
