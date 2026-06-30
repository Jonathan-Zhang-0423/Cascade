import { eq, and, desc, lt, gt, sql, asc } from "drizzle-orm";
import { type User, type InsertUser, type Project, type InsertProject, type ProjectFile, type InsertProjectFile, type ChatMessageRow, type InsertChatMessage, type ManagerSessionRow, users, projects, projectFiles, chatMessages, managerSessions, publishedApps, type InsertPublishedApp } from "@cascade/database";
import { db } from "./db";
import { randomUUID } from "crypto";

export interface ChatMessageInput {
  clientId: string;
  kind: "chat" | "manager";
  role: string;
  content: string;
  thinking?: string | null;
  source?: string | null;
  seq: number;
  timestamp: number;
  metadata?: string | null;
  sessionId?: string | null;
}

/**
 * Postgres text columns cannot store NUL (U+0000) bytes — an embedded 
 * raises `invalid byte sequence for encoding "UTF8"` and 500s the request.
 * Strip NULs from any user-supplied string before it reaches the DB so hostile
 * or accidental input degrades gracefully instead of crashing the handler.
 */
function stripNul(s: string): string {
  return s.indexOf("\u0000") === -1 ? s : s.replace(/\u0000/g, "");
}

/** Reserved projectSkills row name for the per-project self-evolving memory doc. */
export const PROJECT_MEMORY_NAME = "__memory__";
/** Hard char cap so the memory never bloats the prompt. */
export const PROJECT_MEMORY_MAX = Number(process.env.PROJECT_MEMORY_MAX) || 6000;

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByGithubId(githubId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByPhone(phone: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createGithubUser(input: {
    username: string;
    githubId: string;
    email: string | null;
    avatarUrl: string | null;
  }): Promise<User>;
  linkGithubToUser(userId: string, input: { githubId: string; avatarUrl: string | null }): Promise<User>;

  getProject(id: string): Promise<Project | undefined>;
  getProjects(userId?: string): Promise<Project[]>;
  createProject(project: InsertProject): Promise<Project>;
  updateProjectName(id: string, name: string): Promise<void>;
  updateProjectPlan(id: string, plan: unknown): Promise<void>;
  updateProjectBuildResult(id: string, result: unknown): Promise<void>;
  deleteProject(id: string): Promise<void>;

  getProjectFiles(projectId: string): Promise<ProjectFile[]>;
  upsertProjectFile(projectId: string, path: string, content: string): Promise<void>;
  upsertProjectFiles(projectId: string, files: { path: string; content: string }[]): Promise<void>;
  deleteProjectFile(projectId: string, path: string): Promise<void>;

  listChatMessages(projectId: string, opts: { kind?: "chat" | "manager"; before?: number; limit?: number; sessionId?: string | null }): Promise<ChatMessageRow[]>;
  upsertChatMessages(projectId: string, msgs: ChatMessageInput[]): Promise<void>;
  deleteChatMessagesAfter(projectId: string, afterSeq: number): Promise<void>;

  // Published Apps (Creator Square)
  getPublishedApp(id: string): Promise<(typeof publishedApps.$inferSelect) | undefined>;
  getPublishedAppByProject(projectId: string): Promise<(typeof publishedApps.$inferSelect) | undefined>;
  listPublishedApps(opts: { limit?: number; offset?: number; framework?: string }): Promise<(typeof publishedApps.$inferSelect & { authorUsername: string })[]>;
  listUserPublishedApps(userId: string): Promise<(typeof publishedApps.$inferSelect)[]>;
  upsertPublishedApp(app: InsertPublishedApp): Promise<typeof publishedApps.$inferSelect>;
  deletePublishedApp(id: string, userId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByGithubId(githubId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.githubId, githubId));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.phone, phone));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const [user] = await db.insert(users).values({ ...insertUser, id }).returning();
    return user;
  }

  async createGithubUser(input: {
    username: string;
    githubId: string;
    email: string | null;
    avatarUrl: string | null;
  }): Promise<User> {
    const id = randomUUID();
    const [user] = await db.insert(users).values({
      id,
      username: input.username,
      password: null,
      githubId: input.githubId,
      email: input.email,
      avatarUrl: input.avatarUrl,
    }).returning();
    return user;
  }

  async linkGithubToUser(
    userId: string,
    input: { githubId: string; avatarUrl: string | null },
  ): Promise<User> {
    const [user] = await db.update(users)
      .set({ githubId: input.githubId, avatarUrl: input.avatarUrl })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async getProjects(userId?: string): Promise<Project[]> {
    if (userId) {
      return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(projects.createdAt);
    }
    return db.select().from(projects).orderBy(projects.createdAt);
  }

  async createProject(project: InsertProject): Promise<Project> {
    const safe = project.name !== undefined ? { ...project, name: stripNul(project.name) } : project;
    const [created] = await db.insert(projects).values(safe).onConflictDoNothing().returning();
    if (!created) {
      // Row already existed — return the existing one
      const [existing] = await db.select().from(projects).where(eq(projects.id, project.id!));
      return existing;
    }
    return created;
  }

  async updateProjectName(id: string, name: string): Promise<void> {
    await db.update(projects).set({ name: stripNul(name) }).where(eq(projects.id, id));
  }

  async updateProjectPlan(id: string, plan: unknown): Promise<void> {
    await db.update(projects).set({ lastPlan: JSON.stringify(plan) }).where(eq(projects.id, id));
  }

  async updateProjectBuildResult(id: string, result: unknown): Promise<void> {
    await db.update(projects).set({ lastBuildResult: JSON.stringify(result) }).where(eq(projects.id, id));
  }

  async deleteProject(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    return db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  }

  async upsertProjectFile(projectId: string, path: string, content: string): Promise<void> {
    // Atomic upsert: a single INSERT ... ON CONFLICT avoids the read-then-write
    // race that (without a unique constraint) produced duplicate rows and
    // cross-statement lock-ordering deadlocks under concurrent writes.
    await db.insert(projectFiles)
      .values({ projectId, path: stripNul(path), content: stripNul(content) })
      .onConflictDoUpdate({
        target: [projectFiles.projectId, projectFiles.path],
        set: { content: stripNul(content) },
      });
  }

  async upsertProjectFiles(projectId: string, files: { path: string; content: string }[]): Promise<void> {
    const existing = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
    const existingPaths = new Set(existing.map((f) => f.path));
    const incomingPaths = new Set(files.map((f) => f.path));

    const toDelete: string[] = [];
    for (const existingPath of existingPaths) {
      if (!incomingPaths.has(existingPath)) {
        toDelete.push(existingPath);
      }
    }

    // Atomic per-row upsert keyed on the unique (project_id, path). Idempotent
    // under concurrency — no duplicate rows, no read-then-write window.
    if (files.length > 0) {
      await db.insert(projectFiles)
        .values(files.map((f) => ({ projectId, path: stripNul(f.path), content: stripNul(f.content) })))
        .onConflictDoUpdate({
          target: [projectFiles.projectId, projectFiles.path],
          set: { content: sql`excluded.content` },
        });
    }

    for (const path of toDelete) {
      await db.delete(projectFiles)
        .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path)));
    }
  }

  async deleteProjectFile(projectId: string, path: string): Promise<void> {
    await db.delete(projectFiles)
      .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path)));
  }

  async listChatMessages(
    projectId: string,
    opts: { kind?: "chat" | "manager"; before?: number; limit?: number; sessionId?: string | null } = {},
  ): Promise<ChatMessageRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const conditions = [eq(chatMessages.projectId, projectId)];
    if (opts.kind) conditions.push(eq(chatMessages.kind, opts.kind));
    if (typeof opts.before === "number") conditions.push(lt(chatMessages.seq, opts.before));
    // sessionId 过滤：undefined = 不过滤（主会话兼容旧数据），null = 主会话，string = 指定 session
    if (opts.sessionId === null) {
      conditions.push(isNull(chatMessages.sessionId));
    } else if (typeof opts.sessionId === "string") {
      conditions.push(eq(chatMessages.sessionId, opts.sessionId));
    }
    const rows = await db.select().from(chatMessages)
      .where(and(...conditions))
      .orderBy(desc(chatMessages.seq))
      .limit(limit);
    return rows.reverse();
  }

  async upsertChatMessages(projectId: string, msgs: ChatMessageInput[]): Promise<void> {
    if (msgs.length === 0) return;
    const rows: InsertChatMessage[] = msgs.map((m) => ({
      projectId,
      clientId: m.clientId,
      kind: m.kind,
      role: m.role,
      content: stripNul(m.content),
      thinking: m.thinking != null ? stripNul(m.thinking) : null,
      source: m.source ?? null,
      seq: m.seq,
      timestamp: m.timestamp,
      metadata: m.metadata ?? null,
      sessionId: m.sessionId ?? null,
    }));
    // ON CONFLICT on (project_id, client_id) → update mutable fields.
    await db.insert(chatMessages).values(rows).onConflictDoUpdate({
      target: [chatMessages.projectId, chatMessages.clientId],
      set: {
        content: sql`excluded.content`,
        thinking: sql`excluded.thinking`,
        source: sql`excluded.source`,
        seq: sql`excluded.seq`,
        timestamp: sql`excluded.timestamp`,
        metadata: sql`excluded.metadata`,
      },
    });
  }

  async deleteChatMessagesAfter(projectId: string, afterSeq: number): Promise<void> {
    await db.delete(chatMessages)
      .where(and(eq(chatMessages.projectId, projectId), gt(chatMessages.seq, afterSeq)));
  }

  // ─── Manager Sessions ─────────────────────────────────────────────────

  async upsertManagerSession(session: {
    id: string;
    projectId?: string;
    done: boolean;
    startedAt: number;
    doneAt?: number;
    nextEventId: number;
    events: Array<{ eventId: number; data: Record<string, unknown> }>;
  }): Promise<void> {
    await db.insert(managerSessions).values({
      id: session.id,
      projectId: session.projectId ?? null,
      done: session.done,
      startedAt: session.startedAt,
      doneAt: session.doneAt ?? null,
      nextEventId: session.nextEventId,
      events: JSON.stringify(session.events),
    }).onConflictDoUpdate({
      target: [managerSessions.id],
      set: {
        done: sql`excluded.done`,
        doneAt: sql`excluded.done_at`,
        nextEventId: sql`excluded.next_event_id`,
        events: sql`excluded.events`,
      },
    });
  }

  async getManagerSession(id: string): Promise<ManagerSessionRow | undefined> {
    const [row] = await db.select().from(managerSessions).where(eq(managerSessions.id, id));
    return row;
  }

  async getActiveManagerSessionForProject(projectId: string): Promise<ManagerSessionRow | undefined> {
    const [row] = await db.select().from(managerSessions)
      .where(and(eq(managerSessions.projectId, projectId), eq(managerSessions.done, false)))
      .orderBy(desc(managerSessions.startedAt))
      .limit(1);
    return row;
  }

  async markManagerSessionDone(id: string): Promise<void> {
    await db.update(managerSessions)
      .set({ done: true, doneAt: Date.now() })
      .where(eq(managerSessions.id, id));
  }

  async deleteOldManagerSessions(maxAgeMs: number): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    await db.delete(managerSessions)
      .where(lt(managerSessions.startedAt, cutoff));
  }

  // ─── Published Apps (Creator Square) ────────────────────────────────────────

  async getPublishedApp(id: string): Promise<(typeof publishedApps.$inferSelect) | undefined> {
    const [row] = await db.select().from(publishedApps).where(eq(publishedApps.id, id));
    return row;
  }

  async getPublishedAppByProject(projectId: string): Promise<(typeof publishedApps.$inferSelect) | undefined> {
    const [row] = await db.select().from(publishedApps).where(eq(publishedApps.projectId, projectId));
    return row;
  }

  async listPublishedApps(opts: { limit?: number; offset?: number; framework?: string }): Promise<(typeof publishedApps.$inferSelect & { authorUsername: string })[]> {
    const limit = Math.min(opts.limit ?? 20, 50);
    const offset = opts.offset ?? 0;
    const rows = await db
      .select({
        id: publishedApps.id,
        projectId: publishedApps.projectId,
        userId: publishedApps.userId,
        title: publishedApps.title,
        description: publishedApps.description,
        isOpenSource: publishedApps.isOpenSource,
        visibility: publishedApps.visibility,
        previewScreenshot: publishedApps.previewScreenshot,
        framework: publishedApps.framework,
        publishedAt: publishedApps.publishedAt,
        updatedAt: publishedApps.updatedAt,
        authorUsername: users.username,
      })
      .from(publishedApps)
      .leftJoin(users, eq(publishedApps.userId, users.id))
      .where(
        opts.framework
          ? and(eq(publishedApps.visibility, "public"), eq(publishedApps.framework, opts.framework))
          : eq(publishedApps.visibility, "public")
      )
      .orderBy(desc(publishedApps.publishedAt))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({ ...r, authorUsername: r.authorUsername ?? "anonymous" }));
  }

  async listUserPublishedApps(userId: string): Promise<(typeof publishedApps.$inferSelect)[]> {
    return db.select().from(publishedApps)
      .where(eq(publishedApps.userId, userId))
      .orderBy(desc(publishedApps.publishedAt));
  }

  async upsertPublishedApp(app: InsertPublishedApp): Promise<typeof publishedApps.$inferSelect> {
    const now = new Date();
    const [row] = await db
      .insert(publishedApps)
      .values({ ...app, updatedAt: now })
      .onConflictDoUpdate({
        target: [publishedApps.id],
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          isOpenSource: sql`excluded.is_open_source`,
          visibility: sql`excluded.visibility`,
          previewScreenshot: sql`excluded.preview_screenshot`,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  async deletePublishedApp(id: string, userId: string): Promise<void> {
    await db.delete(publishedApps)
      .where(and(eq(publishedApps.id, id), eq(publishedApps.userId, userId)));
  }
}

export const storage = new DatabaseStorage();
