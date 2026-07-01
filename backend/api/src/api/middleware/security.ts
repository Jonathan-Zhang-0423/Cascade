import type { Express } from "express";
import rateLimit from "express-rate-limit";

/**
 * Security middleware factory — encapsulates the in-memory IP blocklist,
 * per-account login lockout, and rate limiters that were previously inline
 * closures inside registerRoutes. Behavior is unchanged; this just gives the
 * shared state a single cohesive home so route modules can be split out.
 *
 * Call createSecurity(app) ONCE during route registration: it mounts the
 * IP-block middleware + the /api/auth rate limiters, exposes admin controls on
 * app locals (_ipBlocklist / _accountLockout / _clearAccountLockout /
 * _resetRateLimiters — same as before), and returns the helpers route handlers
 * need.
 */

// IPs that are never auto-blocked (owner / admin access).
const IP_WHITELIST = new Set(["36.142.94.105", "113.87.160.120", "106.120.98.170", "127.0.0.1", "::1"]);

const MAX_FAIL = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export interface Security {
  /** Resolve the caller IP (honors x-forwarded-for). */
  getClientIp: (req: any) => string;
  /** True if the IP is currently blocked. */
  isIpBlocked: (ip: string) => boolean;
  /** Record a rate-limit strike; auto-blocks after 3 within the window. */
  recordIpStrike: (ip: string) => void;
  /** Build a per-IP rate limiter (records a strike on limit). */
  makeRateLimiter: (max: number, windowMinutes: number, message: string) => ReturnType<typeof rateLimit>;
  /** Account lockout controls (login brute-force protection). */
  recordLoginFail: (userId: string) => void;
  isAccountLocked: (userId: string) => boolean;
  clearAccountLockout: (userId: string) => void;
  /** Read lockout state for a user (for building 403 responses). */
  getLockout: (userId: string) => { failCount: number; lockedUntil: number | null } | undefined;
  readonly MAX_FAIL: number;
}

export function createSecurity(app: Express): Security {
  // ── IP blocklist (in-memory) ──────────────────────────────────────────────
  const ipBlocklist = new Map<string, { blockedUntil: number; reason: string; blockedAt: number }>();
  const ipStrikeCount = new Map<string, { count: number; windowStart: number }>();

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

  function recordIpStrike(ip: string) {
    if (IP_WHITELIST.has(ip)) return; // 白名单 IP 不计 strike
    const now = Date.now();
    const WINDOW = 10 * 60 * 1000; // 10 min window
    const entry = ipStrikeCount.get(ip) ?? { count: 0, windowStart: now };
    if (now - entry.windowStart > WINDOW) {
      entry.count = 1; entry.windowStart = now;
    } else {
      entry.count++;
    }
    ipStrikeCount.set(ip, entry);
    if (entry.count >= 3) {
      ipBlocklist.set(ip, { blockedUntil: now + 60 * 60 * 1000, reason: "Auto: 3x rate-limit violations", blockedAt: now });
      ipStrikeCount.delete(ip);
    }
  }

  // Expose blocklist controls on app locals for admin routes.
  (app as any)._ipBlocklist = ipBlocklist;

  // Middleware: reject blocked IPs (whitelist always passes).
  app.use((req: any, res: any, next: any) => {
    const ip = getClientIp(req);
    if (IP_WHITELIST.has(ip)) { next(); return; }
    if (isIpBlocked(ip)) {
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
  function makeRateLimiter(max: number, windowMinutes: number, message: string) {
    return rateLimit({
      windowMs: windowMinutes * 60 * 1000,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: any) => getClientIp(req),
      message: { error: message },
      handler: (req: any, res: any, _next: any, options: any) => {
        recordIpStrike(getClientIp(req));
        res.status(options.statusCode).json(options.message);
      },
      skip: () => false,
    });
  }

  // 只对敏感认证操作限速，/api/auth/me 等轮询接口不受限
  const loginLimiter = makeRateLimiter(10, 15, "Too many login attempts. Please wait 15 minutes.");
  const registerLimiter = makeRateLimiter(5, 60, "Too many registration attempts. Please wait before trying again.");
  const otpSendLimiter = makeRateLimiter(10, 60, "Too many code requests. Please wait before trying again.");
  const otpVerifyLoginLimiter = makeRateLimiter(10, 15, "Too many attempts. Please wait 15 minutes.");
  const githubLimiter = makeRateLimiter(10, 15, "Too many requests. Please try again later.");
  const wechatLimiter = makeRateLimiter(10, 15, "Too many requests. Please try again later.");
  const resetPasswordLimiter = makeRateLimiter(5, 60, "Too many attempts. Please wait before trying again.");
  app.use("/api/auth/login", loginLimiter);
  app.use("/api/auth/register", registerLimiter);
  app.use("/api/auth/otp/send", otpSendLimiter);
  app.use("/api/auth/otp/verify-login", otpVerifyLoginLimiter);
  app.use("/api/auth/github", githubLimiter);
  app.use("/api/auth/wechat", wechatLimiter);
  app.use("/api/auth/reset-password", resetPasswordLimiter);

  const allLimiters = [
    loginLimiter, registerLimiter, otpSendLimiter, otpVerifyLoginLimiter,
    githubLimiter, wechatLimiter, resetPasswordLimiter,
  ];

  // Test-only seam: reset the in-memory rate-limiter windows so serialized
  // integration tests don't accumulate strikes across cases.
  (app as any)._resetRateLimiters = () => {
    for (const lim of allLimiters) {
      try { (lim as any).resetKey?.("::ffff:127.0.0.1"); (lim as any).resetKey?.("127.0.0.1"); } catch {}
      try { (lim as any).store?.resetAll?.(); } catch {}
    }
  };

  return {
    getClientIp,
    isIpBlocked,
    recordIpStrike,
    makeRateLimiter,
    recordLoginFail,
    isAccountLocked,
    clearAccountLockout,
    getLockout,
    MAX_FAIL,
  };
}
