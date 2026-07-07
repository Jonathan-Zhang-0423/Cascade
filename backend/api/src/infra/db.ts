import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@cascade/database";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
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

export function isTransientDbError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && "cause" in err ? String((err as Error & { cause?: unknown }).cause) : "";
  const text = `${message} ${cause}`.toLowerCase();
  return (
    text.includes("connection terminated") ||
    text.includes("connection timeout") ||
    text.includes("connection reset") ||
    text.includes("terminating connection") ||
    text.includes("timeout exceeded") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("57p01") ||
    text.includes("08006") ||
    text.includes("08003")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDbRetry<T>(
  label: string,
  fn: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 250;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || attempt >= attempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(
        `[db] transient failure during ${label}; retrying ${attempt}/${attempts - 1} in ${delay}ms:`,
        err instanceof Error ? err.message : err,
      );
      await sleep(delay);
    }
  }

  throw lastErr;
}
