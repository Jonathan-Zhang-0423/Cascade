import { beforeAll, afterAll, beforeEach, afterEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb, createAuthenticatedClient } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";
import { installAiMock, type AiMock } from "../_helpers/ai-mock";

/**
 * Rapid-fire stress — simulate an impatient user mashing buttons: same request
 * fired in tight succession, create/delete thrash, start-then-immediately-abort
 * sessions. The server must stay consistent and never 500; idempotent endpoints
 * must converge, and abort-before-first-token must clean up.
 */
describeIntegration("stress: rapid-fire user behavior", () => {
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
    ai = installAiMock({ text: "ok ".repeat(20), chunks: 10, perChunkDelayMs: 10 });
  });
  afterEach(() => ai.restore());

  it("double-submitting project creation converges to a single project", async () => {
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    // Fire the same create 10x back-to-back (double-click / retry storm).
    const results = await Promise.all(
      Array.from({ length: 10 }, () => http.post("/api/projects", { id, name: "Dbl" })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const list = await http.get("/api/projects");
    expect(list.body.projects.filter((p: any) => p.id === id).length).toBe(1);
  });

  it("rapid create→delete→create on the same id leaves a deterministic state", async () => {
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    for (let i = 0; i < 15; i++) {
      await http.post("/api/projects", { id, name: `v${i}` });
      await http.delete(`/api/projects/${id}`);
    }
    // Final create wins.
    const final = await http.post("/api/projects", { id, name: "final" });
    expect(final.status).toBe(200);
    const list = await http.get("/api/projects");
    expect(list.body.projects.filter((p: any) => p.id === id).length).toBe(1);
  });

  it("rapid message saves with the same clientIds never duplicate or 500", async () => {
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    await http.post("/api/projects", { id, name: "Msg" });
    const base = Array.from({ length: 10 }, (_, i) => ({
      clientId: `c${i}`,
      kind: "chat",
      role: "user",
      content: `m${i}`,
      seq: i,
      timestamp: Date.now(),
    }));
    // Fire 20 concurrent saves of the SAME 10 messages (autosave + manual save races).
    const results = await Promise.all(
      Array.from({ length: 20 }, () => http.post(`/api/projects/${id}/messages`, { messages: base })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const list = await http.get(`/api/projects/${id}/messages`);
    // clientId is the upsert key → exactly 10 rows regardless of save storms.
    expect(list.body.messages.length).toBe(10);
  });

  it("start-then-immediately-abort build sessions clean up and never wedge the project", async () => {
    const projectId = `p-${Math.random().toString(36).slice(2, 8)}`;
    // Mash "Build" then "Stop" 12 times rapidly.
    for (let i = 0; i < 12; i++) {
      const sessionId = `bs_${Math.random().toString(36).slice(2, 10)}`;
      const ac = new AbortController();
      const p = http
        .stream("POST", "/api/build-session", {
          body: {
            sessionId,
            mode: "direct",
            userMessage: "do it",
            userLang: "English",
            projectId,
            files: [{ path: "/project/index.html", content: "<html></html>" }],
          },
          signal: ac.signal,
        })
        .then((r) => r.body?.cancel().catch(() => {}))
        .catch(() => {});
      // Abort almost immediately.
      ac.abort();
      await p;
      // Explicit stop for good measure.
      await http.delete(`/api/build-session/${sessionId}`);
    }

    // After the thrash, there must be no *active* build session wedging the project.
    const active = await http.get(`/api/build-session/active/${projectId}`);
    expect(active.status).toBe(404);
  });

  it("rapid single-file saves (autosave-on-keystroke) preserve the last write", async () => {
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    await http.post("/api/projects", { id, name: "KeyStroke" });
    // 30 sequential saves as if typing; last content must win deterministically.
    for (let i = 0; i < 30; i++) {
      const res = await http.put(`/api/projects/${id}/files/single`, {
        path: "/project/app.ts",
        content: `keystroke-${i}`,
      });
      expect(res.status).toBe(200);
    }
    const files = await http.get(`/api/projects/${id}/files`);
    const f = files.body.files.find((x: any) => x.path === "/project/app.ts");
    expect(f.content).toBe("keystroke-29");
  });
});
