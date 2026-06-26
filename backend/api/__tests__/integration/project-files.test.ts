import { beforeAll, afterAll, beforeEach, expect, it, describe } from "vitest";
import { describeIntegration, truncateAll, closeDb, createAuthenticatedClient } from "../_helpers/db";
import { createTestApp, type TestApp } from "../_helpers/app-factory";
import { HttpClient } from "../_helpers/http-client";

/**
 * /api/projects/:id/files — the batch upsert (insert/update/delete three-state),
 * single-file upsert, delete, the non-web "corrupted project self-repair"
 * branch in GET /files, and body-size / special-path edges.
 */
describeIntegration("project files", () => {
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

  async function makeProject(over: Record<string, unknown> = {}): Promise<string> {
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    const res = await http.post("/api/projects", { id, name: "Files Test", ...over });
    expect(res.status).toBe(200);
    return id;
  }

  async function getPaths(id: string): Promise<string[]> {
    const r = await http.get(`/api/projects/${id}/files`);
    return r.body.files.map((f: any) => f.path).sort();
  }

  describe("PUT /files (batch upsert)", () => {
    it("inserts, updates, and deletes to converge on the provided set", async () => {
      const id = await makeProject();
      // Start fresh: overwrite the template with our own set.
      await http.put(`/api/projects/${id}/files`, {
        files: [
          { path: "/project/a.ts", content: "a1" },
          { path: "/project/b.ts", content: "b1" },
        ],
      });
      expect(await getPaths(id)).toEqual(["/project/a.ts", "/project/b.ts"]);

      // Update a, keep b, add c → the batch is authoritative, so anything not
      // in the set is deleted. Provide a (changed), b (same), c (new).
      await http.put(`/api/projects/${id}/files`, {
        files: [
          { path: "/project/a.ts", content: "a2" },
          { path: "/project/b.ts", content: "b1" },
          { path: "/project/c.ts", content: "c1" },
        ],
      });
      expect(await getPaths(id)).toEqual(["/project/a.ts", "/project/b.ts", "/project/c.ts"]);

      const after = await http.get(`/api/projects/${id}/files`);
      const a = after.body.files.find((f: any) => f.path === "/project/a.ts");
      expect(a.content).toBe("a2");
    });

    it("rejects malformed body (missing files array) with 400", async () => {
      const id = await makeProject();
      const res = await http.put(`/api/projects/${id}/files`, { nope: true });
      expect(res.status).toBe(400);
    });

    it("rejects file entries with empty path (400)", async () => {
      const id = await makeProject();
      const res = await http.put(`/api/projects/${id}/files`, {
        files: [{ path: "", content: "x" }],
      });
      expect(res.status).toBe(400);
    });

    it("handles a large file body (~2MB) under the 10MB limit", async () => {
      const id = await makeProject();
      const big = "x".repeat(2 * 1024 * 1024);
      const res = await http.put(`/api/projects/${id}/files`, {
        files: [{ path: "/project/big.txt", content: big }],
      });
      expect(res.status).toBe(200);
      const files = await http.get(`/api/projects/${id}/files`);
      expect(files.body.files.find((f: any) => f.path === "/project/big.txt").content.length).toBe(big.length);
    });

    it("accepts paths with unicode / special characters", async () => {
      const id = await makeProject();
      const weird = "/project/文件 (1)/💡.tsx";
      const res = await http.put(`/api/projects/${id}/files`, {
        files: [{ path: weird, content: "ok" }],
      });
      expect(res.status).toBe(200);
      expect(await getPaths(id)).toContain(weird);
    });

    it("an empty files array deletes everything", async () => {
      const id = await makeProject();
      await http.put(`/api/projects/${id}/files`, { files: [{ path: "/project/x.ts", content: "1" }] });
      await http.put(`/api/projects/${id}/files`, { files: [] });
      expect(await getPaths(id)).toEqual([]);
    });
  });

  describe("PUT /files/single", () => {
    it("inserts then updates one file without touching others", async () => {
      const id = await makeProject();
      await http.put(`/api/projects/${id}/files`, {
        files: [{ path: "/project/keep.ts", content: "keep" }],
      });
      await http.put(`/api/projects/${id}/files/single`, { path: "/project/one.ts", content: "v1" });
      await http.put(`/api/projects/${id}/files/single`, { path: "/project/one.ts", content: "v2" });

      const files = await http.get(`/api/projects/${id}/files`);
      expect(files.body.files.find((f: any) => f.path === "/project/one.ts").content).toBe("v2");
      expect(files.body.files.find((f: any) => f.path === "/project/keep.ts")).toBeTruthy();
    });

    it("rejects missing path (400)", async () => {
      const id = await makeProject();
      const res = await http.put(`/api/projects/${id}/files/single`, { content: "x" });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /files", () => {
    it("removes a single file by path", async () => {
      const id = await makeProject();
      await http.put(`/api/projects/${id}/files`, {
        files: [
          { path: "/project/a.ts", content: "a" },
          { path: "/project/b.ts", content: "b" },
        ],
      });
      const res = await http.delete(`/api/projects/${id}/files`, { path: "/project/a.ts" });
      expect(res.status).toBe(200);
      expect(await getPaths(id)).toEqual(["/project/b.ts"]);
    });

    it("rejects missing path (400)", async () => {
      const id = await makeProject();
      const res = await http.delete(`/api/projects/${id}/files`, {});
      expect(res.status).toBe(400);
    });
  });

  describe("GET /files self-repair", () => {
    it("replaces stale web-only files with the framework template for a non-web project", async () => {
      // Create a non-web project, then corrupt it to contain only web signature files.
      const id = await makeProject({ framework: "rn-expo" });
      await http.put(`/api/projects/${id}/files`, {
        files: [
          { path: "/project/index.html", content: "<html></html>" },
          { path: "/project/style.css", content: "" },
          { path: "/project/app.js", content: "" },
        ],
      });
      // GET should detect the corruption and swap in the rn-expo template.
      const res = await http.get(`/api/projects/${id}/files`);
      expect(res.status).toBe(200);
      const paths = res.body.files.map((f: any) => f.path);
      // Web signature files should be gone; template files present.
      expect(paths).not.toContain("/project/index.html");
      expect(res.body.files.length).toBeGreaterThan(0);
    });
  });
});
