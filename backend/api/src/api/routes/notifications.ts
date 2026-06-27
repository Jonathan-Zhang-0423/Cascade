import type { Express } from "express";
import { db } from "../../infra/db";
import { notifications } from "@cascade/database";
import { eq, and, desc } from "drizzle-orm";

/**
 * Notification routes (Step C of the routes split). Self-contained: only
 * touches the notifications table. register(app) mounts the three endpoints.
 * Behavior is unchanged from the inline versions in registerRoutes.
 */
export function registerNotificationRoutes(app: Express): void {
  // GET /api/notifications — latest 50 for the current user
  app.get("/api/notifications", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(50);
      res.json({ notifications: rows });
    } catch (err) {
      console.error("[notifications]", err);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // PATCH /api/notifications/:id/read — 标记单条已读
  app.patch("/api/notifications/:id/read", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = parseInt(req.params.id);
      await db.update(notifications).set({ isRead: true })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark read" });
    }
  });

  // PATCH /api/notifications/read-all — 全部标记已读
  app.patch("/api/notifications/read-all", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark all read" });
    }
  });
}
