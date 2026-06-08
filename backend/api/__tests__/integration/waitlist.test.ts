import { beforeAll, afterAll, beforeEach, expect, it, describe, vi } from "vitest";
import { describeIntegration, truncateAll, closeDb } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";

/**
 * /api/waitlist — public submit (email validation, dedup, edu detection) and
 * the admin GET behind x-admin-secret. The confirmation email is fired
 * fire-and-forget, so we mock the email module to keep it silent and fast.
 */
vi.mock("../../src/infra/email", async (orig) => {
  const actual = await orig<typeof import("../../src/infra/email")>();
  return { ...actual, sendEmail: vi.fn(async () => {}) };
});

describeIntegration("waitlist", () => {
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

  const email = () => `wl${Math.random().toString(36).slice(2, 8)}@example.com`;

  describe("POST /api/waitlist", () => {
    it("accepts a valid email", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/waitlist", { email: email() });
      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(true);
    });

    it("dedups a repeat email (alreadyOnList)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const e = email();
      await http.post("/api/waitlist", { email: e });
      const again = await http.post("/api/waitlist", { email: e });
      expect(again.status).toBe(200);
      expect(again.body.alreadyOnList).toBe(true);
    });

    it("normalizes case so EMAIL and email dedup together", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const lower = email();
      await http.post("/api/waitlist", { email: lower });
      const upper = await http.post("/api/waitlist", { email: lower.toUpperCase() });
      expect(upper.body.alreadyOnList).toBe(true);
    });

    it("rejects an invalid email (400)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/waitlist", { email: "not-an-email" });
      expect(res.status).toBe(400);
    });

    it("rejects a missing email (400)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.post("/api/waitlist", {});
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/waitlist (admin)", () => {
    it("rejects without the admin secret", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.get("/api/waitlist");
      // 401 if ADMIN_SECRET configured, 503 if not — both are non-200 denials.
      expect([401, 503]).toContain(res.status);
    });

    it("rejects a wrong admin secret (401 when configured)", async () => {
      const http = new HttpClient(appCtx.baseUrl);
      const res = await http.get("/api/waitlist", { "x-admin-secret": "definitely-wrong" });
      expect([401, 503]).toContain(res.status);
    });

    it("returns the list when the correct admin secret is supplied", async () => {
      const secret = process.env.ADMIN_SECRET;
      // Only meaningful when ADMIN_SECRET is configured for the test env.
      if (!secret) return;
      const http = new HttpClient(appCtx.baseUrl);
      await http.post("/api/waitlist", { email: email() });
      const res = await http.get("/api/waitlist", { "x-admin-secret": secret });
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.subscribers)).toBe(true);
    });
  });
});
