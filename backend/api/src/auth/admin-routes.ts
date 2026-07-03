import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../infra/db.js";
import { adminUsers, adminAuditLog } from "@cascade/database";
import {
  signAccessToken,
  signRefreshToken,
  signTempToken,
  verifyToken,
  blacklistToken,
  setAccessTokenCookie,
  setRefreshTokenCookie,
  clearAdminCookies,
  adminAuthMiddleware,
} from "./admin-auth.js";
import {
  generateTotpSecret,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
} from "./admin-totp.js";
import rateLimit from "express-rate-limit";
import type { Express, Request, Response } from "express";

// ── Helpers ───────────────────────────────────────────────────────────────────
function getClientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
}

async function auditLog(params: {
  adminUserId: string;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, any>;
  req: Request;
}): Promise<void> {
  try {
    await db.insert(adminAuditLog).values({
      adminUserId: params.adminUserId,
      action: params.action,
      resource: params.resource ?? null,
      resourceId: params.resourceId ?? null,
      details: params.details ?? null,
      ipAddress: getClientIp(params.req),
      userAgent: params.req.headers["user-agent"] ?? null,
    });
  } catch (err) {
    console.error("[admin-audit]", err);
  }
}

// ── Rate Limiter ──────────────────────────────────────────────────────────────
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => getClientIp(req),
  message: { error: "登录尝试次数过多，请 15 分钟后再试" },
});

