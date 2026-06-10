import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Express session store table, owned by `connect-pg-simple`.
 *
 * This table is created at runtime by the session middleware
 * (`createTableIfMissing: true` in backend/api/src/infra/index.ts), NOT by
 * Drizzle. It is declared here only so `drizzle-kit push` recognizes it and
 * stops proposing to drop it on every push — which would delete live login
 * sessions.
 *
 * The shape mirrors connect-pg-simple's default table exactly:
 *   sid    varchar PRIMARY KEY
 *   sess   json    NOT NULL
 *   expire timestamp (no time zone) NOT NULL, indexed
 *
 * Keep this in sync with connect-pg-simple's table definition; do not edit
 * the column types or the index name (the quoted "IDX_session_expire" must
 * match what the library creates, or push will churn the index).
 */
export const session = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { mode: "date", withTimezone: false }).notNull(),
}, (t) => ({
  expireIdx: index("IDX_session_expire").on(t.expire),
}));

export type SessionRow = typeof session.$inferSelect;
