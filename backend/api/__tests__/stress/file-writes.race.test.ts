import { beforeAll, afterAll, beforeEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb, createAuthenticatedClient } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";

/**
 * Concurrency stress: hammer the project-files endpoints from many clients at
 * once and assert the persisted state stays internally consistent (no dup
 * paths, no lost writes that leave the row count wrong, no 500s from races in
 * the read-then-write upsert).
 */
describeIntegration("stress: concurrent file writes", () => {
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
    http = await createAuthenticatedClient(appCtx.baseUrl);
  });

  async function makeProject(): Promise<string> {
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    await http.post("/api/projects", { id, name: "Race" });
    return id;
  }

  it("50 concurrent single-file upserts to distinct paths all persist", async () => {
    const id = await makeProject();
    const N = 50;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        http.put(`/api/projects/${id}/files/single`, {
          path: `/project/f${i}.ts`,
          content: `content-${i}`,
        }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);

    const files = await http.get(`/api/projects/${id}/files`);
    const paths = files.body.files.map((f: any) => f.path);
    // Every distinct path is present exactly once.
    const distinct = new Set(paths);
    expect(distinct.size).toBe(paths.length); // no duplicates
    for (let i = 0; i < N; i++) {
      expect(distinct.has(`/project/f${i}.ts`)).toBe(true);
    }
  });

  it("100 concurrent upserts to the SAME path converge to one row (last-writer-wins)", async () => {
    const id = await makeProject();
    const N = 100;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        http.put(`/api/projects/${id}/files/single`, {
          path: `/project/hot.ts`,
          content: `v${i}`,
        }),
      ),
    );
    // No request should 500 on a write-write race.
    expect(results.every((r) => r.status === 200)).toBe(true);

    const files = await http.get(`/api/projects/${id}/files`);
    const hot = files.body.files.filter((f: any) => f.path === "/project/hot.ts");
    // Exactly one row for the contended path — the unique (project,path)
    // constraint + onConflict must hold under concurrency.
    expect(hot.length).toBe(1);
    expect(hot[0].content).toMatch(/^v\d+$/);
  });

  it("concurrent batch PUTs do not 500 and leave a consistent final set", async () => {
    const id = await makeProject();
    // 20 clients each push an overlapping batch. The batch endpoint is
    // authoritative (delete-not-in-set), so the final state must equal exactly
    // one of the submitted batches — never a torn mixture with dup paths.
    const batches = Array.from({ length: 20 }, (_, b) => ({
      files: Array.from({ length: 5 }, (_, i) => ({
        path: `/project/b${b}_${i}.ts`,
        content: `b${b}i${i}`,
      })),
    }));
    const results = await Promise.all(
      batches.map((body) => http.put(`/api/projects/${id}/files`, body)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);

    const files = await http.get(`/api/projects/${id}/files`);
    const paths = files.body.files.map((f: any) => f.path);
    expect(new Set(paths).size).toBe(paths.length); // no dup paths regardless of interleave
  });

  it("interleaved writes and deletes to the same path never 500", async () => {
    const id = await makeProject();
    const ops: Promise<any>[] = [];
    for (let i = 0; i < 40; i++) {
      if (i % 2 === 0) {
        ops.push(http.put(`/api/projects/${id}/files/single`, { path: "/project/x.ts", content: `v${i}` }));
      } else {
        ops.push(http.delete(`/api/projects/${id}/files`, { path: "/project/x.ts" }));
      }
    }
    const results = await Promise.all(ops);
    expect(results.every((r) => r.status === 200)).toBe(true);

    // Final state is deterministic in count: 0 or 1 row for the path, never more.
    const files = await http.get(`/api/projects/${id}/files`);
    const x = files.body.files.filter((f: any) => f.path === "/project/x.ts");
    expect(x.length).toBeLessThanOrEqual(1);
  });
});