// ── Route Registration ────────────────────────────────────────────────────────
export function registerAdminAuthRoutes(app: Express): void {
  const router = Router();

  // Apply admin auth middleware to all admin-protected routes
  app.use("/api/admin", adminAuthMiddleware);
  app.use("/api/waitlist", adminAuthMiddleware);

  // Rate limit login attempts
  router.use("/login", adminLoginLimiter);

  // ─── POST /api/admin/auth/login ─────────────────────────────────────────────
  // Step 1: Validate username + password → return tempToken
  router.post("/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username?.trim() || !password) {
        return res.status(400).json({ error: "用户名和密码不能为空" });
      }

      const [adminUser] = await db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.username, username.trim()));

      if (!adminUser || !adminUser.isActive) {
        return res.status(401).json({ error: "用户名或密码错误" });
      }

      // Check account lockout
      if (adminUser.lockedUntil && adminUser.lockedUntil > new Date()) {
        const remainSec = Math.ceil((adminUser.lockedUntil.getTime() - Date.now()) / 1000);
        await auditLog({ adminUserId: adminUser.id, action: "login_blocked", req });
        return res.status(403).json({
          error: `账户已锁定，请 ${Math.ceil(remainSec / 60)} 分钟后再试`,
          lockedUntil: adminUser.lockedUntil.toISOString(),
        });
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(password, adminUser.passwordHash);
      if (!passwordMatch) {
        const newAttempts = adminUser.failedAttempts + 1;
        const lockUpdate: any = { failedAttempts: newAttempts, updatedAt: new Date() };
        if (newAttempts >= 5) {
          lockUpdate.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 min lockout
        }
        await db.update(adminUsers).set(lockUpdate).where(eq(adminUsers.id, adminUser.id));
        await auditLog({
          adminUserId: adminUser.id,
          action: "login_failed",
          details: { attempts: newAttempts },
          req,
        });
        return res.status(401).json({ error: "用户名或密码错误" });
      }

      // Password correct — clear failed attempts
      await db.update(adminUsers).set({
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      }).where(eq(adminUsers.id, adminUser.id));

      // If TOTP is not enabled, skip verification step (first-time setup)
      if (!adminUser.totpEnabled) {
        // Issue full tokens directly — user will be redirected to TOTP setup
        const tokenPayload = { sub: adminUser.id, username: adminUser.username, role: adminUser.role };
        const accessToken = signAccessToken(tokenPayload);
        const refreshToken = signRefreshToken(tokenPayload);
        setAccessTokenCookie(res, accessToken);
        setRefreshTokenCookie(res, refreshToken);

        await db.update(adminUsers).set({
          lastLoginAt: new Date(),
          lastLoginIp: getClientIp(req),
        }).where(eq(adminUsers.id, adminUser.id));

        await auditLog({ adminUserId: adminUser.id, action: "login_success_no_totp", req });

        return res.json({
          success: true,
          requireTotp: false,
          totpEnabled: false,
          user: { username: adminUser.username, role: adminUser.role },
        });
      }

      // TOTP enabled — issue temp token for verification step
      const tempPayload = { sub: adminUser.id, username: adminUser.username, role: adminUser.role };
      const tempToken = signTempToken(tempPayload);

      return res.json({
        success: true,
        requireTotp: true,
        totpEnabled: true,
        tempToken,
      });
    } catch (err) {
      console.error("[admin/auth/login]", err);
      return res.status(500).json({ error: "服务器内部错误" });
    }
  });

  // ─── POST /api/admin/auth/verify ────────────────────────────────────────────
  // Step 2: Validate tempToken + TOTP code → issue JWT cookies
  router.post("/verify", async (req: Request, res: Response) => {
    try {
      const { tempToken, code } = req.body as { tempToken?: string; code?: string };
      if (!tempToken || !code?.trim()) {
        return res.status(400).json({ error: "缺少验证信息" });
      }

      // Verify temp token
      const payload = verifyToken(tempToken, "temp");
      if (!payload) {
        return res.status(401).json({ error: "验证令牌已过期，请重新登录" });
      }

      // Get admin user
      const [adminUser] = await db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.id, payload.sub));

      if (!adminUser || !adminUser.isActive || !adminUser.totpSecret) {
        return res.status(401).json({ error: "验证失败" });
      }

      // Try TOTP code first, then backup code
      const trimmedCode = code.trim();
      let isValid = false;

      if (/^\d{6}$/.test(trimmedCode)) {
        // 6-digit TOTP code
        isValid = verifyTotpCode(adminUser.totpSecret, trimmedCode);
      }

      if (!isValid && adminUser.backupCodes) {
        // Try backup code
        const result = await verifyBackupCode(trimmedCode, adminUser.backupCodes);
        if (result.valid) {
          isValid = true;
          await db.update(adminUsers).set({
            backupCodes: result.updatedJson,
            updatedAt: new Date(),
          }).where(eq(adminUsers.id, adminUser.id));
        }
      }

      if (!isValid) {
        await auditLog({
          adminUserId: adminUser.id,
          action: "totp_verify_failed",
          req,
        });
        return res.status(401).json({ error: "验证码错误" });
      }

      // Success — issue full tokens
      const tokenPayload = { sub: adminUser.id, username: adminUser.username, role: adminUser.role };
      const accessToken = signAccessToken(tokenPayload);
      const refreshToken = signRefreshToken(tokenPayload);
      setAccessTokenCookie(res, accessToken);
      setRefreshTokenCookie(res, refreshToken);

      // Blacklist the temp token so it can't be reused
      blacklistToken(payload.jti);

      await db.update(adminUsers).set({
        lastLoginAt: new Date(),
        lastLoginIp: getClientIp(req),
      }).where(eq(adminUsers.id, adminUser.id));

      await auditLog({ adminUserId: adminUser.id, action: "login_success", req });

      return res.json({
        success: true,
        user: { username: adminUser.username, role: adminUser.role },
      });
    } catch (err) {
      console.error("[admin/auth/verify]", err);
      return res.status(500).json({ error: "服务器内部错误" });
    }
  });

  // ─── POST /api/admin/auth/refresh ───────────────────────────────────────────
  router.post("/refresh", async (req: Request, res: Response) => {
    try {
      const refreshToken = req.cookies?.admin_refresh;
      if (!refreshToken) {
        return res.status(401).json({ error: "未登录" });
      }

      const payload = verifyToken(refreshToken, "refresh");
      if (!payload) {
        clearAdminCookies(res);
        return res.status(401).json({ error: "登录已过期，请重新登录" });
      }

      // Verify user still exists and is active
      const [adminUser] = await db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.id, payload.sub));

      if (!adminUser || !adminUser.isActive) {
        clearAdminCookies(res);
        return res.status(401).json({ error: "账户已停用" });
      }

      // Issue new access token
      const tokenPayload = { sub: adminUser.id, username: adminUser.username, role: adminUser.role };
      const newAccessToken = signAccessToken(tokenPayload);
      setAccessTokenCookie(res, newAccessToken);

      return res.json({ success: true });
    } catch (err) {
      console.error("[admin/auth/refresh]", err);
      return res.status(500).json({ error: "服务器内部错误" });
    }
  });

  // ─── POST /api/admin/auth/logout ────────────────────────────────────────────
  router.post("/logout", async (req: Request, res: Response) => {
    try {
      // Blacklist the current access token if present
      if (req.adminUser) {
        blacklistToken(req.adminUser.jti);
        await auditLog({ adminUserId: req.adminUser.sub, action: "logout", req });
      }
      clearAdminCookies(res);
      return res.json({ success: true });
    } catch (err) {
      console.error("[admin/auth/logout]", err);
      return res.status(500).json({ error: "服务器内部错误" });
    }
  });

  // ─── GET /api/admin/auth/me ─────────────────────────────────────────────────
  router.get("/me", async (req: Request, res: Response) => {
    if (!req.adminUser) {
      return res.status(401).json({ error: "未登录" });
    }

    const [adminUser] = await db
      .select({
        id: adminUsers.id,
        username: adminUsers.username,
        role: adminUsers.role,
        totpEnabled: adminUsers.totpEnabled,
        lastLoginAt: adminUsers.lastLoginAt,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, req.adminUser.sub));

    if (!adminUser) {
      clearAdminCookies(res);
      return res.status(401).json({ error: "账户不存在" });
    }

    return res.json({ user: adminUser });
  });

  // ─── POST /api/admin/auth/setup-totp ────────────────────────────────────────
  // Requires valid access token (already logged in without TOTP for initial setup)
  router.post("/setup-totp", async (req: Request, res: Response) => {
    if (!req.adminUser) {
      return res.status(401).json({ error: "未登录" });
    }

    try {
      const [adminUser] = await db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.id, req.adminUser.sub));

      if (!adminUser) {
        return res.status(404).json({ error: "账户不存在" });
      }

      if (adminUser.totpEnabled) {
        return res.status(400).json({ error: "TOTP 已启用，如需重置请联系超级管理员" });
      }

      // Generate TOTP secret and backup codes
      const { secret, encryptedSecret, uri } = generateTotpSecret(adminUser.username);
      const backupCodes = generateBackupCodes();
      const hashedBackupCodes = await hashBackupCodes(backupCodes);

      // Save encrypted secret and backup codes (but don't enable yet)
      await db.update(adminUsers).set({
        totpSecret: encryptedSecret,
        backupCodes: hashedBackupCodes,
        updatedAt: new Date(),
      }).where(eq(adminUsers.id, adminUser.id));

      await auditLog({ adminUserId: adminUser.id, action: "totp_setup_initiated", req });

      return res.json({
        secret,      // Show once for manual entry
        uri,         // For QR code rendering
        backupCodes, // Show once — user must save them
      });
    } catch (err) {
      console.error("[admin/auth/setup-totp]", err);
      return res.status(500).json({ error: "服务器内部错误" });
    }
  });

  // ─── POST /api/admin/auth/confirm-totp ──────────────────────────────────────
  // Verify the first TOTP code to confirm binding
  router.post("/confirm-totp", async (req: Request, res: Response) => {
    if (!req.adminUser) {
      return res.status(401).json({ error: "未登录" });
    }

    try {
      const { code } = req.body as { code?: string };
      if (!code?.trim() || !/^\d{6}$/.test(code.trim())) {
        return res.status(400).json({ error: "请输入 6 位验证码" });
      }

      const [adminUser] = await db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.id, req.adminUser.sub));

      if (!adminUser || !adminUser.totpSecret) {
        return res.status(400).json({ error: "请先生成 TOTP 密钥" });
      }

      if (adminUser.totpEnabled) {
        return res.status(400).json({ error: "TOTP 已启用" });
      }

      // Verify the code against the stored (encrypted) secret
      const isValid = verifyTotpCode(adminUser.totpSecret, code.trim());
      if (!isValid) {
        return res.status(401).json({ error: "验证码错误，请确认扫码正确后重试" });
      }

      // Enable TOTP
      await db.update(adminUsers).set({
        totpEnabled: true,
        updatedAt: new Date(),
      }).where(eq(adminUsers.id, adminUser.id));

      await auditLog({ adminUserId: adminUser.id, action: "totp_enabled", req });

      return res.json({ success: true, message: "TOTP 双因素认证已启用" });
    } catch (err) {
      console.error("[admin/auth/confirm-totp]", err);
      return res.status(500).json({ error: "服务器内部错误" });
    }
  });

  // Mount all auth routes under /api/admin/auth
  app.use("/api/admin/auth", router);
}
