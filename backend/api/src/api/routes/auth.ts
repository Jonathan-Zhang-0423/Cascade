import type { Express } from "express";
import bcrypt from "bcryptjs";
import https from "https";
import { randomBytes } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { eq, and } from "drizzle-orm";
import { db, pool } from "../../infra/db";
import { storage } from "../../infra/storage";
import { srcDir } from "../../infra/paths";
import { users, otpCodes, userSkills, inviteCodes } from "@cascade/database";
import { sendOtp, verifyOtp, normalizeTarget } from "../../auth/otp";
import { redeemInviteCode, ensureReferralCode, randomSuffix } from "../services/invite-service";
import { checkCaptcha } from "../middleware/auth-middleware";
import type { Security } from "../middleware/security";

/**
 * Auth routes (Step C): invite-gate, login/logout/me, set/reset password,
 * OTP send + verify-login, email binding, and GitHub OAuth. The account-lockout
 * helpers come from the shared `security` instance (passed in). Behavior
 * unchanged from the inline versions in registerRoutes.
 */
export function registerAuthRoutes(app: Express, security: Security): void {
  const { recordLoginFail, isAccountLocked, clearAccountLockout, getLockout, MAX_FAIL } = security;

  // === AUTH ===

  // Validate an invite code and atomically mark it redeemed by the given user.
  // Returns the trial expiry to write to users.trialExpiresAt, or an error
  // string for the caller to map to an HTTP 400 response.
  app.post("/api/auth/register", async (req, res) => {
    // Username-based registration is closed. New users must register via
    // email OTP, phone OTP, or GitHub OAuth.
    return res.status(403).json({ error: "Registration via username is not available. Please sign up with email, phone, or GitHub." });
  });

  app.post("/api/auth/invite-gate", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { inviteCode } = req.body as { inviteCode?: string };
      if (!inviteCode?.trim()) return res.status(400).json({ error: "Invite code required" });

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if ((user as any).inviteCode) {
        // Idempotent — already redeemed.
        return res.json({ ok: true, alreadyRedeemed: true });
      }

      const redeem = await redeemInviteCode(inviteCode, userId);
      if (!redeem.ok) return res.status(400).json({ error: redeem.error });

      await db.update(users)
        .set({ inviteCode: redeem.code, trialExpiresAt: redeem.trialExpiresAt })
        .where(eq(users.id, userId));

      res.json({ ok: true, inviteCode: redeem.code, trialExpiresAt: redeem.trialExpiresAt.toISOString() });
    } catch (err) {
      console.error("[auth/invite-gate]", err);
      res.status(500).json({ error: "Failed to redeem invite code" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      if (!(await checkCaptcha(req, res))) return;
      const { username, password } = req.body as { username: string; password: string };
      if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
        return res.status(400).json({ error: "username and password required" });
      }
      const identifier = username.trim();

      // Resolve user by email, phone, or username — whichever matches first.
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.toLowerCase());
      const isPhone = /^\+\d{8,15}$/.test(identifier);
      let user =
        isEmail ? await storage.getUserByEmail(identifier.toLowerCase())
        : isPhone ? await storage.getUserByPhone(identifier)
        : await storage.getUserByUsername(identifier);

      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      if (!user.password) return res.status(401).json({ error: "Invalid credentials" });

      // Account lockout check
      if (isAccountLocked(user.id)) {
        const entry = getLockout(user.id);
        const remainingSec = entry?.lockedUntil ? Math.ceil((entry.lockedUntil - Date.now()) / 1000) : 900;
        return res.status(403).json({ error: "Account temporarily locked due to too many failed attempts.", remainingSec });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        recordLoginFail(user.id);
        const entry = getLockout(user.id);
        const remaining = MAX_FAIL - (entry?.failCount ?? 0);
        const msg = remaining <= 0
          ? "Account temporarily locked due to too many failed attempts."
          : `Invalid credentials. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`;
        return res.status(401).json({ error: msg });
      }

      // Success — clear any lockout
      clearAccountLockout(user.id);
      (req.session as any).userId = user.id;
      await new Promise<void>((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
      res.json({
        id: user.id,
        username: user.username,
        experienceLevel: (user as any).experienceLevel,
        hasSetExperienceLevel: (user as any).hasSetExperienceLevel ?? false,
        inviteCode: (user as any).inviteCode ?? null,
        trialExpiresAt: (user as any).trialExpiresAt
          ? ((user as any).trialExpiresAt as Date).toISOString()
          : null,
      });
    } catch (err) {
      console.error("[auth/login]", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({
      id: user.id,
      username: user.username,
      experienceLevel: (user as any).experienceLevel,
      hasSetExperienceLevel: (user as any).hasSetExperienceLevel ?? false,
      hasPassword: !!(user as any).password,
      inviteCode: (user as any).inviteCode ?? null,
      phoneVerified: !!(user as any).phoneVerified,
      email: (user as any).email ?? null,
      phone: (user as any).phone ?? null,
      githubId: (user as any).githubId ?? null,
      trialExpiresAt: (user as any).trialExpiresAt
        ? ((user as any).trialExpiresAt as Date).toISOString()
        : null,
    });
  });

  app.put("/api/auth/me/username", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { username } = req.body as { username?: string };
      if (!username || typeof username !== "string" || !username.trim()) {
        return res.status(400).json({ error: "Username required" });
      }
      const trimmed = username.trim();
      if (trimmed.length < 2 || trimmed.length > 32) {
        return res.status(400).json({ error: "Username must be 2–32 characters" });
      }
      if (!/^[a-zA-Z0-9_\-一-龥]+$/.test(trimmed)) {
        return res.status(400).json({ error: "Username contains invalid characters" });
      }
      const existing = await storage.getUserByUsername(trimmed);
      if (existing && existing.id !== userId) {
        return res.status(409).json({ error: "Username already taken" });
      }
      await db.update(users).set({ username: trimmed }).where(eq(users.id, userId));
      res.json({ ok: true, username: trimmed });
    } catch (err) {
      console.error("[auth/me/username]", err);
      res.status(500).json({ error: "Failed to update username" });
    }
  });

  app.put("/api/auth/me/experience", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { experienceLevel } = req.body as { experienceLevel?: string };
      const safeLevel = ["beginner", "intermediate", "advanced"].includes(experienceLevel ?? "")
        ? (experienceLevel as string) : "intermediate";

      await db.update(users)
        .set({ experienceLevel: safeLevel, hasSetExperienceLevel: true })
        .where(eq(users.id, userId));

      // Seed starter skill
      const starterPath = join(srcDir("skills", "builtin", "starters"), `${safeLevel}.md`);
      if (existsSync(starterPath)) {
        const content = readFileSync(starterPath, "utf-8");
        await db.insert(userSkills).values({
          userId,
          name: `starter-${safeLevel}`,
          description: `Starter guidance for ${safeLevel} developers`,
          type: "knowledge",
          content,
          enabled: true,
        }).onConflictDoNothing();
      }

      const user = await storage.getUser(userId);
      res.json({ id: user!.id, username: user!.username, experienceLevel: safeLevel, hasSetExperienceLevel: true });
    } catch (err) {
      console.error("[auth/experience]", err);
      res.status(500).json({ error: "Failed to set experience level" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) console.error("[auth/logout]", err);
      res.status(204).end();
    });
  });

  // Set or change the current user's password. OTP-registered users (password
  // === null) can set one without a current password. Users who already have a
  // password must prove it (currentPassword) so a hijacked session can't lock
  // out the owner. On success the session is destroyed — the user must log in
  // again with the new credential.
  app.post("/api/auth/set-password", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { password, currentPassword } = req.body as {
        password?: string; currentPassword?: string;
      };
      if (typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      if ((user as any).password) {
        // Already has a password — require the current one to change it.
        if (typeof currentPassword !== "string" || !currentPassword) {
          return res.status(403).json({ error: "Current password required" });
        }
        const match = await bcrypt.compare(currentPassword, (user as any).password);
        if (!match) return res.status(403).json({ error: "Current password incorrect" });
      }

      const hashed = await bcrypt.hash(password, 10);
      await db.update(users).set({ password: hashed }).where(eq(users.id, userId));

      // Force re-login with the new credential.
      req.session.destroy((err) => {
        if (err) console.error("[auth/set-password] session destroy", err);
        res.json({ ok: true, reauth: true });
      });
    } catch (err) {
      console.error("[auth/set-password]", err);
      res.status(500).json({ error: "Failed to set password" });
    }
  });

  // Send a password-reset code to an email/phone. Anti-enumeration: always
  // returns 200 regardless of whether an account exists; only sends a code when
  // a matching user is found. Uses a distinct OTP purpose so a reset code can't
  // be replayed against the login endpoint (and vice versa).
  app.post("/api/auth/reset-password/send", async (req, res) => {
    try {
      if (!(await checkCaptcha(req, res))) return;
      const { channel, target } = req.body as { channel?: string; target?: string };
      if (channel !== "email" && channel !== "sms") {
        return res.status(400).json({ error: "Invalid channel" });
      }
      const normalized = normalizeTarget(channel, target ?? "");
      if (!normalized) {
        return res.status(400).json({ error: channel === "email" ? "Invalid email" : "Invalid phone" });
      }

      const existing = channel === "email"
        ? await storage.getUserByEmail(normalized)
        : await storage.getUserByPhone(normalized);

      if (existing) {
        const result = await sendOtp({ channel, target: normalized, purpose: "reset_password" });
        if (!result.ok) {
          return res.status(429).json({ error: "Send rate-limited", retryAfterSec: result.retryAfterSec });
        }
        // Identical response whether or not the account exists — anti-enumeration.
        return res.json({ ok: true, retryAfterSec: result.retryAfterSec });
      }
      // Account not found — return identical shape so callers can't enumerate.
      res.json({ ok: true, retryAfterSec: 60 });
    } catch (err) {
      console.error("[auth/reset-password/send]", err);
      res.status(500).json({ error: "Failed to send code" });
    }
  });

  // Verify a reset code and set a new password. Does NOT log the user in — they
  // sign in afterwards with the new credential. Receiving the code proves
  // ownership of the email/phone, so the matching verified flag is also set.
  app.post("/api/auth/reset-password/verify", async (req, res) => {
    try {
      const { channel, target, code, password } = req.body as {
        channel?: string; target?: string; code?: string; password?: string;
      };
      if (channel !== "email" && channel !== "sms") {
        return res.status(400).json({ error: "Invalid channel" });
      }
      const normalized = normalizeTarget(channel, target ?? "");
      if (!normalized) {
        return res.status(400).json({ error: channel === "email" ? "Invalid email" : "Invalid phone" });
      }
      if (!code || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: "Invalid or expired code" });
      }
      if (typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const verify = await verifyOtp({ channel, target: normalized, code, purpose: "reset_password" });
      if (!verify.ok) {
        const errMsg = verify.error === "locked" ? "Code locked - request a new one" : "Invalid or expired code";
        return res.status(401).json({ error: errMsg });
      }

      const existing = channel === "email"
        ? await storage.getUserByEmail(normalized)
        : await storage.getUserByPhone(normalized);
      // Generic 401 — don't reveal whether the account exists at this stage.
      if (!existing) return res.status(401).json({ error: "Invalid or expired code" });

      const hashed = await bcrypt.hash(password, 10);
      const verifiedPatch = channel === "email"
        ? { emailVerified: true }
        : { phoneVerified: true };
      await db.update(users)
        .set({ password: hashed, ...verifiedPatch })
        .where(eq(users.id, existing.id));

      res.json({ ok: true });
    } catch (err) {
      console.error("[auth/reset-password/verify]", err);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // 人机验证（腾讯云天御）：从请求体取 ticket/randstr，结合真实 IP 验票。
  // 验证失败返回 403。未配置凭证时 verifyCaptcha 内部降级放行。
  // 注意：这不替代 OTP 发送频率限制 / 验证码锁，两者叠加才完整。
  // 前端 TCaptcha 初始化所需的公开 CaptchaAppId。enabled=false 时前端跳过取票。
  // === OTP (email + phone) ===

  app.post("/api/auth/otp/send", async (req, res) => {
    try {
      if (!(await checkCaptcha(req, res))) return;
      const { channel, target, purpose: rawPurpose } = req.body as { channel?: string; target?: string; purpose?: string };
      if (channel !== "email" && channel !== "sms") {
        return res.status(400).json({ error: "Invalid channel" });
      }
      const normalized = normalizeTarget(channel, target ?? "");
      if (!normalized) {
        return res.status(400).json({ error: channel === "email" ? "Invalid email" : "Invalid phone" });
      }
      const purpose = rawPurpose === "bind_email" ? "bind_email" : "login";
      const result = await sendOtp({ channel, target: normalized, purpose });
      if (!result.ok) {
        return res.status(429).json({ error: "Send rate-limited", retryAfterSec: result.retryAfterSec });
      }
      res.json({ ok: true, retryAfterSec: result.retryAfterSec });
    } catch (err) {
      console.error("[auth/otp/send]", err);
      res.status(500).json({ error: "Failed to send code" });
    }
  });

  app.post("/api/auth/otp/verify-login", async (req, res) => {
    try {
      if (!(await checkCaptcha(req, res))) return;
      const { channel, target, code, inviteCode, referralCode } = req.body as {
        channel?: string; target?: string; code?: string; inviteCode?: string; referralCode?: string;
      };
      if (channel !== "email" && channel !== "sms") {
        return res.status(400).json({ error: "Invalid channel" });
      }
      const normalized = normalizeTarget(channel, target ?? "");
      if (!normalized) {
        return res.status(400).json({ error: channel === "email" ? "Invalid email" : "Invalid phone" });
      }
      if (!code || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: "Invalid or expired code" });
      }

      const verify = await verifyOtp({ channel, target: normalized, code, purpose: "login" });
      if (!verify.ok) {
        const errMsg = verify.error === "locked" ? "Code locked - request a new one" : "Invalid or expired code";
        return res.status(401).json({ error: errMsg });
      }

      // Look up existing user by email or phone
      const existing = channel === "email"
        ? await storage.getUserByEmail(normalized)
        : await storage.getUserByPhone(normalized);

      if (existing) {
        const verifiedPatch = channel === "email"
          ? { emailVerified: true }
          : { phoneVerified: true };
        await db.update(users).set(verifiedPatch).where(eq(users.id, existing.id));
        (req.session as any).userId = existing.id;
        await new Promise<void>((resolve, reject) =>
          req.session.save((err) => (err ? reject(err) : resolve()))
        );
        return res.json({
          id: existing.id,
          username: existing.username,
          experienceLevel: (existing as any).experienceLevel,
          hasSetExperienceLevel: (existing as any).hasSetExperienceLevel ?? false,
          inviteCode: (existing as any).inviteCode ?? null,
          trialExpiresAt: (existing as any).trialExpiresAt
            ? ((existing as any).trialExpiresAt as Date).toISOString()
            : null,
        });
      }

      // Auto-register: phone (SMS) users bypass invite code and get 30-day free trial.
      // Email users require a manual invite code or a valid referral code.
      if (channel === "sms") {
        // Create phone user directly — no invite code needed
        let username = "";
        let createdUserId = "";
        for (let i = 0; i < 5; i++) {
          const candidate = `user_${randomBytes(4).toString("hex")}`;
          try {
            const id = randomBytes(16).toString("hex");
            const trialExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            const [row] = await db.insert(users).values({
              id,
              username: candidate,
              password: null,
              phone: normalized,
              phoneVerified: true,
              trialExpiresAt,
            }).returning({ id: users.id, username: users.username });
            createdUserId = row.id;
            username = row.username;
            break;
          } catch (err: any) {
            if (!String(err?.message ?? "").includes("users_username")) throw err;
          }
        }
        if (!createdUserId) {
          return res.status(500).json({ error: "Failed to create account" });
        }
        let newReferralCode: string | null = null;
        try { newReferralCode = await ensureReferralCode(createdUserId); } catch {}
        (req.session as any).userId = createdUserId;
        await new Promise<void>((resolve, reject) =>
          req.session.save((err) => (err ? reject(err) : resolve()))
        );
        return res.status(201).json({
          id: createdUserId,
          username,
          experienceLevel: "intermediate",
          hasSetExperienceLevel: false,
          inviteCode: null,
          trialExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          referralCode: newReferralCode,
        });
      }

      // Email registration: either a manual invite code or a valid referral code is required.
      let resolvedInviteCode = inviteCode;
      let referrerId: string | null = null;
      if (!resolvedInviteCode?.trim() && referralCode?.trim()) {
        const ref = referralCode.trim().toUpperCase();
        const [referrer] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.referralCode, ref));
        if (!referrer) {
          return res.status(400).json({ error: "Invalid invite code" });
        }
        referrerId = referrer.id;
        // Generate a fresh single-use invite code tied to this registration.
        const autoCode = `REFAUTO${randomSuffix()}`;
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        await db.insert(inviteCodes).values({
          code: autoCode,
          trialDays: 14,
          expiresAt,
        });
        resolvedInviteCode = autoCode;
      }
      if (!resolvedInviteCode?.trim()) {
        return res.status(400).json({ error: "Invite code required" });
      }

      // Create the user first (no password, OTP is the credential)
      let username = "";
      let createdUserId = "";
      for (let i = 0; i < 5; i++) {
        const candidate = `user_${randomBytes(4).toString("hex")}`;
        try {
          const id = randomBytes(16).toString("hex");
          const [row] = await db.insert(users).values({
            id,
            username: candidate,
            password: null,
            email: channel === "email" ? normalized : null,
            phone: channel === "sms" ? normalized : null,
            emailVerified: channel === "email",
            phoneVerified: channel === "sms",
          }).returning({ id: users.id, username: users.username });
          createdUserId = row.id;
          username = row.username;
          break;
        } catch (err: any) {
          // Username collision — retry. Anything else: bail.
          if (!String(err?.message ?? "").includes("users_username")) throw err;
        }
      }
      if (!createdUserId) {
        return res.status(500).json({ error: "Failed to create account" });
      }

      const redeem = await redeemInviteCode(resolvedInviteCode, createdUserId);
      if (!redeem.ok) {
        // Roll back the user so target isn't burned on a bad invite code.
        await db.delete(users).where(eq(users.id, createdUserId));
        return res.status(400).json({ error: redeem.error });
      }

      // Generate a unique referral code for the new user
      let newReferralCode: string | null = null;
      try { newReferralCode = await ensureReferralCode(createdUserId); } catch {}

      await db.update(users)
        .set({
          inviteCode: redeem.code,
          trialExpiresAt: redeem.trialExpiresAt,
          ...(referrerId ? { referredBy: referrerId } : {}),
        })
        .where(eq(users.id, createdUserId));

      (req.session as any).userId = createdUserId;
      await new Promise<void>((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
      res.status(201).json({
        id: createdUserId,
        username,
        experienceLevel: "intermediate",
        hasSetExperienceLevel: false,
        inviteCode: redeem.code,
        trialExpiresAt: redeem.trialExpiresAt.toISOString(),
        referralCode: newReferralCode,
      });
    } catch (err) {
      console.error("[auth/otp/verify-login]", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Bind email to an existing logged-in account via OTP verification
  app.post("/api/auth/bind-email", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "not_logged_in" });

      const { target, code } = req.body as { target?: string; code?: string };
      const normalized = normalizeTarget("email", target ?? "");
      if (!normalized) return res.status(400).json({ error: "Invalid email" });
      if (!code || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Invalid or expired code" });

      // check email not already taken by another account
      const existing = await storage.getUserByEmail(normalized);
      if (existing && existing.id !== userId) {
        return res.status(409).json({ error: "Email already in use" });
      }

      const verify = await verifyOtp({ channel: "email", target: normalized, code, purpose: "bind_email" });
      if (!verify.ok) {
        const errMsg = verify.error === "locked" ? "Code locked - request a new one" : "Invalid or expired code";
        return res.status(401).json({ error: errMsg });
      }

      await db.update(users)
        .set({ email: normalized, emailVerified: true })
        .where(eq(users.id, userId));

      res.json({ ok: true });
    } catch (err) {
      console.error("[auth/bind-email]", err);
      res.status(500).json({ error: "Bind failed" });
    }
  });

  // === GitHub OAuth ===

  // Node's built-in fetch (an internal undici copy) ignores HTTPS_PROXY by
  // default, which makes github.com unreachable behind a local proxy. We
  // import undici's own fetch + ProxyAgent so the dispatcher and fetch come
  // from the same undici version (mixing the npm package's ProxyAgent with
  // the built-in fetch causes "invalid onRequestStart method" errors).
  // Built lazily so prod, where HTTPS_PROXY is unset, pays no cost.
  let githubFetch: typeof fetch = fetch;
  let githubFetchInited = false;
  const getGithubFetch = async (): Promise<typeof fetch> => {
    if (githubFetchInited) return githubFetch;
    githubFetchInited = true;
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
      || process.env.HTTP_PROXY || process.env.http_proxy;
    if (proxyUrl) {
      try {
        const undici = await import("undici");
        const dispatcher = new undici.ProxyAgent(proxyUrl);
        githubFetch = ((url: any, init: any = {}) =>
          (undici.fetch as any)(url, { ...init, dispatcher })) as unknown as typeof fetch;
        console.log(`[auth/github] routing GitHub fetches via proxy ${proxyUrl}`);
      } catch (err) {
        console.warn("[auth/github] failed to init undici proxy fetch:", err instanceof Error ? err.message : err);
      }
    }
    return githubFetch;
  };

  // 1) Kick off the OAuth dance: store a state token in the session and
  //    redirect the browser to GitHub's authorize URL.
  app.get("/api/auth/github", async (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) { res.status(500).json({ error: "GitHub OAuth not configured" }); return; }
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const state = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await pool.query(
      `INSERT INTO session (sid, sess, expire) VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = $2, expire = $3`,
      [`github_state:${state}`, JSON.stringify({ githubOAuthState: state }), expiresAt]
    );
    const redirectUri = `${baseUrl}/api/auth/github/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${baseUrl}/api/auth/github/callback`,
      scope: "read:user user:email",
      state,
      allow_signup: "true",
    });
    const authorizeUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    // ?mode=url — 前端 fetch 模式，返回 JSON 避免 302 被 SPA 路由拦截
    if (req.query.mode === "url") {
      res.json({ url: authorizeUrl });
      return;
    }
    res.redirect(authorizeUrl);
  });

  // 2) Callback: exchange the code for an access token, fetch the user,
  //    then either link to an existing local user (matched by verified
  //    primary email) or create a new GitHub-only user. Finally seat the
  //    session and send the browser back to the SPA.
  // callback：验证 state 后跳前端页面，token 交换由浏览器完成（服务器访问 github.com 被墙）
  app.get("/api/auth/github/callback", async (req, res) => {
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) {
      res.redirect(`${baseUrl}/login?github_error=missing_params`);
      return;
    }
    // 验证 state 有效（防 CSRF），验完保留，让 exchange 接口再验一次后删除
    const row = await pool.query(
      `SELECT sess FROM session WHERE sid = $1 AND expire > NOW()`,
      [`github_state:${state}`]
    );
    if (row.rows.length === 0) {
      res.redirect(`${baseUrl}/login?github_error=bad_state`);
      return;
    }
    // 跳前端 callback 页面，由浏览器完成 token 交换
    res.redirect(`${baseUrl}/github-callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
  });

  // exchange：前端发来 code+state，后端用固定 IP 换 token，建立 session
  app.post("/api/auth/github/exchange", async (req, res) => {
    try {
      const { code, state } = req.body as { code?: string; state?: string };
      if (!code || !state) { res.status(400).json({ error: "missing_params" }); return; }
      const row = await pool.query(
        `SELECT sess FROM session WHERE sid = $1 AND expire > NOW()`,
        [`github_state:${state}`]
      );
      if (row.rows.length === 0) { res.status(400).json({ error: "bad_state" }); return; }
      await pool.query(`DELETE FROM session WHERE sid = $1`, [`github_state:${state}`]);

      const clientId = process.env.GITHUB_CLIENT_ID!;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET!;
      const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

      // github.com:443 在墙内不稳定，并发尝试多个已知 IP，取第一个成功的
      const GITHUB_IPS = ["20.205.243.166", "20.27.177.113", "140.82.112.4", "140.82.113.4", "140.82.114.4"];

      function tryTokenExchange(ghIp: string, body: string): Promise<any> {
        return new Promise((resolve, reject) => {
          const req2 = https.request({
            hostname: ghIp,
            port: 443,
            path: "/login/oauth/access_token",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Host: "github.com",
              "Content-Length": Buffer.byteLength(body),
            },
            rejectUnauthorized: false,
            timeout: 8000,
          }, (r) => {
            let data = "";
            r.on("data", (c) => data += c);
            r.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("parse error")); } });
          });
          req2.on("error", reject);
          req2.on("timeout", () => { req2.destroy(); reject(new Error("timeout")); });
          req2.write(body);
          req2.end();
        });
      }

      const tokenBody = JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${baseUrl}/api/auth/github/callback`,
      });

      const tokenData: any = await Promise.any(
        GITHUB_IPS.map(ip => tryTokenExchange(ip, tokenBody))
      ).catch(() => { throw new Error("all_ips_failed"); });

      if (!tokenData.access_token) {
        console.error("[github/exchange] token error:", tokenData);
        res.status(400).json({ error: tokenData.error || "no_access_token" });
        return;
      }
      const accessToken = tokenData.access_token;

      const ghFetch = await getGithubFetch();
      const userRes = await ghFetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
      });
      if (!userRes.ok) {
        const errBody = await userRes.text().catch(() => "");
        console.error("[github/exchange] user fetch failed:", userRes.status, errBody);
        res.status(400).json({ error: "user_fetch_failed" }); return;
      }
      const ghUser = await userRes.json() as {
        id: number; login: string; email: string | null; avatar_url: string | null;
      };

      let primaryEmail: string | null = ghUser.email ? ghUser.email.trim().toLowerCase() : null;
      if (!primaryEmail) {
        const emailsRes = await ghFetch("https://api.github.com/user/emails", {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
        });
        if (emailsRes.ok) {
          const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
          const picked = emails.find(e => e.primary && e.verified)?.email
            ?? emails.find(e => e.verified)?.email ?? null;
          primaryEmail = picked ? picked.trim().toLowerCase() : null;
        }
      }

      const githubId = String(ghUser.id);
      let user = await storage.getUserByGithubId(githubId);
      if (!user && primaryEmail) {
        const matched = await storage.getUserByEmail(primaryEmail);
        if (matched) {
          user = await storage.linkGithubToUser(matched.id, { githubId, avatarUrl: ghUser.avatar_url });
        }
      }
      if (!user) {
        let candidate = ghUser.login;
        let suffix = 0;
        while (await storage.getUserByUsername(candidate)) {
          suffix++;
          candidate = `${ghUser.login}-${suffix}`;
        }
        user = await storage.createGithubUser({
          username: candidate,
          githubId,
          email: primaryEmail,
          avatarUrl: ghUser.avatar_url,
        });
      }

      (req.session as any).userId = user.id;
      await new Promise<void>((resolve, reject) =>
        req.session.save((err) => err ? reject(err) : resolve())
      );
      res.json({
        id: user.id,
        username: user.username,
        inviteCode: (user as any).inviteCode ?? null,
      });
    } catch (err) {
      console.error("[auth/github/exchange]", err);
      res.status(500).json({ error: "server_error" });
    }
  });
}
