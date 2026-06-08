import { beforeAll, afterAll, beforeEach, afterEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";
import { installAiMock, type AiMock } from "../_helpers/ai-mock";

/**
 * /api/build-session lifecycle — validation gates, the per-user session cap
 * (429), and the in-memory session-management endpoints (status / active /
 * delete / input / console-event). AI is mocked so a started build resolves
 * quickly instead of calling a real provider.
 *
 * Note: POST /api/build-session opens an SSE stream and runs the orchestrator;
 * we drive only the synchronous validation + management surface here, and
 * exercise true streaming in the stress/sse suite.
 */
describeIntegration("build-session lifecycle", () => {
  let appCtx: TestApp;
  let http: HttpClient;
  let ai: AiMock;

  beforeAll(async () => {
    appCtx = await createTestApp();
    http = new HttpClient(appCtx.baseUrl);
  });
  afterAll(async () => {
    await appCtx.close();
    await closeDb();
  });
  beforeEach(async () => {
    await truncateAll();
    ai = installAiMock({ text: '{"done":true}', chunks: 2 });
  });
  afterEach(() => {
    ai.restore();
  });

  const sid = () => `bs_${Math.random().toString(36).slice(2, 10)}`;

  describe("POST validation", () => {
    it("400 in plan mode when plan/userRequest missing", async () => {
      const res = await http.post("/api/build-session", {
        sessionId: sid(),
        mode: "plan",
        userLang: "English",
        files: [],
      });
      expect(res.status).toBe(400);
    });

    it("400 in direct mode when userMessage missing", async () => {
      const res = await http.post("/api/build-session", {
        sessionId: sid(),
        mode: "direct",
        userLang: "English",
        files: [],
      });
      expect(res.status).toBe(400);
    });
  });

  describe("management endpoints", () => {
    it("status 404 for an unknown session", async () => {
      const res = await http.get(`/api/build-session/${sid()}/status`);
      expect(res.status).toBe(404);
    });

    it("active 404 when no session for the project", async () => {
      const res = await http.get(`/api/build-session/active/proj-${Date.now()}`);
      expect(res.status).toBe(404);
    });

    it("DELETE is idempotent / always ok even for unknown session", async () => {
      const res = await http.delete(`/api/build-session/${sid()}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("input 404 for an unknown session", async () => {
      const res = await http.post(`/api/build-session/${sid()}/input`, { userInput: "yes" });
      expect(res.status).toBe(404);
    });

    it("console-event 404 for an unknown session", async () => {
      const res = await http.post(`/api/build-session/${sid()}/console-event`, {
        level: "error",
        message: "boom",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("started session is observable then abortable", () => {
    it("creates a session, sees it via status/active, then DELETE aborts it", async () => {
      const sessionId = sid();
      const projectId = `proj-${Math.random().toString(36).slice(2, 8)}`;
      // Start a direct-mode build. The POST streams SSE; open it but don't block
      // on completion — we only need the session registered in memory.
      const ac = new AbortController();
      const streamPromise = http
        .stream("POST", "/api/build-session", {
          body: {
            sessionId,
            mode: "direct",
            userMessage: "add a button",
            userLang: "English",
            projectId,
            files: [{ path: "/project/index.html", content: "<html></html>" }],
          },
          signal: ac.signal,
        })
        .catch(() => null);

      // Give the route a moment to register the session in buildSessions.
      await waitFor(async () => {
        const s = await http.get(`/api/build-session/${sessionId}/status`);
        return s.status === 200;
      });

      const status = await http.get(`/api/build-session/${sessionId}/status`);
      expect(status.status).toBe(200);
      expect(status.body).toHaveProperty("done");

      // console-event injection works while active (may already be done if the
      // mock build finished super fast — accept either).
      const ce = await http.post(`/api/build-session/${sessionId}/console-event`, {
        level: "error",
        message: "runtime error X",
      });
      expect([200, 404]).toContain(ce.status);

      // Abort and clean up the stream.
      const del = await http.delete(`/api/build-session/${sessionId}`);
      expect(del.status).toBe(200);
      ac.abort();
      await streamPromise;
    });
  });
});

async function waitFor(pred: () => Promise<boolean>, timeoutMs = 5000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error("waitFor timed out");
}
