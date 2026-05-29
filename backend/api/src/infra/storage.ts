import { eq, and, desc, lt, gt, sql } from "drizzle-orm";
import { type User, type InsertUser, type Project, type InsertProject, type ProjectFile, type InsertProjectFile, type ChatMessageRow, type InsertChatMessage, users, projects, projectFiles, chatMessages } from "@cascade/database";
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
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByGithubId(githubId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
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

  listChatMessages(projectId: string, opts: { kind?: "chat" | "manager"; before?: number; limit?: number }): Promise<ChatMessageRow[]>;
  upsertChatMessages(projectId: string, msgs: ChatMessageInput[]): Promise<void>;
  deleteChatMessagesAfter(projectId: string, afterSeq: number): Promise<void>;
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
    const [created] = await db.insert(projects).values(project).onConflictDoNothing().returning();
    if (!created) {
      // Row already existed — return the existing one
      const [existing] = await db.select().from(projects).where(eq(projects.id, project.id!));
      return existing;
    }
    return created;
  }

  async updateProjectName(id: string, name: string): Promise<void> {
    await db.update(projects).set({ name }).where(eq(projects.id, id));
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
    const [existing] = await db.select().from(projectFiles)
      .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path)));

    if (existing) {
      await db.update(projectFiles).set({ content })
        .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path)));
    } else {
      await db.insert(projectFiles).values({ projectId, path, content });
    }
  }

  async upsertProjectFiles(projectId: string, files: { path: string; content: string }[]): Promise<void> {
    const existing = await db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
    const existingMap = new Map(existing.map((f) => [f.path, f]));
    const incomingPaths = new Set(files.map((f) => f.path));

    const toInsert: { projectId: string; path: string; content: string }[] = [];
    const toUpdate: { path: string; content: string }[] = [];
    const toDelete: string[] = [];

    for (const file of files) {
      if (existingMap.has(file.path)) {
        toUpdate.push(file);
      } else {
        toInsert.push({ projectId, path: file.path, content: file.content });
      }
    }

    for (const existingPath of existingMap.keys()) {
      if (!incomingPaths.has(existingPath)) {
        toDelete.push(existingPath);
      }
    }

    if (toInsert.length > 0) {
      await db.insert(projectFiles).values(toInsert);
    }

    for (const file of toUpdate) {
      await db.update(projectFiles).set({ content: file.content })
        .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, file.path)));
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
    opts: { kind?: "chat" | "manager"; before?: number; limit?: number } = {},
  ): Promise<ChatMessageRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const conditions = [eq(chatMessages.projectId, projectId)];
    if (opts.kind) conditions.push(eq(chatMessages.kind, opts.kind));
    if (typeof opts.before === "number") conditions.push(lt(chatMessages.seq, opts.before));
    const rows = await db.select().from(chatMessages)
      .where(and(...conditions))
      .orderBy(desc(chatMessages.seq))
      .limit(limit);
    // Return in ascending order so the client can append directly.
    return rows.reverse();
  }

  async upsertChatMessages(projectId: string, msgs: ChatMessageInput[]): Promise<void> {
    if (msgs.length === 0) return;
    const rows: InsertChatMessage[] = msgs.map((m) => ({
      projectId,
      clientId: m.clientId,
      kind: m.kind,
      role: m.role,
      content: m.content,
      thinking: m.thinking ?? null,
      source: m.source ?? null,
      seq: m.seq,
      timestamp: m.timestamp,
      metadata: m.metadata ?? null,
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
}

export const storage = new DatabaseStorage();
