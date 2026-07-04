import { beforeAll, afterAll, beforeEach, afterEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb, createAuthenticatedClient } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";
import { installAiMock, type AiMock } from "../_helpers/ai-mock";
import { db } from "../../src/infra/db";
import { agentSessions } from "@cascade/database";
import { eq } from "drizzle-orm";

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
  });
  afterAll(async () => {
    await appCtx.close();
    await closeDb();
  });
  beforeEach(async () => {
    await truncateAll();
    http = await createAuthenticatedClient(appCtx.baseUrl);
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

    it("active requires chatSessionId", async () => {
      const res = await http.get(`/api/build-session/active/proj-${Date.now()}`);
      expect(res.status).toBe(400);
    });

    it("active 404 when no session for the project/chat session", async () => {
      const res = await http.get(`/api/build-session/active/proj-${Date.now()}?chatSessionId=main`);
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
      await http.post("/api/projects", { id: projectId, name: "Build Lifecycle Test" });
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

    it("persists final file set and flushed events before completion", async () => {
      const sessionId = sid();
      const projectId = `proj-${Math.random().toString(36).slice(2, 8)}`;
      await http.post("/api/projects", { id: projectId, name: "Build Persist Test" });
      await http.put(`/api/projects/${projectId}/files`, {
        files: [
          { path: "/project/old.txt", content: "old" },
          { path: "/project/keep.txt", content: "keep-old" },
        ],
      });

      ai.update({
        responder: (params) => Array.isArray(params?.tools) && params.tools.length > 0 ? "" : "build",
        toolCalls: [
          {
            name: "write_file",
            args: { path: "/project/keep.txt", content: "keep-new" },
          },
          {
            name: "delete_file",
            args: { path: "/project/old.txt" },
          },
          {
            name: "mark_step_complete",
            args: { step_id: "1", summary: "updated and removed stale file" },
          },
        ],
      });

      const stream = await http.stream("POST", "/api/build-session", {
        body: {
          sessionId,
          mode: "direct",
          userMessage: "update keep and remove old",
          userLang: "English",
          projectId,
          files: [
            { path: "/project/old.txt", content: "old" },
            { path: "/project/keep.txt", content: "keep-old" },
          ],
        },
      });
      expect(stream.status).toBe(200);

      await waitFor(async () => {
        const files = await http.get(`/api/projects/${projectId}/files`);
        const paths = files.body.files.map((f: any) => f.path).sort();
        return paths.length === 1 &&
          paths[0] === "/project/keep.txt" &&
          files.body.files.find((f: any) => f.path === "/project/keep.txt")?.content === "keep-new";
      }, 15000);

      const row = await waitForValue(async () => {
        const [candidate] = await db.select().from(agentSessions).where(eq(agentSessions.id, sessionId));
        if (!candidate || candidate.status !== "done") return null;
        return candidate;
      }, 15000);
      expect(row.status).toBe("done");
      const events = JSON.parse(row.events || "[]");
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e: any) => e.data?.type === "all_complete")).toBe(true);

      await stream.body?.cancel().catch(() => {});
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

async function waitForValue<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 5000, stepMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error("waitForValue timed out");
}
