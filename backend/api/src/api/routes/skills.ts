import type { Express } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from "fs";
import { join, basename } from "path";
import { db } from "../../infra/db";
import { userSkills, projectSkills, insertUserSkillSchema, insertProjectSkillSchema } from "@cascade/database";
import { srcDir } from "../../infra/paths";

/**
 * Skills routes (Step C). User skills CRUD, project skills CRUD, and the
 * builtin skills listing. All self-contained — no closure state dependencies.
 */
export function registerSkillsRoutes(app: Express): void {
  // === SKILLS API ===

  // User Skills
  app.get("/api/skills/user", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const skills = await db.select().from(userSkills).where(eq(userSkills.userId, userId));
      res.json(skills);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/skills/user", async (req, res) => {
    try {
      const userId = req.body?.userId as string;
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const { name, description, type, content, enabled } = req.body;
      const parsed = insertUserSkillSchema.safeParse({ userId, name, description, type, content, enabled });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
      const [created] = await db.insert(userSkills).values(parsed.data).returning();
      res.status(201).json(created);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put("/api/skills/user/:id", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const { name, description, type, content, enabled } = req.body;
      const updateData = { name, description, type, content, enabled };
      const cleanUpdate = Object.fromEntries(Object.entries(updateData).filter(([, v]) => v !== undefined));
      if (Object.keys(cleanUpdate).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }
      const [updated] = await db
        .update(userSkills)
        .set(cleanUpdate)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/skills/user/:id", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const [deleted] = await db
        .delete(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .returning();
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.status(204).end();
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Project Skills
  app.get("/api/skills/project/:projectId", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const skills = await db
        .select()
        .from(projectSkills)
        .where(and(eq(projectSkills.projectId, req.params.projectId), eq(projectSkills.userId, userId)));
      res.json(skills);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/skills/project/:projectId", async (req, res) => {
    try {
      const userId = req.body?.userId as string;
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const { name, description, type, content, enabled } = req.body;
      const parsed = insertProjectSkillSchema.safeParse({
        projectId: req.params.projectId,
        userId,
        name,
        description,
        type,
        content,
        enabled,
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
      const [created] = await db.insert(projectSkills).values(parsed.data).returning();
      res.status(201).json(created);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put("/api/skills/project/:projectId/:id", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const { name, description, type, content, enabled } = req.body;
      const updateData = { name, description, type, content, enabled };
      const cleanUpdate = Object.fromEntries(Object.entries(updateData).filter(([, v]) => v !== undefined));
      if (Object.keys(cleanUpdate).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }
      const [updated] = await db
        .update(projectSkills)
        .set(cleanUpdate)
        .where(
          and(
            eq(projectSkills.id, id),
            eq(projectSkills.projectId, req.params.projectId),
            eq(projectSkills.userId, userId),
          ),
        )
        .returning();
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/skills/project/:projectId/:id", async (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (!userId) return res.status(400).json({ error: "userId is required" });
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "id must be a number" });
      const [deleted] = await db
        .delete(projectSkills)
        .where(
          and(
            eq(projectSkills.id, id),
            eq(projectSkills.projectId, req.params.projectId),
            eq(projectSkills.userId, userId),
          ),
        )
        .returning();
      if (!deleted) return res.status(404).json({ error: "Not found" });
      res.status(204).end();
    } catch (err) {
      console.error("[SkillsAPI]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // === BUILTIN SKILLS ===

  app.get("/api/skills/builtin", (_req, res) => {
    try {
      const skillsDir = srcDir("skills", "builtin");
      const entries: Array<{ name: string; description: string; type: "knowledge" }> = [];

      const scanDir = (dir: string) => {
        if (!existsSync(dir)) return;
        for (const file of readdirSync(dir)) {
          const full = join(dir, file);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            if (file === "starters") continue; // skip internal seeding files
            scanDir(full);
            continue;
          }
          if (!file.endsWith(".md")) continue;
          const stem = file.replace(/\.md$/, "");
          // Use parent directory name when filename is a generic placeholder like "SKILL"
          const name = stem === "SKILL" ? basename(dir) : stem;
          // Read only first 200 bytes to find the heading — avoids loading full file
          const fd = openSync(full, "r");
          const buf = Buffer.alloc(200);
          const bytesRead = readSync(fd, buf, 0, 200, 0);
          closeSync(fd);
          const firstLine = buf.subarray(0, bytesRead).toString("utf-8").split("\n").find((l) => l.startsWith("# "));
          const description = firstLine ? firstLine.replace(/^#\s*/, "") : name;
          entries.push({ name, description, type: "knowledge" });
        }
      };

      scanDir(skillsDir);
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

}
