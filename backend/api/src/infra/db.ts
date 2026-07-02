import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@cascade/database";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Prevent ECONNRESET on idle connections: close connections that have been
  // idle for 30s (Postgres default tcp_keepalives_idle is 2h, too long).
  idleTimeoutMillis: 30_000,
  // Allow generous time for initial connection (Docker container may be waking)
  connectionTimeoutMillis: 30_000,
  // Cap pool size to avoid exhausting Postgres max_connections
  max: 20,
});

// Handle pool-level errors gracefully (e.g. connection reset) instead of
// crashing the process with an unhandled error event.
pool.on("error", (err) => {
  console.warn("[pg-pool] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });
