import { beforeAll, afterAll, beforeEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb, createAuthenticatedClient } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";

/**
 * /api/projects/:id/messages — server-side field sanitization (drops entries
 * missing clientId / bad kind / non-finite seq), idempotent upsert by clientId,
 * seq-ordered pagination with limit clamping, and afterSeq deletion edges.
 */
describeIntegration("project messages", () => {
  let appCtx: TestApp;
  let http: HttpClient;

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
    http = await createAuthenticatedClient(appCtx.baseUrl);
  });

  async function makeProject(): Promise<string> {
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    await http.post("/api/projects", { id, name: "Msg Test" });
    return id;
  }

  const msg = (over: Record<string, unknown> = {}) => ({
    clientId: `c-${Math.random().toString(36).slice(2, 10)}`,
    kind: "chat",
    role: "user",
    content: "hello",
    seq: 1,
    timestamp: Date.now(),
    ...over,
  });

  it("404s for an unknown project", async () => {
    const res = await http.post(`/api/projects/nope/messages`, { messages: [msg()] });
    expect(res.status).toBe(404);
  });

  it("rejects a non-array messages field (400)", async () => {
    const id = await makeProject();
    const res = await http.post(`/api/projects/${id}/messages`, { messages: "not-array" });
    expect(res.status).toBe(400);
  });

  it("persists valid messages and returns the saved count", async () => {
    const id = await makeProject();
    const res = await http.post(`/api/projects/${id}/messages`, {
      messages: [msg({ seq: 1 }), msg({ seq: 2 })],
    });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);

    const list = await http.get(`/api/projects/${id}/messages`);
    expect(list.body.messages.length).toBe(2);
  });

  it("drops malformed entries (missing clientId, bad kind, non-finite seq)", async () => {
    const id = await makeProject();
    const res = await http.post(`/api/projects/${id}/messages`, {
      messages: [
        msg({ seq: 1 }), // valid
        { ...msg({ seq: 2 }), clientId: "" }, // dropped: empty clientId
        { ...msg({ seq: 3 }), kind: "weird" }, // dropped: bad kind
        { ...msg(), seq: Number.NaN }, // dropped: non-finite seq
        { ...msg(), seq: Infinity }, // dropped: non-finite seq
        { ...msg({ seq: 9 }), timestamp: "soon" }, // dropped: non-numeric ts
        "garbage", // dropped: not an object
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1); // only the first survives
  });

  it("coerces missing content to empty string rather than rejecting", async () => {
    const id = await makeProject();
    const res = await http.post(`/api/projects/${id}/messages`, {
      messages: [{ clientId: "x1", kind: "chat", role: "user", seq: 1, timestamp: Date.now() }],
    });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it("upsert by clientId is idempotent (re-send updates, not duplicates)", async () => {
    const id = await makeProject();
    const m = msg({ clientId: "fixed", seq: 1, content: "v1" });
    await http.post(`/api/projects/${id}/messages`, { messages: [m] });
    await http.post(`/api/projects/${id}/messages`, { messages: [{ ...m, content: "v2", seq: 5 }] });

    const list = await http.get(`/api/projects/${id}/messages`);
    expect(list.body.messages.length).toBe(1);
    expect(list.body.messages[0].content).toBe("v2");
    expect(list.body.messages[0].seq).toBe(5);
  });

  it("returns messages in ascending seq order", async () => {
    const id = await makeProject();
    await http.post(`/api/projects/${id}/messages`, {
      messages: [msg({ clientId: "c3", seq: 3 }), msg({ clientId: "c1", seq: 1 }), msg({ clientId: "c2", seq: 2 })],
    });
    const list = await http.get(`/api/projects/${id}/messages`);
    expect(list.body.messages.map((m: any) => m.seq)).toEqual([1, 2, 3]);
  });

  it("filters by kind when ?kind= is given", async () => {
    const id = await makeProject();
    await http.post(`/api/projects/${id}/messages`, {
      messages: [msg({ clientId: "a", kind: "chat", seq: 1 }), msg({ clientId: "b", kind: "manager", seq: 2 })],
    });
    const chat = await http.get(`/api/projects/${id}/messages?kind=chat`);
    expect(chat.body.messages.every((m: any) => m.kind === "chat")).toBe(true);
  });

  describe("DELETE ?afterSeq", () => {
    it("deletes messages with seq > afterSeq", async () => {
      const id = await makeProject();
      await http.post(`/api/projects/${id}/messages`, {
        messages: [1, 2, 3, 4].map((n) => msg({ clientId: `c${n}`, seq: n })),
      });
      const del = await http.delete(`/api/projects/${id}/messages?afterSeq=2`);
      expect(del.status).toBe(200);
      const list = await http.get(`/api/projects/${id}/messages`);
      expect(list.body.messages.map((m: any) => m.seq)).toEqual([1, 2]);
    });

    it("rejects a non-finite afterSeq (400)", async () => {
      const id = await makeProject();
      const res = await http.delete(`/api/projects/${id}/messages?afterSeq=abc`);
      expect(res.status).toBe(400);
    });

    it("404s for unknown project", async () => {
      const res = await http.delete(`/api/projects/nope/messages?afterSeq=1`);
      expect(res.status).toBe(404);
    });
  });
});
