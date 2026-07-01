import { sql } from "drizzle-orm";
import { pgTable, varchar, text, timestamp, serial, jsonb } from "drizzle-orm/pg-core";

export const adminAuditLog = pgTable("admin_audit_log", {
  id: serial("id").primaryKey(),
  adminUserId: varchar("admin_user_id").notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  resource: varchar("resource", { length: 128 }),
  resourceId: varchar("resource_id", { length: 256 }),
  details: jsonb("details"),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().default(sql`now()`),
});

export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLog.$inferInsert;
