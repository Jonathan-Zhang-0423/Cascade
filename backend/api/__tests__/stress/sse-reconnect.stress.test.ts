import { beforeAll, afterAll, beforeEach, afterEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb, createAuthenticatedClient } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";
import { installAiMock, type AiMock } from "../_helpers/ai-mock";
import { collectSse, eventIds } from "../_helpers/sse";

/**
 * SSE reconnect/replay stress. A client that drops mid-stream must be able to
 * reconnect to /stream?lastEventId=N and receive exactly the events after N —
 * no gaps (lost events) and no overlap (duplicates). This is the core
 * reconnect contract that useManagerStream / useBuildStream rely on.
 *
 * We drive a real manager-chat session (AI mocked, slow stream), abort the
 * first reader partway, then reconnect repeatedly and stitch the event ids.
 */
describeIntegration("stress: SSE reconnect + replay", () => {
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
    // A long-ish, slow stream so we can reliably interrupt it mid-flight.
    ai = installAiMock({ text: "lorem ipsum ".repeat(60), chunks: 60, perChunkDelayMs: 25 });
  });
  afterEach(() => ai.restore());

  async function startSession(projectId: string): Promise<string> {
    const ac = new AbortController();
    await http.post("/api/projects", { id: projectId, name: "Reconnect Test" });
    // Kick off the producer; we don't read it here (a separate /stream reader
    // consumes events). Abort immediately — the session keeps running server-side.
    http
      .stream("POST", "/api/manager-chat", {
        body: { messages: [{ role: "user", content: "build a thing" }], files: [], projectId },
        signal: ac.signal,
      })
      .then((res) => res.body?.cancel().catch(() => {}))
      .catch(() => {});

    // Wait for the session to be registered and resolve its id.
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const r = await http.get(`/api/manager-chat/active/${projectId}?chatSessionId=main`);
      if (r.status === 200 && r.body.sessionId) {
        ac.abort();
        return r.body.sessionId;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    ac.abort();
    throw new Error("session never became active");
  }

  it("reconnect after a mid-stream drop yields a contiguous, gap-free event id sequence", async () => {
    const projectId = `p-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = await startSession(projectId);

    const seen: number[] = [];
    let lastId = -1;
    let reconnects = 0;
    const overallDeadline = Date.now() + 20_000;

    // Loop: connect, read a few events, drop, reconnect with lastEventId.
    while (Date.now() < overallDeadline) {
      const res = await http.stream("GET", `/api/manager-chat/${sessionId}/stream?lastEventId=${lastId}`);
      // Read only a handful of events, then drop the connection to simulate a flaky network.
      const chunk = await collectSse(res, {
        timeoutMs: 4000,
        until: (_ev, all) => all.length >= 5,
      });
      for (const ev of chunk) {
        const id = ev?.data?.eventId;
        if (typeof id === "number") {
          seen.push(id);
          lastId = Math.max(lastId, id);
        }
      }
      reconnects++;

      // Stop once the session reports done and we've drained the tail.
      const status = await http.get(`/api/manager-chat/${sessionId}/status`);
      if (status.body?.done) {
        // Final drain from lastId to the end.
        const tail = await http.stream("GET", `/api/manager-chat/${sessionId}/stream?lastEventId=${lastId}`);
        const tailEvents = await collectSse(tail, { timeoutMs: 4000 });
        for (const ev of tailEvents) {
          const id = ev?.data?.eventId;
          if (typeof id === "number") {
            seen.push(id);
            lastId = Math.max(lastId, id);
          }
        }
        break;
      }
      if (reconnects > 50) break; // safety
    }

    // Filter to numeric-id events actually delivered.
    const ids = seen.slice().sort((a, b) => a - b);
    expect(ids.length).toBeGreaterThan(0);

    // No duplicates: each eventId delivered at most once across all reconnects.
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);

    // No gaps: ids form a contiguous run from the min to the max observed.
    const min = ids[0];
    const max = ids[ids.length - 1];
    expect(max - min + 1).toBe(ids.length);
  });

  it("reconnecting with lastEventId at the head replays the full event history", async () => {
    const projectId = `p-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = await startSession(projectId);

    // Let the session run to completion.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const s = await http.get(`/api/manager-chat/${sessionId}/status`);
      if (s.body?.done) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // A brand-new client (lastEventId=-1) must receive the entire history.
    const res = await http.stream("GET", `/api/manager-chat/${sessionId}/stream?lastEventId=-1`);
    const all = await collectSse(res, { timeoutMs: 5000 });
    const ids = eventIds(all);
    expect(ids.length).toBeGreaterThan(0);
    // Replayed ids are strictly increasing and contiguous from 0.
    expect(ids[0]).toBe(0);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBe(ids[i - 1] + 1);
    }
  });

  it("a malformed lastEventId is treated as a full replay, not a crash", async () => {
    const projectId = `p-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = await startSession(projectId);
    // Wait for done.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const s = await http.get(`/api/manager-chat/${sessionId}/status`);
      if (s.body?.done) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const res = await http.stream("GET", `/api/manager-chat/${sessionId}/stream?lastEventId=not-a-number`);
    expect(res.status).toBe(200);
    const all = await collectSse(res, { timeoutMs: 5000 });
    // Garbage parses to NaN → treated as -1 → full replay from the start.
    expect(eventIds(all).length).toBeGreaterThan(0);
  });
});
