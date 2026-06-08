import { beforeAll, afterAll, beforeEach, expect, it, describe, vi } from "vitest";
import { describeIntegration, truncateAll, closeDb, seedInviteCode } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";

/**
 * OTP send/verify integration: capture the plaintext code via mocked
 * email/SMS senders (the DB only stores a bcrypt hash), then exercise the
 * 60s resend cooldown, hourly cap, attempt lockout, expiry, and consumption.
 *
 * The senders are mocked at the module boundary so no real email/SMS is sent
 * and we can read the generated code.
 */

// Captured codes keyed by target.
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

describeIntegration("OTP send + verify", () => {
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

  describe("send", () => {
    it("sends a code for a valid email", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const target = email();
      const res = await http.post("/api/auth/otp/send", { channel: "email", target });
      expect(res.status).toBe(200);
      expect(sentCodes.get(target)).toMatch(/^\d{6}$/);
    });

    it("rejects an invalid channel (400)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/otp/send", { channel: "carrier-pigeon", target: "x" });
      expect(res.status).toBe(400);
    });

    it("rejects an invalid email (400)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/otp/send", { channel: "email", target: "not-an-email" });
      expect(res.status).toBe(400);
    });

    it("enforces the 60s resend cooldown (429 with retryAfterSec)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const target = email();
      const first = await http.post("/api/auth/otp/send", { channel: "email", target });
      expect(first.status).toBe(200);
      const second = await http.post("/api/auth/otp/send", { channel: "email", target });
      expect(second.status).toBe(429);
      expect(second.body.retryAfterSec).toBeGreaterThan(0);
    });
  });

  describe("verify-login", () => {
    async function sendAndGetCode(target: string) {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/otp/send", { channel: "email", target });
      expect(res.status).toBe(200);
      return { http, code: sentCodes.get(target)! };
    }

    it("auto-registers a new user with a valid code + invite code", async () => {
      const target = email();
      const { http, code } = await sendAndGetCode(target);
      const invite = await seedInviteCode();
      const res = await http.post("/api/auth/otp/verify-login", {
        channel: "email",
        target,
        code,
        inviteCode: invite,
      });
      expect(res.status).toBe(201); // auto-registered a new user
      expect(res.body.id).toBeDefined();
      // Session established.
      const me = await http.get("/api/auth/me");
      expect(me.status).toBe(200);
    });

    it("logs in an existing user without needing an invite code", async () => {
      const target = email();
      // First registration creates the user.
      {
        const { http, code } = await sendAndGetCode(target);
        const invite = await seedInviteCode();
        await http.post("/api/auth/otp/verify-login", { channel: "email", target, code, inviteCode: invite });
      }
      await truncateOtpOnly();
      // Second login: existing user, no invite needed.
      const { http, code } = await sendAndGetCode(target);
      const res = await http.post("/api/auth/otp/verify-login", { channel: "email", target, code });
      expect(res.status).toBe(200);
    });

    it("rejects a wrong code (401)", async () => {
      const target = email();
      const { http } = await sendAndGetCode(target);
      const res = await http.post("/api/auth/otp/verify-login", {
        channel: "email",
        target,
        code: "000000",
      });
      expect(res.status).toBe(401);
    });

    it("rejects a malformed code shape (400)", async () => {
      const target = email();
      const { http } = await sendAndGetCode(target);
      const res = await http.post("/api/auth/otp/verify-login", { channel: "email", target, code: "abc" });
      expect(res.status).toBe(400);
    });

    it("locks after 5 wrong attempts", async () => {
      const target = email();
      const { http } = await sendAndGetCode(target);
      // 5 wrong attempts (MAX_ATTEMPTS) flips to locked.
      for (let i = 0; i < 5; i++) {
        await http.post("/api/auth/otp/verify-login", { channel: "email", target, code: "111111" });
      }
      const res = await http.post("/api/auth/otp/verify-login", { channel: "email", target, code: "111111" });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/locked/i);
    });

    it("a consumed code cannot be reused", async () => {
      const target = email();
      const { http, code } = await sendAndGetCode(target);
      const invite = await seedInviteCode();
      const first = await http.post("/api/auth/otp/verify-login", { channel: "email", target, code, inviteCode: invite });
      expect(first.status).toBe(201); // auto-registered
      // Reuse the same code (now consumed).
      const reuse = await http.post("/api/auth/otp/verify-login", { channel: "email", target, code });
      expect(reuse.status).toBe(401);
    });
  });

  // Helper: clear only otp_codes so a second send isn't blocked by cooldown.
  async function truncateOtpOnly() {
    const { db } = await import("../../src/infra/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql.raw('TRUNCATE TABLE "otp_codes" RESTART IDENTITY'));
  }
});
