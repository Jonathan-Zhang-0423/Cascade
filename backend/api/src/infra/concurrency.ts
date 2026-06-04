/**
 * Concurrency control for AI provider calls and session management.
 * Prevents API key exhaustion under load (100+ concurrent users).
 *
 * Three layers:
 * 1. Global semaphore — caps total in-flight AI API calls
 * 2. Per-user session limit — prevents one user from hogging all slots
 * 3. Graceful queue — excess requests wait with timeout, not instant 503
 */

// ─── Semaphore ─────────────────────────────────────────────────────────────

export class Semaphore {
  private current = 0;
  private queue: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> | null }> = [];

  constructor(private readonly max: number) {}

  get available(): number { return this.max - this.current; }
  get pending(): number { return this.queue.length; }
  get running(): number { return this.current; }

  async acquire(timeoutMs = 60_000): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        resolve: () => {
          this.current++;
          resolve();
        },
        timer: null as ReturnType<typeof setTimeout> | null,
      };
      entry.timer = setTimeout(() => {
        const idx = this.queue.indexOf(entry);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error(`Semaphore timeout: waited ${timeoutMs}ms, ${this.queue.length} still queued`));
      }, timeoutMs);
      this.queue.push(entry);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (next.timer) clearTimeout(next.timer);
      next.resolve();
    } else {
      this.current = Math.max(0, this.current - 1);
    }
  }

  /**
   * Run a function with automatic acquire/release.
   */
  async run<T>(fn: () => Promise<T>, timeoutMs = 60_000): Promise<T> {
    await this.acquire(timeoutMs);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// ─── Per-user session tracker ──────────────────────────────────────────────

export class UserSessionTracker {
  private sessions = new Map<string, Set<string>>(); // userId -> sessionIds

  constructor(private readonly maxPerUser: number) {}

  /**
   * Try to register a new session for a user.
   * Returns false if user already at limit.
   */
  register(userId: string, sessionId: string): boolean {
    if (!userId) return true; // anonymous — no per-user limit
    let userSessions = this.sessions.get(userId);
    if (!userSessions) {
      userSessions = new Set();
      this.sessions.set(userId, userSessions);
    }
    // Already registered (idempotent)
    if (userSessions.has(sessionId)) return true;
    if (userSessions.size >= this.maxPerUser) return false;
    userSessions.add(sessionId);
    return true;
  }

  unregister(userId: string, sessionId: string): void {
    const userSessions = this.sessions.get(userId);
    if (!userSessions) return;
    userSessions.delete(sessionId);
    if (userSessions.size === 0) this.sessions.delete(userId);
  }

  count(userId: string): number {
    return this.sessions.get(userId)?.size ?? 0;
  }

  totalSessions(): number {
    let total = 0;
    for (const s of this.sessions.values()) total += s.size;
    return total;
  }
}

// ─── Singleton instances ───────────────────────────────────────────────────

/**
 * Global AI call concurrency. With typical provider rate limits:
 * - Doubao: ~50 RPM on standard tier
 * - DeepSeek: ~60 RPM
 * - Kimi: ~30 RPM
 *
 * Setting to 20 concurrent in-flight calls prevents bursting past limits
 * while still allowing good throughput for 100 users (most are waiting on
 * frontend input, not actively streaming).
 */
const MAX_CONCURRENT_AI_CALLS = parseInt(process.env.MAX_CONCURRENT_AI_CALLS || "20", 10);

/**
 * Per-user active session limit. Prevents one user from consuming
 * disproportionate resources. A user with 3 active builds/managers is
 * already unusual.
 */
const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || "5", 10);

/**
 * Max time a request will wait in queue before getting a 503.
 */
const QUEUE_TIMEOUT_MS = parseInt(process.env.QUEUE_TIMEOUT_MS || "60000", 10);

export const aiSemaphore = new Semaphore(MAX_CONCURRENT_AI_CALLS);
export const userSessions = new UserSessionTracker(MAX_SESSIONS_PER_USER);
export const CONCURRENCY_QUEUE_TIMEOUT = QUEUE_TIMEOUT_MS;

// ─── Health / metrics endpoint helper ──────────────────────────────────────

export function getConcurrencyMetrics() {
  return {
    aiCalls: {
      running: aiSemaphore.running,
      pending: aiSemaphore.pending,
      available: aiSemaphore.available,
    },
    userSessions: {
      totalActive: userSessions.totalSessions(),
    },
    limits: {
      maxConcurrentAiCalls: MAX_CONCURRENT_AI_CALLS,
      maxSessionsPerUser: MAX_SESSIONS_PER_USER,
      queueTimeoutMs: QUEUE_TIMEOUT_MS,
    },
  };
}
