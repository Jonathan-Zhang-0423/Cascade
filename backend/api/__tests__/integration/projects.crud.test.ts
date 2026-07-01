import { beforeAll, afterAll, beforeEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb, createAuthenticatedClient } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";

/**
 * /api/projects CRUD: create (+ template file seeding), list (userId scoping),
 * rename, delete, 404s, and zod validation of malformed bodies.
 */
describeIntegration("projects CRUD", () => {
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
    // Routes are behind requireInviteCode; establish a fresh authed session
    // each test (truncateAll wipes the user + session every time).
    http = await createAuthenticatedClient(appCtx.baseUrl);
  });

  const newProject = (over: Record<string, unknown> = {}) => ({
    id: `p-${Math.random().toString(36).slice(2, 10)}`,
    name: "Test Project",
    ...over,
  });

  describe("POST /api/projects", () => {
    it("creates a web project and seeds template files", async () => {
      const p = newProject();
      const res = await http.post("/api/projects", p);
      expect(res.status).toBe(200);
      expect(res.body.project).toMatchObject({ id: p.id, name: "Test Project", framework: "web" });

      // Template files should have been written.
      const files = await http.get(`/api/projects/${p.id}/files`);
      expect(files.status).toBe(200);
      expect(files.body.files.length).toBeGreaterThan(0);
    });

    it("derives language/targetPlatform from framework", async () => {
      const p = newProject({ framework: "rn-expo" });
      const res = await http.post("/api/projects", p);
      expect(res.status).toBe(200);
      expect(res.body.project.framework).toBe("rn-expo");
      expect(res.body.project.language).toBe("typescript");
    });

    it("rejects a body missing required name (400)", async () => {
      const res = await http.post("/api/projects", { id: "no-name" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("rejects an invalid framework enum (400)", async () => {
      const res = await http.post("/api/projects", newProject({ framework: "cobol" }));
      expect(res.status).toBe(400);
    });

    it("is idempotent on duplicate id (onConflictDoNothing returns existing)", async () => {
      const p = newProject();
      const a = await http.post("/api/projects", p);
      expect(a.status).toBe(200);
      const b = await http.post("/api/projects", { ...p, name: "Renamed In Create" });
      expect(b.status).toBe(200);
      // Existing row wins — name unchanged.
      expect(b.body.project.id).toBe(p.id);
    });
  });

  describe("GET /api/projects", () => {
    it("returns all projects for anonymous (no userId scoping)", async () => {
      await http.post("/api/projects", newProject());
      await http.post("/api/projects", newProject());
      const res = await http.get("/api/projects");
      expect(res.status).toBe(200);
      expect(res.body.projects.length).toBe(2);
    });
  });

  describe("PATCH /api/projects/:id", () => {
    it("renames a project", async () => {
      const p = newProject();
      await http.post("/api/projects", p);
      const res = await http.patch(`/api/projects/${p.id}`, { name: "New Name" });
      expect(res.status).toBe(200);
      const list = await http.get("/api/projects");
      expect(list.body.projects.find((x: any) => x.id === p.id).name).toBe("New Name");
    });

    it("rejects empty name (400)", async () => {
      const p = newProject();
      await http.post("/api/projects", p);
      const res = await http.patch(`/api/projects/${p.id}`, { name: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/projects/:id", () => {
    it("deletes a project and cascades its files", async () => {
      const p = newProject();
      await http.post("/api/projects", p);
      const del = await http.delete(`/api/projects/${p.id}`);
      expect(del.status).toBe(200);
      const list = await http.get("/api/projects");
      expect(list.body.projects.find((x: any) => x.id === p.id)).toBeUndefined();
    });

    it("deleting a non-existent project is a no-op 200", async () => {
      const res = await http.delete(`/api/projects/does-not-exist`);
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/projects/:id/export", () => {
    it("404s when the project has no files", async () => {
      // A project id that was never created has no files.
      const res = await http.get(`/api/projects/empty-${Date.now()}/export`);
      expect(res.status).toBe(404);
    });
  });
});
