import { beforeAll, afterAll, beforeEach, expect, it, describe, vi } from "vitest";
import { describeIntegration, truncateAll, closeDb, seedInviteCode } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";

/**
 * Set-password + forgot-password reset integration.
 *
 * Covers the two code-driven password flows:
 *  - POST /api/auth/set-password  (logged-in; OTP users add a password, force re-login)
 *  - POST /api/auth/reset-password/send + /verify  (anti-enumeration + purpose isolation)
 *
 * The email sender is mocked at the module boundary so we can read the
 * generated code (the DB only stores a bcrypt hash).
 */

const sentCodes = new Map<string, string>();

vi.mock("../../src/infra/email", async (orig) => {
  const actual = await orig<typeof import("../../src/infra/email")>();
  return {
    ...actual,
    sendEmail: vi.fn(async (input: any) => {
      const m = /code:\s*(\d{6})/.exec(input.subject ?? "") ?? /(\d{6})/.exec(input.text ?? "");
      if (m) sentCodes.set(input.to, m[1]);
    }),
  };
});

vi.mock("../../src/infra/sms", async (orig) => {
  const actual = await orig<typeof import("../../src/infra/sms")>();
  return {
    ...actual,
    sendSmsOtp: vi.fn(async (input: any) => {
      sentCodes.set(input.to, input.code);
    }),
  };
});

