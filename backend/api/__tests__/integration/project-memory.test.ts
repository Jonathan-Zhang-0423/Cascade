import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import { describeIntegration, truncateAll, closeDb } from "../_helpers/db";

/**
 * Project memory storage: getProjectMemory / setProjectMemory upsert a reserved
 * projectSkills row, are idempotent, and enforce the char cap. Touches real
 * Postgres, so it runs under the integration project.
 */
describeIntegration("project memory storage", () => {
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function seedProject(id: string): Promise<void> {
    const { db } = await import("../../src/infra/db");
    const { projects } = await import("@cascade/database");
    await db.insert(projects).values({ id, name: "Mem Test" });
  }

  it("returns empty string when no memory exists", async () => {
    const { storage } = await import("../../src/infra/storage");
    const pid = `p-${Math.random().toString(36).slice(2, 10)}`;
    await seedProject(pid);
    expect(await storage.getProjectMemory(pid)).toBe("");
  });

  it("sets then reads memory back", async () => {
    const { storage } = await import("../../src/infra/storage");
    const pid = `p-${Math.random().toString(36).slice(2, 10)}`;
    await seedProject(pid);
    await storage.setProjectMemory(pid, "u1", "## Memory\n- uses Zustand store");
    expect(await storage.getProjectMemory(pid)).toContain("uses Zustand store");
  });

  it("upserts (second write replaces, no duplicate row)", async () => {
    const { storage } = await import("../../src/infra/storage");
    const pid = `p-${Math.random().toString(36).slice(2, 10)}`;
    await seedProject(pid);
    await storage.setProjectMemory(pid, "u1", "first");
    await storage.setProjectMemory(pid, "u1", "second");
    expect(await storage.getProjectMemory(pid)).toBe("second");

    // Exactly one reserved row.
    const { db } = await import("../../src/infra/db");
    const { projectSkills } = await import("@cascade/database");
    const { eq, and } = await import("drizzle-orm");
    const { PROJECT_MEMORY_NAME } = await import("../../src/infra/storage");
    const rows = await db.select().from(projectSkills)
      .where(and(eq(projectSkills.projectId, pid), eq(projectSkills.name, PROJECT_MEMORY_NAME)));
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe("memory");
  });

  it("enforces the char cap on write", async () => {
    const { storage, PROJECT_MEMORY_MAX } = await import("../../src/infra/storage");
    const pid = `p-${Math.random().toString(36).slice(2, 10)}`;
    await seedProject(pid);
    await storage.setProjectMemory(pid, "u1", "x".repeat(PROJECT_MEMORY_MAX + 5000));
    const got = await storage.getProjectMemory(pid);
    expect(got.length).toBe(PROJECT_MEMORY_MAX);
  });

  it("strips NUL bytes on write", async () => {
    const { storage } = await import("../../src/infra/storage");
    const pid = `p-${Math.random().toString(36).slice(2, 10)}`;
    await seedProject(pid);
    const NUL = String.fromCharCode(0);
    await storage.setProjectMemory(pid, "u1", `a${NUL}b${NUL}c`);
    expect(await storage.getProjectMemory(pid)).toBe("abc");
  });

  it("is a no-op for an empty projectId", async () => {
    const { storage } = await import("../../src/infra/storage");
    await storage.setProjectMemory("", "u1", "ignored");
    expect(await storage.getProjectMemory("")).toBe("");
  });

  it("update_project_memory tool persists + reflects on the session", async () => {
    const { buildBuilderTools } = await import("../../src/agent/tools/agent-tools");
    const { storage } = await import("../../src/infra/storage");
    const pid = `p-${Math.random().toString(36).slice(2, 10)}`;
    await seedProject(pid);

    const session: any = {
      id: "s1", aborted: false, files: new Map(), plan: { steps: [] },
      userRequest: "", userLang: "English", events: [], nextEventId: 1,
      done: false, sseWriters: new Set(), parts: [], status: { type: "idle" },
      projectId: pid, userId: "u1",
    };
    const { handlers } = buildBuilderTools(session, []);

    const res = (await handlers.update_project_memory({ content: "- learned: X" }, () => {})) as string;
    expect(res).toContain("Project memory updated");
    expect(await storage.getProjectMemory(pid)).toBe("- learned: X");
    expect(session.projectMemory).toBe("- learned: X"); // reflected in-session
  });

  it("update_project_memory tool reports unavailable without a project", async () => {
    const { buildBuilderTools } = await import("../../src/agent/tools/agent-tools");
    const session: any = {
      id: "s1", aborted: false, files: new Map(), plan: { steps: [] },
      userRequest: "", userLang: "English", events: [], nextEventId: 1,
      done: false, sseWriters: new Set(), parts: [], status: { type: "idle" },
    };
    const { handlers } = buildBuilderTools(session, []);
    const res = (await handlers.update_project_memory({ content: "x" }, () => {})) as string;
    expect(res).toContain("unavailable");
  });
});
