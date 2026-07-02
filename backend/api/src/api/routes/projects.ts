import type { Express } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import { eq, desc, count } from "drizzle-orm";
import archiver from "archiver";
import { db } from "../../infra/db";
import { storage } from "../../infra/storage";
import type { ChatMessageInput } from "../../infra/storage";
import { projects, chatMessages, chatSessions } from "@cascade/database";
import { insertProjectSchema } from "@cascade/database";
import { getTemplateFiles } from "../../compiler/templates/index";
import { detectFramework, getLanguageForFramework, getTargetPlatformForFramework, type Framework } from "../../compiler/framework-detector";
import { requireInviteCode } from "../middleware/auth-middleware";
import { getOptimalClient, getFastClient } from "../../agent/providers/kimi-client";
import { doubaoClient, DOUBAO_LITE_MODEL } from "../../agent/providers/doubao-client";

/**
 * Projects routes (Step C). CRUD, files, messages, sessions, export.
 * Depends on storage + db + compiler framework-detection. No closure state.
 */
export function registerProjectsRoutes(app: Express): void {
  app.get("/api/projects", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const allProjects = await storage.getProjects(userId);
      res.json({ projects: allProjects });
    } catch (error: any) {
      console.error("Get projects error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to get projects" });
    }
  });

  const createProjectSchema = insertProjectSchema;

  const updateProjectSchema = z.object({ name: z.string().min(1) });

  const projectFilesSchema = z.object({
    files: z.array(z.object({ path: z.string().min(1), content: z.string() })),
  });

  const singleFileSchema = z.object({ path: z.string().min(1), content: z.string() });

  const deleteFileSchema = z.object({ path: z.string().min(1) });

  app.post("/api/projects", requireInviteCode, async (req, res) => {
    try {
      const parsed = createProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const { id, name, emoji, framework: rawFramework } = parsed.data;
      const framework = (rawFramework || "web") as Framework;
      const language = getLanguageForFramework(framework);
      const targetPlatform = getTargetPlatformForFramework(framework);
      const userId = (req.session as any)?.userId as string | undefined;

      const project = await storage.createProject({
        id,
        name,
        emoji: emoji ?? null,
        framework,
        language,
        targetPlatform,
        userId: userId ?? undefined,
      });

      // Initialize files from template
      const templateFiles = getTemplateFiles(framework);
      if (templateFiles.length > 0) {
        await storage.upsertProjectFiles(
          id,
          templateFiles.map((f) => ({ path: f.path, content: f.content }))
        );
      }

      res.json({ project });

      // Auto-name the project based on the initial prompt (fire-and-forget,
      // server-side so it doesn't depend on frontend fetch surviving navigation).
      const initialPrompt = req.body.initialPrompt as string | undefined;
      if (initialPrompt && initialPrompt.trim()) {
        (async () => {
          try {
            const { client: nameClient, model: nameModel } = getFastClient();
            const isChinese = /[一-鿿]/.test(initialPrompt);
            const langInstruction = isChinese
              ? "用中文起名（2-4 个字或词），不要使用英文。"
              : "Use English (2-4 words, title case).";
            const frameworkHint = framework && framework !== "web" ? ` (${framework} app)` : "";
            const completion = await nameClient.chat.completions.create({
              model: nameModel,
              messages: [{
                role: "user",
                content: `Generate a short project name for this app idea${frameworkHint}. ${langInstruction}\n\n"${initialPrompt.slice(0, 200)}"\n\nRespond with ONLY the project name, nothing else.`,
              }],
              max_tokens: 20,
            });
            let generatedName = (completion.choices[0]?.message?.content ?? "").trim();
            // Strip <think>...</think> blocks that some models emit before the answer
            generatedName = generatedName.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
            // Strip quotes
            generatedName = generatedName.replace(/^["']|["']$/g, "");
            if (generatedName && generatedName !== name && !generatedName.includes("<")) {
              await storage.updateProjectName(id, generatedName);
              console.log(`[auto-name] project ${id}: "${name}" → "${generatedName}"`);
            }
          } catch (err) {
            console.warn("[auto-name] failed:", err instanceof Error ? err.message : err);
          }
        })();
      }
    } catch (error: any) {
      console.error("Create project error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to create project" });
    }
  });

  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const parsed = updateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await storage.updateProjectName(req.params.id, parsed.data.name);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Update project error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to update project" });
    }
  });

  app.get("/api/projects/:id/plan", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (!project.lastPlan) {
        res.json({ plan: null });
        return;
      }
      res.json({ plan: JSON.parse(project.lastPlan) });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to get plan" });
    }
  });

  app.get("/api/projects/:id/build-result", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (!project.lastBuildResult) {
        res.json({ result: null });
        return;
      }
      res.json({ result: JSON.parse(project.lastBuildResult) });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to get build result" });
    }
  });

  app.get("/api/projects/:id/messages", async (req, res) => {
    try {
      const projectId = req.params.id;
      const project = await storage.getProject(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const kindParam = String(req.query.kind ?? "");
      const kind = kindParam === "chat" || kindParam === "manager" ? kindParam : undefined;
      const beforeRaw = req.query.before;
      const before = typeof beforeRaw === "string" && beforeRaw.length > 0 ? Number(beforeRaw) : undefined;
      const limitRaw = req.query.limit;
      const limit = typeof limitRaw === "string" && limitRaw.length > 0 ? Number(limitRaw) : 100;
      // sessionId: 传了就过滤；"null" 字符串 = 主会话（sessionId IS NULL）；不传 = 全部
      const sessionIdRaw = req.query.sessionId;
      const sessionId = typeof sessionIdRaw === "string"
        ? (sessionIdRaw === "null" ? null : sessionIdRaw)
        : undefined;
      const rows = await storage.listChatMessages(projectId, {
        kind,
        before: Number.isFinite(before) ? (before as number) : undefined,
        limit: Number.isFinite(limit) ? limit : 100,
        sessionId,
      });
      res.json({ messages: rows });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to list messages" });
    }
  });

  app.post("/api/projects/:id/messages", async (req, res) => {
    try {
      const projectId = req.params.id;
      const project = await storage.getProject(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const body = req.body as { messages?: unknown };
      if (!Array.isArray(body?.messages)) {
        res.status(400).json({ error: "messages must be an array" });
        return;
      }
      const allowedKinds = new Set(["chat", "manager"]);
      const sanitized: ChatMessageInput[] = [];
      for (const raw of body.messages) {
        if (!raw || typeof raw !== "object") continue;
        const m = raw as Record<string, unknown>;
        if (typeof m.clientId !== "string" || !m.clientId) continue;
        if (typeof m.kind !== "string" || !allowedKinds.has(m.kind)) continue;
        if (typeof m.role !== "string") continue;
        if (typeof m.seq !== "number" || !Number.isFinite(m.seq)) continue;
        if (typeof m.timestamp !== "number" || !Number.isFinite(m.timestamp)) continue;
        sanitized.push({
          clientId: m.clientId,
          kind: m.kind as "chat" | "manager",
          role: m.role,
          content: typeof m.content === "string" ? m.content : "",
          thinking: typeof m.thinking === "string" ? m.thinking : null,
          source: typeof m.source === "string" ? m.source : null,
          seq: m.seq,
          timestamp: m.timestamp,
          metadata: typeof m.metadata === "string" ? m.metadata : null,
          sessionId: typeof m.sessionId === "string" ? m.sessionId : null,
        });
      }
      await storage.upsertChatMessages(projectId, sanitized);
      res.json({ ok: true, count: sanitized.length });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to save messages" });
    }
  });

  app.delete("/api/projects/:id/messages", async (req, res) => {
    try {
      const projectId = req.params.id;
      const project = await storage.getProject(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const afterSeqRaw = req.query.afterSeq;
      const afterSeq = typeof afterSeqRaw === "string" ? Number(afterSeqRaw) : NaN;
      if (!Number.isFinite(afterSeq)) {
        res.status(400).json({ error: "afterSeq query param required" });
        return;
      }
      // sessionId：传了就按 session 删，不传默认删 "main"
      const sessionIdRaw = req.query.sessionId;
      const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw : null;
      await storage.deleteChatMessagesAfter(projectId, afterSeq, sessionId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed to delete messages" });
    }
  });

  // ── Chat Sessions ─────────────────────────────────────────────────────────
  // GET  /api/projects/:id/sessions       — list sessions (newest first)
  // POST /api/projects/:id/sessions       — create new session
  // DELETE /api/projects/:id/sessions/:sid — delete session + its messages

  app.get("/api/projects/:id/sessions", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const projectId = req.params.id;
      const rows = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.projectId, projectId))
        .orderBy(desc(chatSessions.createdAt));
      res.json({ sessions: rows });
    } catch (err) {
      console.error("[sessions/list]", err);
      res.status(500).json({ error: "Failed to list sessions" });
    }
  });

  app.post("/api/projects/:id/sessions", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const projectId = req.params.id;
      const name = (req.body as any)?.name ?? "新对话";
      const id = randomBytes(8).toString("hex");
      const [row] = await db.insert(chatSessions).values({
        id,
        projectId,
        name: String(name).slice(0, 80),
      }).returning();
      res.status(201).json({ session: row });
    } catch (err) {
      console.error("[sessions/create]", err);
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  app.delete("/api/projects/:id/sessions/:sid", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { sid } = req.params;
      // cascade delete removes messages via FK
      await db.delete(chatSessions).where(eq(chatSessions.id, sid));
      res.json({ ok: true });
    } catch (err) {
      console.error("[sessions/delete]", err);
      res.status(500).json({ error: "Failed to delete session" });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      await storage.deleteProject(req.params.id);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Delete project error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to delete project" });
    }
  });

  app.get("/api/projects/:id/files", async (req, res) => {
    try {
      const projectId = req.params.id;
      let files = await storage.getProjectFiles(projectId);

      const project = await storage.getProject(projectId);
      if (project && project.framework && project.framework !== "web") {
        const paths = files.map((f: { path: string }) => f.path);
        const webSignatures = new Set([
          "/project/index.html", "/project/style.css", "/project/app.js",
          "/project/script.js", "/project/cascade.md",
        ]);
        const hasOnlyWebFiles = paths.length > 0 && paths.every((p: string) => webSignatures.has(p));
        if (hasOnlyWebFiles) {
          const templateFiles = getTemplateFiles(project.framework as Framework);
          if (templateFiles.length > 0) {
            await storage.upsertProjectFiles(
              projectId,
              templateFiles.map((f) => ({ path: f.path, content: f.content }))
            );
            const templatePaths = new Set(templateFiles.map((t) => t.path));
            for (const wp of paths) {
              if (!templatePaths.has(wp)) {
                await storage.deleteProjectFile(projectId, wp);
              }
            }
            files = await storage.getProjectFiles(projectId);
            console.log(`Repaired corrupted ${project.framework} project ${projectId}: replaced web files with framework templates`);
          }
        }
      }

      res.json({ files });
    } catch (error: any) {
      console.error("Get project files error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to get project files" });
    }
  });

  app.put("/api/projects/:id/files", async (req, res) => {
    try {
      const parsed = projectFilesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await storage.upsertProjectFiles(req.params.id, parsed.data.files);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Upsert project files error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to save files" });
    }
  });

  app.put("/api/projects/:id/files/single", async (req, res) => {
    try {
      const parsed = singleFileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await storage.upsertProjectFile(req.params.id, parsed.data.path, parsed.data.content);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Upsert project file error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to save file" });
    }
  });

  app.delete("/api/projects/:id/files", async (req, res) => {
    try {
      const parsed = deleteFileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await storage.deleteProjectFile(req.params.id, parsed.data.path);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Delete project file error:", error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to delete file" });
    }
  });

  app.get("/api/projects/:id/export", async (req, res) => {
    try {
      const files = await storage.getProjectFiles(req.params.id);
      if (!files || files.length === 0) {
        res.status(404).json({ error: "No files found for this project" });
        return;
      }

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="project-${req.params.id}.zip"`);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err: Error) => {
        console.error("Archive error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to create archive" });
        }
      });
      archive.pipe(res);

      for (const file of files) {
        let relativePath = file.path.replace(/^\/project\//, "");
        if (!relativePath) continue;
        relativePath = relativePath.split("/").filter((seg) => seg !== ".." && seg !== "." && seg !== "").join("/");
        if (!relativePath || relativePath.startsWith("/")) continue;
        archive.append(file.content, { name: relativePath });
      }

      await archive.finalize();
    } catch (error: any) {
      console.error("Export project error:", error?.message || error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Failed to export project" });
      }
    }
  });


  app.get("/api/projects/:id/export-wechat", async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      const files = await storage.getProjectFiles(req.params.id);
      if (!files || files.length === 0) { res.status(404).json({ error: "No files found" }); return; }

      const safeName = (project.name ?? "miniprogram").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_").slice(0, 40);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", (err: Error) => {
        console.error("[wx-export] archive error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to create archive" });
      });
      archive.pipe(res);

      for (const file of files) {
        // Strip /project/ prefix — the ZIP root IS the mini-program root.
        let rel = file.path.replace(/^\/project\//, "");
        if (!rel) continue;
        // Sanitise path segments.
        rel = rel.split("/").filter((s) => s && s !== ".." && s !== ".").join("/");
        if (!rel) continue;
        archive.append(file.content, { name: rel });
      }

      await archive.finalize();
    } catch (err: any) {
      console.error("[wx-export]", err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: err?.message || "Export failed" });
    }
  });
}
