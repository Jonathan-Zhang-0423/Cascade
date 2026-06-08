/**
 * Test database helpers. Integration & stress tests run against TEST_DATABASE_URL
 * (redirected onto DATABASE_URL by setup-env.ts before any app module loads).
 *
 * - `hasTestDb` / `describeIntegration` let suites auto-skip when no test DB is
 *   configured, so `npm run test:integration` is a no-op rather than a failure
 *   on machines without Postgres.
 * - `truncateAll()` wipes every table between tests for isolation. It NEVER runs
 *   unless the active DATABASE_URL points at the test database (guard below).
 */
import { describe } from "vitest";
import { db } from "../../src/infra/db";
import { sql } from "drizzle-orm";

export const hasTestDb = !!process.env.TEST_DATABASE_URL;

/** Use in place of `describe` for suites that require the test DB. */
export const describeIntegration = hasTestDb ? describe : describe.skip;

// Every app-managed table, child-first isn't needed because we use CASCADE.
const ALL_TABLES = [
  "chat_messages",
  "project_files",
  "project_skills",
  "user_skills",
  "invite_codes",
  "otp_codes",
  "waitlist_subscribers",
  "projects",
  "users",
];

let guardChecked = false;

/**
 * Safety guard: refuse to truncate unless the connection string clearly targets
 * a test database. Prevents an accidental .env misconfig from wiping dev data.
 */
function assertTestDb() {
  if (guardChecked) return;
  const url = process.env.DATABASE_URL ?? "";
  const looksLikeTest =
    !!process.env.TEST_DATABASE_URL &&
    url === process.env.TEST_DATABASE_URL &&
    /test/i.test(url);
  if (!looksLikeTest) {
    throw new Error(
      `Refusing to truncate: DATABASE_URL does not look like a test DB (${url.replace(/:[^:@/]+@/, ":***@")}). ` +
        `Set TEST_DATABASE_URL to a database whose name contains "test".`,
    );
  }
  guardChecked = true;
}

/** Truncate all app tables. Call in beforeEach for full isolation. */
export async function truncateAll(): Promise<void> {
  if (!hasTestDb) return;
  assertTestDb();
  // Single statement, RESTART IDENTITY resets serial counters, CASCADE handles FKs.
  await db.execute(
    sql.raw(`TRUNCATE TABLE ${ALL_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`),
  );
}

/** Close the pg pool. Call once in afterAll of the last suite if needed. */
export async function closeDb(): Promise<void> {
  if (!hasTestDb) return;
  const { pool } = await import("../../src/infra/db");
  await pool.end().catch(() => {});
}

/**
 * Seed an unredeemed invite code (registration requires one). Returns the code
 * string. `trialDays`/`expiresAt` default to a valid, far-future code.
 */
export async function seedInviteCode(
  code = `INV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  opts: { trialDays?: number; expiresAt?: Date } = {},
): Promise<string> {
  const { inviteCodes } = await import("@cascade/database");
  await db.insert(inviteCodes).values({
    code,
    isEdu: false,
    trialDays: opts.trialDays ?? 14,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  });
  return code;
}