describeIntegration("Password set + reset", () => {
  let appCtx: TestApp;

  beforeAll(async () => {
    appCtx = await createTestApp();
  });
  afterAll(async () => {
    await appCtx.close();
    await closeDb();
  });
  beforeEach(async () => {
    await truncateAll();
    sentCodes.clear();
  });

  const email = () => `u${Math.random().toString(36).slice(2, 8)}@example.com`;

  // Clear only otp_codes so a fresh send isn't blocked by the resend cooldown.
  async function truncateOtpOnly() {
    const { db } = await import("../../src/infra/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql.raw('TRUNCATE TABLE "otp_codes" RESTART IDENTITY'));
  }

  async function sendLoginCode(http: HttpClient, target: string) {
    const res = await http.post("/api/auth/otp/send", { channel: "email", target });
    expect(res.status).toBe(200);
    return sentCodes.get(target)!;
  }

  // Register a brand-new OTP user (password === null) on an authenticated
  // client. Returns the client (session set) and the username/email.
  async function registerOtpUser(): Promise<{ http: HttpClient; username: string; target: string }> {
    const http = new HttpClient(appCtx.baseUrl);
    const target = email();
    const code = await sendLoginCode(http, target);
    const invite = await seedInviteCode();
    const res = await http.post("/api/auth/otp/verify-login", { channel: "email", target, code, inviteCode: invite });
    expect(res.status).toBe(201);
    await truncateOtpOnly();
    return { http, username: res.body.username, target };
  }

  describe("set-password", () => {
    it("401 when not authenticated", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/set-password", { password: "secret123" });
      expect(res.status).toBe(401);
    });

    it("400 on a too-short password", async () => {
      const { http } = await registerOtpUser();
      const res = await http.post("/api/auth/set-password", { password: "123" });
      expect(res.status).toBe(400);
    });

    it("OTP user sets a first password, session is destroyed, and the new password logs in", async () => {
      const { http, username } = await registerOtpUser();
      const res = await http.post("/api/auth/set-password", { password: "brandnew1" });
      expect(res.status).toBe(200);
      expect(res.body.reauth).toBe(true);

      // Session destroyed → /me is now 401 on the same client.
      const me = await http.get("/api/auth/me");
      expect(me.status).toBe(401);

      // The new password works on the username/password login.
      const fresh = new HttpClient(appCtx.baseUrl);
      const login = await fresh.post("/api/auth/login", { username, password: "brandnew1" });
      expect(login.status).toBe(200);
    });

    it("requires the current password to change an existing one (403 without, 403 wrong, 200 correct)", async () => {
      const { http, username } = await registerOtpUser();
      // Establish a first password (session dies).
      expect((await http.post("/api/auth/set-password", { password: "first123" })).status).toBe(200);

      // Log back in to get a fresh authenticated session.
      const c = new HttpClient(appCtx.baseUrl);
      expect((await c.post("/api/auth/login", { username, password: "first123" })).status).toBe(200);

      // Missing currentPassword → 403.
      expect((await c.post("/api/auth/set-password", { password: "second123" })).status).toBe(403);
      // Wrong currentPassword → 403.
      expect((await c.post("/api/auth/set-password", { password: "second123", currentPassword: "nope" })).status).toBe(403);
      // Correct currentPassword → 200.
      expect((await c.post("/api/auth/set-password", { password: "second123", currentPassword: "first123" })).status).toBe(200);

      // New password works, old one doesn't.
      const c2 = new HttpClient(appCtx.baseUrl);
      expect((await c2.post("/api/auth/login", { username, password: "second123" })).status).toBe(200);
      const c3 = new HttpClient(appCtx.baseUrl);
      expect((await c3.post("/api/auth/login", { username, password: "first123" })).status).toBe(401);
    });
  });

  describe("reset-password/send (anti-enumeration)", () => {
    it("sends a code for an existing account", async () => {
      const { target } = await registerOtpUser();
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/reset-password/send", { channel: "email", target });
      expect(res.status).toBe(200);
      expect(sentCodes.get(target)).toMatch(/^\d{6}$/);
    });

    it("returns 200 but does NOT send for a non-existent account", async () => {
      const ghost = email();
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/reset-password/send", { channel: "email", target: ghost });
      expect(res.status).toBe(200); // identical response shape
      expect(sentCodes.has(ghost)).toBe(false); // …but no code was generated
    });

    it("rejects an invalid email (400)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/reset-password/send", { channel: "email", target: "not-an-email" });
      expect(res.status).toBe(400);
    });
  });

  describe("reset-password/verify", () => {
    async function sendResetCode(target: string) {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/reset-password/send", { channel: "email", target });
      expect(res.status).toBe(200);
      return { http, code: sentCodes.get(target)! };
    }

    it("resets the password with a valid code; new password logs in, old one fails", async () => {
      const { username, target } = await registerOtpUser();
      await truncateOtpOnly();

      const { http, code } = await sendResetCode(target);
      const res = await http.post("/api/auth/reset-password/verify", {
        channel: "email", target, code, password: "resetpw123",
      });
      expect(res.status).toBe(200);
      // Does NOT auto-login.
      const me = await http.get("/api/auth/me");
      expect(me.status).toBe(401);

      // New password works on login.
      const login = new HttpClient(appCtx.baseUrl);
      expect((await login.post("/api/auth/login", { username, password: "resetpw123" })).status).toBe(200);
    });

    it("rejects a wrong code (401)", async () => {
      const { target } = await registerOtpUser();
      await truncateOtpOnly();
      const { http } = await sendResetCode(target);
      const res = await http.post("/api/auth/reset-password/verify", {
        channel: "email", target, code: "000000", password: "whatever1",
      });
      expect(res.status).toBe(401);
    });

    it("400 on a too-short new password", async () => {
      const { target } = await registerOtpUser();
      await truncateOtpOnly();
      const { http, code } = await sendResetCode(target);
      const res = await http.post("/api/auth/reset-password/verify", {
        channel: "email", target, code, password: "123",
      });
      expect(res.status).toBe(400);
    });

    it("purpose isolation: a reset code cannot be used on verify-login", async () => {
      const { target } = await registerOtpUser();
      await truncateOtpOnly();
      const { http, code } = await sendResetCode(target);
      // The reset code (purpose=reset_password) must not satisfy a login verify.
      const res = await http.post("/api/auth/otp/verify-login", { channel: "email", target, code });
      expect(res.status).toBe(401);
    });

    it("purpose isolation: a login code cannot be used on reset verify", async () => {
      const { target } = await registerOtpUser();
      await truncateOtpOnly();
      const http = new HttpClient(appCtx.baseUrl);
      const loginCode = await sendLoginCode(http, target); // purpose=login
      const res = await http.post("/api/auth/reset-password/verify", {
        channel: "email", target, code: loginCode, password: "resetpw123",
      });
      expect(res.status).toBe(401);
    });
  });
});
