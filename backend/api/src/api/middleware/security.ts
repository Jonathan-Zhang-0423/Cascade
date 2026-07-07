import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { eq, gt, lt } from "drizzle-orm";
import { db } from "../../infra/db";
import { ipBans } from "@cascade/database";

/**
 * Security middleware factory — encapsulates the IP blocklist, per-account
 * login lockout, and rate limiters.
 *
 * Call createSecurity(app) ONCE during route registration: it mounts the
 * IP-block middleware + the /api/auth rate limiters (split into a benign tier
 * for session-probe endpoints that never feeds the ban counter, and a strict
 * throttle tier for brute-force-prone writes), exposes admin controls on app
 * locals (_ipBlocklist / _banIp / _unbanIp / _accountLockout /
 * _clearAccountLockout / _resetRateLimiters), and returns the helpers route
 * handlers need.
 *
 * Ban philosophy (post-redesign):
 *   • A 429 from any rate limiter is a PURE throttle — it slows the caller down
 *     but never feeds the ban counter. Refreshes / impatient OTP resend clicks
 *     can no longer get an IP banned.
 *   • Single-account brute-force is handled by per-account lockout
 *     (recordLoginFail, 5 fails / 15 min) and per-target OTP lockout — both
 *     account-scoped, so they cannot collateral-ban CGNAT neighbors.
 *   • The ONLY automatic IP ban is the cross-account detector
 *     (recordAuthFailure): an IP that fails auth against ≥ N distinct targets
 *     within a window is banned. This is the CGNAT-safe signal — a single user
 *     mistyping their own credentials hits one target and never triggers it.
 *   • Bans are scoped to sensitive /api/auth write paths only (a banned IP can
 *     still read the site), last 15 min, and are persisted to the ip_bans table
 *     so they survive restarts and show up in the admin UI.
 */

// IPs that are never auto-blocked (owner / admin access).
const IP_WHITELIST = new Set(["36.142.94.105", "127.0.0.1", "::1"]);

const MAX_FAIL = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// ── IP ban configuration ────────────────────────────────────────────────────
const BAN_MS = 15 * 60 * 1000; // 15 min (was 1h — disproportionate for a refresh)
const CROSS_ACCOUNT_THRESHOLD = 5; // distinct failed targets in window → ban
const CROSS_ACCOUNT_WINDOW = 10 * 60 * 1000; // 10 min

// Benign, high-frequency auth endpoints the SPA fires on every navigation.
// Generous limit, NEVER feeds the ban counter, and exempt from IP blocks.
const BENIGN_AUTH_PATHS = new Set([
  "/api/auth/me",                    // session probe — fired on every refresh
  "/api/auth/logout",                // session teardown
  "/api/auth/me/username-cooldown",  // read-only cooldown check
]);

export interface Security {
  /** Resolve the caller IP (honors x-forwarded-for). */
  getClientIp: (req: any) => string;
  /** True if the IP is currently blocked. */
  isIpBlocked: (ip: string) => boolean;
  /** Record a failed auth attempt against `target`; auto-bans on cross-account spray. */
  recordAuthFailure: (ip: string, target: string) => void;
  /** Account lockout controls (login brute-force protection). */
  recordLoginFail: (userId: string) => void;
  isAccountLocked: (userId: string) => boolean;
  clearAccountLockout: (userId: string) => void;
  /** Read lockout state for a user (for building 403 responses). */
  getLockout: (userId: string) => { failCount: number; lockedUntil: number | null } | undefined;
  readonly MAX_FAIL: number;
}

