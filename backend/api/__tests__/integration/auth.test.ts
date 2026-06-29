import { beforeAll, afterAll, beforeEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb, seedInviteCode, createAuthenticatedClient } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";
import { db } from "../../src/infra/db";
import { sql } from "drizzle-orm";

/**
 * /api/auth — the OTP-only auth model. Username register/login was retired
 * (POST /api/auth/register and /login now 403), so this exercises the live
 * surface: disabled-endpoint guards, session cookie flow via OTP verify-login,
 * /auth/me, logout, and the invite-gate.
 */
describeIntegration("auth", () => {
  let appCtx: TestApp;
  const bcryptP = import("bcryptjs").then((m) => m.default);

  beforeAll(async () => {
    appCtx = await createTestApp();
  });
  afterAll(async () => {
    await appCtx.close();
    await closeDb();
  });
  beforeEach(async () => {
    await truncateAll();
    appCtx.resetRateLimiters();
  });

  /** Seed a valid login OTP and drive verify-login, returning the authed client. */
  async function seedOtpAndVerify(target: string, inviteCode?: string) {
    const bcrypt = await bcryptP;
    const { otpCodes } = await import("@cascade/database");
    const code = "123456";
    await db.insert(otpCodes).values({
      channel: "email",
      target,
      codeHash: await bcrypt.hash(code, 10),
      purpose: "login",
      expiresAt: sql`now() + interval '10 minutes'`,
    });
    const http = new HttpClient(appCtx.baseUrl);
    const res = await http.post("/api/auth/otp/verify-login", {
      channel: "email", target, code, inviteCode,
    });
    return { http, res };
  }

  describe("retired username endpoints", () => {
    it("POST /api/auth/register is disabled (403)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/register", {
        username: "someone", password: "pw-strong-123", inviteCode: "x",
      });
      expect(res.status).toBe(403);
    });

    it("POST /api/auth/login is disabled (403/401)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/login", { username: "someone", password: "pw" });
      // login route rejects; never establishes a session
      expect([401, 403, 400]).toContain(res.status);
      const me = await http.get("/api/auth/me");
      expect(me.status).toBe(401);
    });
  });

  describe("OTP verify-login + session", () => {
    it("auto-registers a new user with a valid code + invite code (201) and seats a session", async () => {
      const invite = await seedInviteCode();
      const { http, res } = await seedOtpAndVerify(`new${Date.now()}@example.com`, invite);
      expect(res.status).toBe(201);
      const me = await http.get("/api/auth/me");
      expect(me.status).toBe(200);
    });

    it("logs an existing user back in without an invite code", async () => {
      const target = `repeat${Date.now()}@example.com`;
      const invite = await seedInviteCode();
      const first = await seedOtpAndVerify(target, invite);
      expect(first.res.status).toBe(201);
      // Second login, no invite needed.
      const second = await seedOtpAndVerify(target);
      expect(second.res.status).toBe(200);
      const me = await second.http.get("/api/auth/me");
      expect(me.status).toBe(200);
    });

    it("logout clears the session (subsequent /me is 401)", async () => {
      const http = await createAuthenticatedClient(appCtx.baseUrl);
      const out = await http.post("/api/auth/logout");
      expect(out.status).toBe(204);
      const me = await http.get("/api/auth/me");
      expect(me.status).toBe(401);
    });

    it("/auth/me is 401 without a session", async () => {
      const fresh = new HttpClient(appCtx.baseUrl);
      const res = await fresh.get("/api/auth/me");
      expect(res.status).toBe(401);
    });
  });

  describe("invite-gate", () => {
    it("401 when not authenticated", async () => {
      const fresh = new HttpClient(appCtx.baseUrl);
      const res = await fresh.post("/api/auth/invite-gate", { inviteCode: "x" });
      expect(res.status).toBe(401);
    });

    it("400 with empty invite code when authenticated", async () => {
      const http = await createAuthenticatedClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/invite-gate", { inviteCode: "  " });
      expect(res.status).toBe(400);
    });
  });
});
