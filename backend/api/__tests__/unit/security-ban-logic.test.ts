import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { createSecurity } from "../../src/api/middleware/security";

/**
 * Verifies the redesigned ban logic without touching the DB:
 *  1. A 429 from a rate limiter is a pure throttle — it does NOT ban the IP.
 *  2. Single-target repetition never bans (per-account/per-target lockout owns that).
 *  3. Cross-account spray (≥5 distinct failed targets) bans the IP.
 *  4. A ban is scoped to sensitive /api/auth paths — benign + non-auth routes still work.
 *
 * DB calls in createSecurity (boot load, ban persist) are fire-and-forget with
 * try/catch, so this runs without a live DB.
 */

function get(app: http.Server, path: string, ip: string) {
  return new Promise<{ status: number }>((resolve) => {
    const req = http.request(
      { port: (app.address() as AddressInfo).port, path, method: "GET", headers: { "x-forwarded-for": ip } },
      (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode! })); },
    );
    req.end();
  });
}

function post(app: http.Server, path: string, ip: string) {
  return new Promise<{ status: number }>((resolve) => {
    const req = http.request(
      { port: (app.address() as AddressInfo).port, path, method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" } },
      (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode! })); },
    );
    req.end("{}");
  });
}

describe("security ban logic (redesigned)", () => {
  let server: http.Server;
  let security: ReturnType<typeof createSecurity>;
  const ATTACKER_IP = "203.0.113.7"; // not whitelisted

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    security = createSecurity(app);
    // Stub routes — the rate limiters + block middleware sit in front.
    app.get("/api/auth/me", (_req, res) => res.status(401).json({ error: "Not authenticated" }));
    app.post("/api/auth/login", (_req, res) => res.status(401).json({ error: "Invalid credentials" }));
    app.post("/api/auth/otp/send", (_req, res) => res.status(200).json({ ok: true }));
    app.get("/api/other", (_req, res) => res.status(200).json({ ok: true }));
    await new Promise<void>((r) => { server = app.listen(0, r); });
  });

  afterAll(() => new Promise<void>((r) => server!.close(() => r())));

  it("a 429 throttle burst does NOT ban the IP", async () => {
    // Hammer a sensitive endpoint past the 30/15min limit. Pre-redesign this
    // would have recorded strikes and banned after 3 over-limit requests.
    for (let i = 0; i < 40; i++) {
      await post(server!, "/api/auth/otp/send", ATTACKER_IP);
    }
    // 31st+ should be throttled (429), but the IP must NOT be banned: a benign
    // auth read still returns its normal 401, not a 403 block.
    const me = await get(server!, "/api/auth/me", ATTACKER_IP);
    expect(me.status).toBe(401);
    expect(security.isIpBlocked(ATTACKER_IP)).toBe(false);
  });

  it("single-target repetition never bans", () => {
    const ip = "198.51.100.42";
    for (let i = 0; i < 20; i++) security.recordAuthFailure(ip, "same-target@example.com");
    expect(security.isIpBlocked(ip)).toBe(false);
  });

  it("cross-account spray (5 distinct targets) bans the IP", () => {
    const ip = "198.51.100.99";
    security.recordAuthFailure(ip, "t1@example.com");
    security.recordAuthFailure(ip, "t2@example.com");
    security.recordAuthFailure(ip, "t3@example.com");
    security.recordAuthFailure(ip, "t4@example.com");
    expect(security.isIpBlocked(ip)).toBe(false); // 4 distinct — under threshold
    security.recordAuthFailure(ip, "t5@example.com"); // 5th distinct → ban
    expect(security.isIpBlocked(ip)).toBe(true);
  });

  it("a ban is scoped to sensitive /api/auth paths", async () => {
    const ip = "198.51.100.5";
    // Force a ban via cross-account spray.
    for (let i = 1; i <= 5; i++) security.recordAuthFailure(ip, `spray${i}@example.com`);
    expect(security.isIpBlocked(ip)).toBe(true);

    // Sensitive auth write → blocked (403).
    const login = await post(server!, "/api/auth/login", ip);
    expect(login.status).toBe(403);
    const otpSend = await post(server!, "/api/auth/otp/send", ip);
    expect(otpSend.status).toBe(403);

    // Benign auth read → still its normal 401 (not 403).
    const me = await get(server!, "/api/auth/me", ip);
    expect(me.status).toBe(401);

    // Non-auth route → still 200.
    const other = await get(server!, "/api/other", ip);
    expect(other.status).toBe(200);
  });
});
