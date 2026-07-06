import { pgTable, varchar, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Persisted IP ban list. The in-memory `ipBlocklist` Map in
 * `middleware/security.ts` is the hot O(1) check; this table is the source of
 * truth that survives process restarts and powers the admin blocklist UI.
 *
 * Rows are upserted on ban and deleted on unban. Expired rows
 * (`blocked_until <= now()`) are ignored at read time and pruned on boot.
 */
export const ipBans = pgTable("ip_bans", {
  ip: varchar("ip", { length: 45 }).primaryKey(), // 45 covers full IPv6
  reason: text("reason").notNull(),
  blockedAt: timestamp("blocked_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  blockedUntil: timestamp("blocked_until", { mode: "date", withTimezone: true }).notNull(),
  // "auto" for cross-account brute-force triggers, or the admin user id for manual bans.
  bannedBy: varchar("banned_by", { length: 64 }),
});

export type IpBan = typeof ipBans.$inferSelect;
export type NewIpBan = typeof ipBans.$inferInsert;
