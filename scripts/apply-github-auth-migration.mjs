// One-shot migration for the GitHub OAuth feature.
// Run with: cd Cascade && node --env-file=.env scripts/apply-github-auth-migration.mjs
import pg from "pg";

const { Client } = pg;

const sql = `
  ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id text;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_unique') THEN
      ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_github_id_unique') THEN
      ALTER TABLE users ADD CONSTRAINT users_github_id_unique UNIQUE (github_id);
    END IF;
  END $$;
`;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(sql);
  const { rows } = await client.query(`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_name = 'users'
    ORDER BY ordinal_position
  `);
  console.log("Migration applied. users table now:");
  for (const r of rows) {
    console.log(`  - ${r.column_name} (${r.data_type}${r.is_nullable === "YES" ? ", nullable" : ""})`);
  }
} finally {
  await client.end();
}
