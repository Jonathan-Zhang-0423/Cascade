import { beforeAll, afterAll, beforeEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb, seedInviteCode } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";

/**
 * /api/auth — password register/login/logout, session cookie flow, /auth/me,
 * invite-gate guards, and credential edge cases. Registration requires a valid
 * invite code, which we seed directly.
 */
describeIntegration("auth (password)", () => {
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
  });

  const creds = () => ({
    username: `user_${Math.random().toString(36).slice(2, 10)}`,
    password: "hunter2-strong",
  });

  describe("register", () => {
    it("creates a user with a valid invite code and sets a session", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const code = await seedInviteCode();
      const c = creds();
      const res = await http.post("/api/auth/register", { ...c, inviteCode: code });
      expect(res.status).toBe(201);
      expect(res.body.username).toBe(c.username);

      // Session cookie should now authenticate /auth/me.
      const me = await http.get("/api/auth/me");
      expect(me.status).toBe(200);
      expect(me.body.username).toBe(c.username);
    });

    it("rejects missing username/password (400)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/register", { username: "", password: "", inviteCode: "x" });
      expect(res.status).toBe(400);
    });

    it("rejects a missing invite code (400)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/auth/register", { ...creds() });
      expect(res.status).toBe(400);
    });

    it("rejects an invalid invite code and does not persist the user (400)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const c = creds();
      const res = await http.post("/api/auth/register", { ...c, inviteCode: "NOPE" });
      expect(res.status).toBe(400);
      // The username must be free again (user was rolled back).
      const code = await seedInviteCode();
      const retry = await http.post("/api/auth/register", { ...c, inviteCode: code });
      expect(retry.status).toBe(201);
    });

    it("rejects a duplicate username (409)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const c = creds();
      const code1 = await seedInviteCode();
      await http.post("/api/auth/register", { ...c, inviteCode: code1 });

      const http2 = new HttpClient(appCtx.baseUrl);
      const code2 = await seedInviteCode();
      const dup = await http2.post("/api/auth/register", { ...c, inviteCode: code2 });
      expect(dup.status).toBe(409);
    });

    it("a used invite code cannot be redeemed twice (400)", async () => {
      const code = await seedInviteCode();
      const h1 = new HttpClient(appCtx.baseUrl);
      const r1 = await h1.post("/api/auth/register", { ...creds(), inviteCode: code });
      expect(r1.status).toBe(201);

      const h2 = new HttpClient(appCtx.baseUrl);
      const r2 = await h2.post("/api/auth/register", { ...creds(), inviteCode: code });
      expect(r2.status).toBe(400);
    });
  });

  describe("login / logout / me", () => {
    async function registered() {
      const http = new HttpClient(appCtx.baseUrl);
      const code = await seedInviteCode();
      const c = creds();
      await http.post("/api/auth/register", { ...c, inviteCode: code });
      return { http, c };
    }

    it("logs in with correct credentials on a fresh client", async () => {
      const { c } = await registered();
      const fresh = new HttpClient(appCtx.baseUrl);
      const res = await fresh.post("/api/auth/login", c);
      expect(res.status).toBe(200);
      expect(res.body.username).toBe(c.username);
      const me = await fresh.get("/api/auth/me");
      expect(me.status).toBe(200);
    });

    it("rejects wrong password with generic 401", async () => {
      const { c } = await registered();
      const fresh = new HttpClient(appCtx.baseUrl);
      const res = await fresh.post("/api/auth/login", { username: c.username, password: "wrong" });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");
    });

    it("rejects unknown user with the same generic 401 (no user enumeration)", async () => {
      const fresh = new HttpClient(appCtx.baseUrl);
      const res = await fresh.post("/api/auth/login", { username: "ghost", password: "whatever" });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");
    });

    it("logout clears the session (subsequent /me is 401)", async () => {
      const { http } = await registered();
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
      // Register (which authenticates) but the user already redeemed at register;
      // invite-gate with empty code should still 400 on validation first.
      const http = new HttpClient(appCtx.baseUrl);
      const code = await seedInviteCode();
      await http.post("/api/auth/register", { ...creds(), inviteCode: code });
      const res = await http.post("/api/auth/invite-gate", { inviteCode: "  " });
      expect(res.status).toBe(400);
    });
  });
});
