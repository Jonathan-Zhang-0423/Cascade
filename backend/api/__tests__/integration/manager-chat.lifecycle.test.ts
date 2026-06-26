import { beforeAll, afterAll, beforeEach, afterEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb, createAuthenticatedClient } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";
import { installAiMock, type AiMock } from "../_helpers/ai-mock";

/**
 * /api/manager-chat lifecycle — request validation, and the in-memory session
 * status/active endpoints. AI is mocked so the planning stream resolves without
 * a real provider.
 */
describeIntegration("manager-chat lifecycle", () => {
  let appCtx: TestApp;
  let http: HttpClient;
  let ai: AiMock;

  beforeAll(async () => {
    appCtx = await createTestApp();
  });
  afterAll(async () => {
    await appCtx.close();
    await closeDb();
  });
  beforeEach(async () => {
    await truncateAll();
    http = await createAuthenticatedClient(appCtx.baseUrl);
    ai = installAiMock({
      // A minimal plan-ish payload; the route tolerates loose JSON.
      text: '{"summary":"do it","steps":[{"step":1,"title":"step","description":"d"}]}',
      chunks: 3,
    });
  });
  afterEach(() => {
    ai.restore();
  });

  describe("POST validation", () => {
    it("400 when messages array is missing", async () => {
      const res = await http.post("/api/manager-chat", { files: [] });
      expect(res.status).toBe(400);
    });

    it("400 when messages array is empty", async () => {
      const res = await http.post("/api/manager-chat", { messages: [] });
      expect(res.status).toBe(400);
    });
  });

  describe("management endpoints", () => {
    it("status 404 for an unknown session", async () => {
      const res = await http.get(`/api/manager-chat/mgr_unknown/status`);
      expect(res.status).toBe(404);
    });

    it("active 404 when no session for the project", async () => {
      const res = await http.get(`/api/manager-chat/active/proj-${Date.now()}`);
      expect(res.status).toBe(404);
    });
  });

  describe("started planning session is observable", () => {
    it("starts a manager-chat and finds it via active/:projectId", async () => {
      const projectId = `proj-${Math.random().toString(36).slice(2, 8)}`;
      const ac = new AbortController();
      const streamPromise = http
        .stream("POST", "/api/manager-chat", {
          body: {
            messages: [{ role: "user", content: "build me a todo app" }],
            files: [],
            projectId,
          },
          signal: ac.signal,
        })
        .catch(() => null);

      // The session should appear (active or done) shortly after start.
      await waitFor(async () => {
        const r = await http.get(`/api/manager-chat/active/${projectId}`);
        return r.status === 200;
      });

      const active = await http.get(`/api/manager-chat/active/${projectId}`);
      expect(active.status).toBe(200);
      expect(active.body.sessionId).toBeDefined();

      // Per-session status endpoint resolves the same session.
      const status = await http.get(`/api/manager-chat/${active.body.sessionId}/status`);
      expect(status.status).toBe(200);
      expect(status.body).toHaveProperty("done");

      ac.abort();
      await streamPromise;
    });
  });
});

async function waitFor(pred: () => Promise<boolean>, timeoutMs = 8000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error("waitFor timed out");
}
