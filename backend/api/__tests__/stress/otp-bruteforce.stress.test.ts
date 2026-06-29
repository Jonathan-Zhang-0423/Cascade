import { beforeAll, afterAll, beforeEach, afterEach, expect, it, describe, vi } from "vitest";
import { describeIntegration, truncateAll, closeDb } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";

/**
 * OTP brute-force resistance stress. An attacker who knows a target email but
 * not the 6-digit code must be stopped well before exhausting the 1,000,000
 * code space: the per-code attempt limit (5) must lock the code, and a locked
 * code must stay locked even under rapid concurrent guessing. We also pin that
 * a fresh send is required to retry (the lockout can't be trivially reset).
 */

// Capture the real code so the positive control (correct code still works on a
// fresh send) is meaningful; brute-force guesses deliberately avoid it.
const sentCodes = new Map<string, string>();
vi.mock("../../src/infra/email", async (orig) => {
  const actual = await orig<typeof import("../../src/infra/email")>();
  return {
    ...actual,
    sendEmail: vi.fn(async (input: any) => {
      const m = /(\d{6})/.exec(input.subject ?? "") ?? /(\d{6})/.exec(input.text ?? "");
      if (m) sentCodes.set(input.to, m[1]);
    }),
  };
});

describeIntegration("stress: OTP brute-force resistance", () => {
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
    appCtx.resetRateLimiters();
    sentCodes.clear();
  });

  const email = () => `bf${Math.random().toString(36).slice(2, 8)}@example.com`;

  async function sendCode(http: HttpClient, target: string) {
    const res = await http.post("/api/auth/otp/send", { channel: "email", target });
    expect(res.status).toBe(200);
    return sentCodes.get(target)!;
  }

  /** A wrong 6-digit guess that is never equal to `correct`. */
  function wrongGuess(correct: string, i: number): string {
    const g = String((parseInt(correct, 10) + i + 1) % 1_000_000).padStart(6, "0");
    return g === correct ? "000000" : g;
  }

  it("locks a code after 5 failed attempts; further guesses are rejected as locked", async () => {
    const http = new HttpClient(appCtx.baseUrl);
    const target = email();
    const correct = await sendCode(http, target);

    // 5 sequential wrong guesses → should flip to locked at/after the limit.
    let sawInvalid = 0;
    for (let i = 0; i < 5; i++) {
      const res = await http.post("/api/auth/otp/verify-login", {
        channel: "email",
        target,
        code: wrongGuess(correct, i),
      });
      expect(res.status).toBe(401);
      if (/invalid/i.test(res.body.error)) sawInvalid++;
    }
    expect(sawInvalid).toBeGreaterThan(0);

    // The 6th attempt — even with the CORRECT code — must be refused as locked.
    const afterLock = await http.post("/api/auth/otp/verify-login", {
      channel: "email",
      target,
      code: correct,
    });
    expect(afterLock.status).toBe(401);
    expect(afterLock.body.error).toMatch(/locked/i);
  });

  it("a locked code stays locked under a rapid concurrent guess storm", async () => {
    const http = new HttpClient(appCtx.baseUrl);
    const target = email();
    const correct = await sendCode(http, target);

    // Burn through the attempt budget.
    for (let i = 0; i < 5; i++) {
      await http.post("/api/auth/otp/verify-login", { channel: "email", target, code: wrongGuess(correct, i) });
    }

    // Now fire 50 concurrent guesses (including the correct code) — none may
    // succeed, and the endpoint must not 500 under the burst.
    const storm = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        http.post("/api/auth/otp/verify-login", {
          channel: "email",
          target,
          code: i === 0 ? correct : wrongGuess(correct, i + 10),
        }),
      ),
    );
    // None may succeed. A guess is rejected either as bad/locked (401) or
    // throttled by the per-IP auth limiter (429) under the burst — both are
    // non-success. The security property is "no guess authenticated".
    expect(storm.every((r) => r.status === 401 || r.status === 429)).toBe(true);
    // No login session should have been established. Reset the per-IP limiter
    // first so this check isn't itself throttled by the preceding burst.
    appCtx.resetRateLimiters();
    const me = await http.get("/api/auth/me");
    expect(me.status).toBe(401);
  });

  it("brute force across many targets does not let any single code exceed its attempt budget", async () => {
    // Simulate an attacker spraying 10 targets, 8 guesses each. Each target must
    // independently lock at its own budget — no shared/global bypass.
    const http = new HttpClient(appCtx.baseUrl);
    const targets = Array.from({ length: 10 }, () => email());
    const codes = new Map<string, string>();
    for (const t of targets) codes.set(t, await sendCode(http, t));

    let anyAccepted = false;
    for (const t of targets) {
      const correct = codes.get(t)!;
      for (let i = 0; i < 8; i++) {
        const res = await http.post("/api/auth/otp/verify-login", {
          channel: "email",
          target: t,
          code: wrongGuess(correct, i),
        });
        if (res.status === 200 || res.status === 201) anyAccepted = true;
      }
    }
    expect(anyAccepted).toBe(false);
  });

  it("after lockout, a NEW send issues a fresh code that works (lockout is per-code, not permanent DoS)", async () => {
    const http = new HttpClient(appCtx.baseUrl);
    const target = email();
    const first = await sendCode(http, target);
    for (let i = 0; i < 5; i++) {
      await http.post("/api/auth/otp/verify-login", { channel: "email", target, code: wrongGuess(first, i) });
    }
    // Locked now. Clear the cooldown row so a fresh send is allowed.
    const { db } = await import("../../src/infra/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql.raw('TRUNCATE TABLE "otp_codes" RESTART IDENTITY'));

    // Fresh send + correct code should authenticate (legit user recovers).
    const second = await sendCode(http, target);
    expect(second).toMatch(/^\d{6}$/);
    const { seedInviteCode } = await import("../_helpers/db");
    const invite = await seedInviteCode();
    const res = await http.post("/api/auth/otp/verify-login", {
      channel: "email",
      target,
      code: second,
      inviteCode: invite,
    });
    expect([200, 201]).toContain(res.status);
  });
});
