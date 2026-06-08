import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import { describeIntegration, truncateAll, closeDb, hasTestDb } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";

/**
 * Harness smoke test — proves the test app boots, routes are mounted, the DB is
 * reachable and truncatable, and the http client works. If this fails, every
 * other integration suite is suspect.
 */
describeIntegration("harness smoke", () => {
  let appCtx: TestApp;
  let http: HttpClient;

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
  });

  it("serves /api/providers", async () => {
    const res = await http.get("/api/providers");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("doubao");
  });

  it("serves /api/concurrency metrics", async () => {
    const res = await http.get("/api/concurrency");
    expect(res.status).toBe(200);
    expect(res.body.aiCalls).toBeDefined();
    expect(res.body.limits).toBeDefined();
  });

  it("can write and read the DB through a route", async () => {
    const id = `smoke-${Date.now()}`;
    const create = await http.post("/api/projects", { id, name: "Smoke Project" });
    expect(create.status).toBe(200);
    expect(create.body.project.id).toBe(id);

    const list = await http.get("/api/projects");
    expect(list.status).toBe(200);
    expect(list.body.projects.some((p: any) => p.id === id)).toBe(true);
  });

  it("truncateAll isolates tests (previous project is gone)", async () => {
    const list = await http.get("/api/projects");
    expect(list.body.projects).toHaveLength(0);
  });
});

if (!hasTestDb) {
  it("integration tests skipped (no TEST_DATABASE_URL)", () => {
    expect(true).toBe(true);
  });
}
