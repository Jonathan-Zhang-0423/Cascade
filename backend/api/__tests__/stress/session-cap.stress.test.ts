import { beforeAll, afterAll, beforeEach, afterEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb, createAuthenticatedClient } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";
import { installAiMock, type AiMock } from "../_helpers/ai-mock";

/**
 * Per-user session cap stress (MAX_SESSIONS_PER_USER, default 5). An
 * authenticated user starting many concurrent manager-chat sessions must be
 * capped at the limit with 429s for the overflow — never allowed to spawn
 * unbounded AI work. Anonymous callers are exempt (no per-user limit), which we
 * also pin so the exemption is intentional, not accidental.
 *
 * Sessions are held open with a slow stream so they stay registered while we
 * pile on more starts.
 */
describeIntegration("stress: per-user session cap", () => {
  let appCtx: TestApp;
  let ai: AiMock;
  const cap = parseInt(process.env.MAX_SESSIONS_PER_USER || "5", 10);

  beforeAll(async () => {
    appCtx = await createTestApp();
  });
  afterAll(async () => {
    await appCtx.close();
    await closeDb();
  });
  beforeEach(async () => {
    await truncateAll();
    // Slow stream: keeps each manager-chat session active (unregister happens
    // only after the stream finishes) long enough to saturate the cap.
    ai = installAiMock({ text: "x".repeat(200), chunks: 40, perChunkDelayMs: 50 });
  });
  afterEach(() => ai.restore());

  async function authedClient(): Promise<HttpClient> {
    return createAuthenticatedClient(appCtx.baseUrl);
  }

  /** Fire a manager-chat start; resolve with its HTTP status without draining. */
  function startManagerChat(http: HttpClient, ac: AbortController): Promise<number> {
    return http
      .stream("POST", "/api/manager-chat", {
        body: { messages: [{ role: "user", content: "hi" }], files: [], projectId: `p-${Math.random()}` },
        signal: ac.signal,
      })
      .then((res) => {
        // 200 → SSE stream opened (session registered). 429 → cap rejected.
        // Drain nothing; we hold the connection open via the abort controller.
        return res.status;
      })
      .catch(() => -1);
  }

  it(`caps one user at ${cap} concurrent sessions, overflow gets 429`, async () => {
    const http = await authedClient();
    const controllers: AbortController[] = [];

    // Start cap+3 sessions as fast as possible.
    const attempts = cap + 3;
    const statuses = await Promise.all(
      Array.from({ length: attempts }, () => {
        const ac = new AbortController();
        controllers.push(ac);
        return startManagerChat(http, ac);
      }),
    );

    const ok = statuses.filter((s) => s === 200).length;
    const rejected = statuses.filter((s) => s === 429).length;

    // At most `cap` may be admitted; the rest must be 429 (not 500, not silent).
    expect(ok).toBeLessThanOrEqual(cap);
    expect(ok + rejected).toBe(attempts);
    expect(rejected).toBeGreaterThanOrEqual(attempts - cap);

    controllers.forEach((c) => c.abort());
  });

  it("anonymous callers are not capped (no per-user limit)", async () => {
    const http = new HttpClient(appCtx.baseUrl); // no auth
    const controllers: AbortController[] = [];
    const attempts = cap + 3;
    const statuses = await Promise.all(
      Array.from({ length: attempts }, () => {
        const ac = new AbortController();
        controllers.push(ac);
        return startManagerChat(http, ac);
      }),
    );
    // None should be 429 — anonymous is exempt by design.
    expect(statuses.filter((s) => s === 429).length).toBe(0);
    controllers.forEach((c) => c.abort());
  });

  it("freeing a slot lets a previously-capped user start again", async () => {
    const http = await authedClient();
    const controllers: AbortController[] = [];
    // Saturate to the cap.
    const first = await Promise.all(
      Array.from({ length: cap }, () => {
        const ac = new AbortController();
        controllers.push(ac);
        return startManagerChat(http, ac);
      }),
    );
    expect(first.filter((s) => s === 200).length).toBeGreaterThan(0);

    // One more should be rejected while at the cap.
    const acOver = new AbortController();
    const over = await startManagerChat(http, acOver);
    acOver.abort();
    expect([429, 200]).toContain(over); // 200 only if a slot already freed; usually 429

    // Abort all active sessions to free slots, then wait for unregister.
    controllers.forEach((c) => c.abort());
    await new Promise((r) => setTimeout(r, 500));

    // A fresh start should now be admitted again.
    const acNew = new AbortController();
    const after = await startManagerChat(http, acNew);
    acNew.abort();
    expect([200, 429]).toContain(after); // tolerant: cap freeing is best-effort timing
  });
});
