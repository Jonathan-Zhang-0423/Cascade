import { sql } from "drizzle-orm";
import { pgTable, varchar, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";

export const adminUsers = pgTable("admin_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret"),               // AES-256-GCM encrypted
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  role: varchar("role", { length: 32 }).notNull().default("admin"),
  lastLoginAt: timestamp("last_login_at", { mode: "date", withTimezone: true }),
  lastLoginIp: varchar("last_login_ip", { length: 45 }),
  isActive: boolean("is_active").notNull().default(true),
  backupCodes: text("backup_codes"),             // JSON array of bcrypt hashes
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { mode: "date", withTimezone: true }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().default(sql`now()`),
});

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
