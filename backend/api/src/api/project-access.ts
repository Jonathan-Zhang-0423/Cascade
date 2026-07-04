import type { Request, Response } from "express";
import { storage } from "../infra/storage";
import type { Project } from "@cascade/database";
import { normalizeChatSessionId as normalizeAgentChatSessionId } from "../agent/session/session-store";

export function getRequestUserId(req: Request): string | undefined {
  return (req.session as any)?.userId as string | undefined;
}

export function normalizeChatSessionId(value: unknown): string {
  return normalizeAgentChatSessionId(typeof value === "string" ? value : undefined);
}

export async function assertProjectAccess(
  req: Request,
  res: Response,
  projectId: string,
  opts: { allowOwnerless?: boolean; allowMissing?: boolean } = {},
): Promise<Project | null> {
  const userId = getRequestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }

  const project = await storage.getProject(projectId);
  if (!project) {
    if (opts.allowMissing) return null;
    res.status(404).json({ error: "Project not found" });
    return null;
  }

  if (project.userId && project.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  if (!project.userId && !opts.allowOwnerless) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  return project;
}