export function createSecurity(app: Express): Security {
  // ── IP blocklist (in-memory hot path, mirrored to ip_bans) ────────────────
  const ipBlocklist = new Map<string, { blockedUntil: number; reason: string; blockedAt: number }>();

  // Per-IP distinct failed-target tracker for cross-account detection.
  const ipFailTargets = new Map<string, { targets: Map<string, number>; windowStart: number }>();

  function getClientIp(req: any): string {
    return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  }

  function isIpBlocked(ip: string): boolean {
    const entry = ipBlocklist.get(ip);
    if (!entry) return false;
    if (entry.blockedUntil > Date.now()) return true;
    ipBlocklist.delete(ip);
    return false;
  }

  /** Ban an IP in memory (immediate) and mirror to ip_bans (fire-and-forget). */
  function banIp(ip: string, reason: string, durationMs = BAN_MS, bannedBy = "auto") {
    if (IP_WHITELIST.has(ip)) return;
    const now = Date.now();
    const until = now + durationMs;
    ipBlocklist.set(ip, { blockedUntil: until, reason, blockedAt: now });
    db.insert(ipBans)
      .values({ ip, reason, blockedUntil: new Date(until), bannedBy })
      .onConflictDoUpdate({
        target: ipBans.ip,
        set: { reason, blockedUntil: new Date(until), bannedBy, blockedAt: new Date(now) },
      })
      .catch((e) => console.error("[security] persist ip ban", e));
  }

  function unbanIp(ip: string) {
    ipBlocklist.delete(ip);
    db.delete(ipBans).where(eq(ipBans.ip, ip)).catch((e) => console.error("[security] delete ip ban", e));
  }

  /**
   * Record a failed auth attempt against `target` from `ip`. If an IP fails
   * against ≥ CROSS_ACCOUNT_THRESHOLD distinct targets within the window, it is
   * banned (credential stuffing / OTP spray). Single-target repetition never
   * bans — that's the per-account / per-target lockout's job.
   */
  function recordAuthFailure(ip: string, target: string) {
    if (IP_WHITELIST.has(ip) || !target) return;
    const now = Date.now();
    let entry = ipFailTargets.get(ip);
    if (!entry || now - entry.windowStart > CROSS_ACCOUNT_WINDOW) {
      entry = { targets: new Map(), windowStart: now };
      ipFailTargets.set(ip, entry);
    }
    entry.targets.set(target, (entry.targets.get(target) ?? 0) + 1);
    if (entry.targets.size >= CROSS_ACCOUNT_THRESHOLD) {
      banIp(ip, "Auto: cross-account brute-force", BAN_MS, "auto");
      ipFailTargets.delete(ip);
    }
  }

  // Expose blocklist controls on app locals for admin routes.
  (app as any)._ipBlocklist = ipBlocklist;
  (app as any)._banIp = banIp;
  (app as any)._unbanIp = unbanIp;

  // Boot: load active bans from the DB into memory + prune expired rows.
  (async () => {
    try {
      const now = new Date();
      const rows = await db.select().from(ipBans).where(gt(ipBans.blockedUntil, now));
      const t = Date.now();
      for (const r of rows) {
        const until = r.blockedUntil instanceof Date ? r.blockedUntil.getTime() : t;
        if (until <= t) continue;
        const blockedAt = r.blockedAt instanceof Date ? r.blockedAt.getTime() : t;
        ipBlocklist.set(r.ip, { blockedUntil: until, reason: r.reason ?? "banned", blockedAt });
      }
      // Prune rows that have already expired.
      db.delete(ipBans).where(lt(ipBans.blockedUntil, now)).catch(() => {});
    } catch (e) {
      console.error("[security] load ip_bans on boot", e);
    }
  })();

  // Middleware: reject blocked IPs ONLY on sensitive /api/auth write paths.
  // Benign session probes and the rest of the site stay accessible, so a ban
  // blocks new auth attempts without locking the user out of reading the app.
  const pathOf = (req: any) => (req.originalUrl || "").split("?")[0];
  const isSensitiveAuthPath = (req: any) => {
    const p = pathOf(req);
    return p.startsWith("/api/auth") && !BENIGN_AUTH_PATHS.has(p);
  };
  app.use((req: any, res: any, next: any) => {
    const ip = getClientIp(req);
    if (IP_WHITELIST.has(ip)) { next(); return; }
    if (isSensitiveAuthPath(req) && isIpBlocked(ip)) {
      return res.status(403).json({ error: "Your IP has been blocked. Contact support." });
    }
    next();
  });

  // ── Account lockout (in-memory) ───────────────────────────────────────────
  const accountLockout = new Map<string, { failCount: number; lockedUntil: number | null; lockedAt: number | null }>();

  function recordLoginFail(userId: string) {
    const entry = accountLockout.get(userId) ?? { failCount: 0, lockedUntil: null, lockedAt: null };
    entry.failCount++;
    if (entry.failCount >= MAX_FAIL) {
      entry.lockedUntil = Date.now() + LOCKOUT_MS;
      entry.lockedAt = Date.now();
    }
    accountLockout.set(userId, entry);
  }

  function isAccountLocked(userId: string): boolean {
    const entry = accountLockout.get(userId);
    if (!entry || !entry.lockedUntil) return false;
    if (entry.lockedUntil > Date.now()) return true;
    accountLockout.delete(userId); // auto-unlock
    return false;
  }

  function clearAccountLockout(userId: string) {
    accountLockout.delete(userId);
  }

  function getLockout(userId: string) {
    return accountLockout.get(userId);
  }

  (app as any)._accountLockout = accountLockout;
  (app as any)._clearAccountLockout = clearAccountLockout;

  // ── Rate limiters ─────────────────────────────────────────────────────────
  //
  // Two tiers, kept deliberately separate so that normal page refreshes can
  // never trigger an IP ban:
  //
  //   • Benign  — high-frequency, read-only/session-probe endpoints the SPA
  //     fires on every navigation (GET /api/auth/me, logout, username-cooldown).
  //     Generous limit, and it NEVER feeds the ban counter.
  //
  //   • Sensitive — brute-force-prone writes (login, OTP send/verify, password
  //     set/reset, bind/unbind, OAuth exchange, profile/username/avatar edits).
  //     Stricter limit. NOTE: a 429 here is a pure throttle — it does NOT feed
  //     the ban counter. IP banning is handled solely by the cross-account
  //     detector (recordAuthFailure) hooked into the auth-failure paths.
  //
  // The two sets are disjoint by path. Benign paths are also `skip`ped by the
  // sensitive limiter so a single request is never double-counted.
  const isBenignPath = (req: any) => BENIGN_AUTH_PATHS.has(pathOf(req));

  function makeRateLimiter(
    max: number,
    windowMinutes: number,
    message: string,
    skip?: (req: any) => boolean,
  ) {
    return rateLimit({
      windowMs: windowMinutes * 60 * 1000,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: any) => getClientIp(req),
      message: { error: message },
      // No handler override: a 429 is a pure throttle. It must NOT call any
      // ban/strike logic — that was the root cause of mass false bans.
      skip: skip ?? (() => false),
    });
  }

  // Benign tier: generous, NO strike recording (cannot brute-force anything).
  const benignAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => getClientIp(req),
    message: { error: "Too many requests. Please slow down." },
  });

  // Sensitive tier: strict, pure throttle. Skips benign paths so refreshes
  // never count toward the limit either.
  const authLimiter = makeRateLimiter(
    30, 15, "Too many requests. Please try again later.",
    isBenignPath,
  );
  const loginLimiter = makeRateLimiter(10, 15, "Too many login attempts. Please wait 15 minutes.");
  const otpSendLimiter = makeRateLimiter(10, 60, "Too many code requests. Please wait before trying again.");

  // Dispatch by exact path: benign paths → benign limiter, everything else
  // under /api/auth → sensitive limiter. (loginLimiter / otpSendLimiter stack
  // on top for those specific endpoints, unchanged from before.)
  app.use("/api/auth", (req: any, res: any, next: any) => {
    if (isBenignPath(req)) return benignAuthLimiter(req, res, next);
    return authLimiter(req, res, next);
  });
  app.use("/api/auth/login", loginLimiter);
  app.use("/api/auth/otp/send", otpSendLimiter);

  // Test-only seam: reset the in-memory rate-limiter windows so serialized
  // integration tests don't accumulate throttles across cases.
  (app as any)._resetRateLimiters = () => {
    for (const lim of [benignAuthLimiter, authLimiter, loginLimiter, otpSendLimiter]) {
      try { (lim as any).resetKey?.("::ffff:127.0.0.1"); (lim as any).resetKey?.("127.0.0.1"); } catch {}
      try { (lim as any).store?.resetAll?.(); } catch {}
    }
  };

  return {
    getClientIp,
    isIpBlocked,
    recordAuthFailure,
    recordLoginFail,
    isAccountLocked,
    clearAccountLockout,
    getLockout,
    MAX_FAIL,
  };
}
