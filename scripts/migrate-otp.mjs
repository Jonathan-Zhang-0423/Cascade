// One-shot migration script for the OTP feature.
// Idempotent: uses IF NOT EXISTS / DO blocks so it's safe to re-run.
// Run with: node --env-file=.env scripts/migrate-otp.mjs

import pg from "pg";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

const stmts = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false`,
  // Unique constraint on phone (Postgres treats multiple NULLs as distinct by default,
  // so existing rows with NULL phone are fine.)
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_unique') THEN
       ALTER TABLE users ADD CONSTRAINT users_phone_unique UNIQUE (phone);
     END IF;
   END $$`,
  `CREATE TABLE IF NOT EXISTS otp_codes (
     id serial PRIMARY KEY,
     channel text NOT NULL,
     target text NOT NULL,
     code_hash text NOT NULL,
     purpose text NOT NULL,
     expires_at timestamp NOT NULL,
     attempts integer NOT NULL DEFAULT 0,
     consumed_at timestamp,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS otp_codes_target_purpose_created_idx
     ON otp_codes (target, purpose, created_at)`,
];

for (const sql of stmts) {
  console.log("→", sql.replace(/\s+/g, " ").slice(0, 80) + "…");
  await client.query(sql);
}

console.log("✓ OTP migration applied");
await client.end();
