import type { Request, Response, NextFunction } from "express";
import { storage } from "../../infra/storage";
import { verifyCaptcha } from "../../infra/captcha";

/**
 * Auth middleware extracted from registerRoutes (Step B of the routes split).
 * Pure dependency-light functions: requireInviteCode reads storage; checkCaptcha
 * reads the captcha verifier + caller IP; checkAdmin reads a header secret.
 * Behavior is unchanged.
 */

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

/**
 * Gate that requires an authenticated user who has redeemed an invite code.
 * Phone-verified users are exempt (they register without a code). Mounted on
 * /api/projects, /api/manager-chat, /api/build-session.
 */
export async function requireInviteCode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
    const user = await storage.getUser(userId);
    if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
    // 手机号注册用户（phone_verified=true）直接放行，无需邀请码
    if ((user as any).phoneVerified) { next(); return; }
    if (!(user as any).inviteCode) {
      res.status(403).json({ error: "Invite code required" });
      return;
    }
    next();
  } catch (err) {
    console.error("[requireInviteCode]", err);
    res.status(500).json({ error: "Authorization check failed" });
  }
}

/**
 * Verify a TCaptcha ticket. Returns true (and does nothing) on success; on
 * failure writes a 403 and returns false so callers can early-return. Degrades
 * open when captcha isn't configured (verifyCaptcha returns true).
 */
export async function checkCaptcha(req: Request, res: Response): Promise<boolean> {
  const { ticket, randstr } = req.body as { ticket?: string; randstr?: string };
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
  const ok = await verifyCaptcha(ticket ?? "", randstr ?? "", ip);
  if (!ok) res.status(403).json({ error: "Captcha verification failed" });
  return ok;
}

/**
 * Admin guard via the x-admin-secret header. Returns false (and writes the
 * error response) when not configured or the secret doesn't match.
 */
export function checkAdmin(req: Request, res: Response): boolean {
  if ((req as any).adminUser) {
    return true;
  }
  if (!ADMIN_SECRET) {
    res.status(503).json({ error: "Admin access not configured" });
    return false;
  }
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
