import type { Express } from "express";
import { eq, and, desc, count, sql, isNull, or } from "drizzle-orm";
import { db } from "../../infra/db";
import { storage } from "../../infra/storage";
import { users, waitlistSubscribers, inviteCodes, userFeedback, projects, chatMessages, otpCodes, notifications } from "@cascade/database";
import { sendEmail, NOTIFICATION_EMAIL } from "../../infra/email";
import { isEduEmail, isQizhiEmail, getTrialInfo, inviteCodePrefix, formatInviteCode } from "../services/invite-service";
import { checkAdmin } from "../middleware/auth-middleware";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";
const BATCH_SIZE = 50;
const WAITLIST_BASE_URL = process.env.BASE_URL ?? process.env.APP_BASE_URL ?? "https://cascadeai.co";

/**
 * Admin routes (Step C): feedback list/reply, IP + account blocklist (reads
 * shared security state via app locals set by createSecurity), batch invites +
 * confirmation, OTP-limit reset, CSV export, sheets sync, user roster.
 * checkAdmin guards every endpoint. Behavior unchanged.
 */
export function registerAdminRoutes(app: Express): void {
  // ── User Feedback ─────────────────────────────────────────────────────────
  // POST /api/feedback — submit user suggestion
  // GET /api/admin/feedback — list all feedback (admin only)
  app.get("/api/admin/feedback", async (req, res) => {
    try {
      if (!checkAdmin(req, res)) return;
      const rows = await db
        .select({
          id: userFeedback.id,
          content: userFeedback.content,
          source: userFeedback.source,
          createdAt: userFeedback.createdAt,
          repliedAt: userFeedback.repliedAt,
          replyContent: userFeedback.replyContent,
          username: users.username,
          email: users.email,
          phone: users.phone,
        })
        .from(userFeedback)
        .leftJoin(users, eq(userFeedback.userId, users.id))
        .orderBy(desc(userFeedback.createdAt))
        .limit(500);
      res.json({ feedback: rows });
    } catch (err) {
      console.error("[admin/feedback]", err);
      res.status(500).json({ error: "Failed to fetch feedback" });
    }
  });

  // POST /api/admin/feedback/:id/reply — 管理员回复用户建议，写入 notifications 表并标记已回复
  app.post("/api/admin/feedback/:id/reply", async (req, res) => {
    try {
      if (!checkAdmin(req, res)) return;
      const feedbackId = parseInt(req.params.id);
      const { message } = req.body as { message?: string };
      if (!message?.trim()) return res.status(400).json({ error: "Message required" });
      const [fb] = await db.select({ userId: userFeedback.userId, content: userFeedback.content })
        .from(userFeedback).where(eq(userFeedback.id, feedbackId));
      if (!fb) return res.status(404).json({ error: "Feedback not found" });
      // 写入 notifications
      await db.insert(notifications).values({
        userId: fb.userId,
        type: "admin_reply",
        title: "管理员回复了你的建议",
        body: message.trim(),
      });
      // 标记 feedback 已回复
      await db.update(userFeedback)
        .set({ repliedAt: new Date(), replyContent: message.trim() })
        .where(eq(userFeedback.id, feedbackId));
      res.json({ ok: true });
    } catch (err) {
      console.error("[admin/feedback/reply]", err);
      res.status(500).json({ error: "Failed to send reply" });
    }
  });


  // GET /api/admin/blocklist/ip — list all blocked IPs
  app.get("/api/admin/blocklist/ip", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const now = Date.now();
    const blocklist = (app as any)._ipBlocklist as Map<string, { blockedUntil: number; reason: string; blockedAt: number }>;
    const list = Array.from(blocklist.entries())
      .filter(([, v]) => v.blockedUntil > now)
      .map(([ip, v]) => ({
        ip,
        reason: v.reason,
        blockedAt: new Date(v.blockedAt).toISOString(),
        blockedUntil: new Date(v.blockedUntil).toISOString(),
        remainingSec: Math.ceil((v.blockedUntil - now) / 1000),
      }));
    res.json({ total: list.length, items: list });
  });

  // DELETE /api/admin/blocklist/ip/:ip — unblock an IP
  app.delete("/api/admin/blocklist/ip/:ip", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const ip = decodeURIComponent(req.params.ip);
    const existed = (app as any)._ipBlocklist.has(ip);
    (app as any)._ipBlocklist.delete(ip);
    res.json({ ok: true, ip, unblocked: existed });
  });

  // POST /api/admin/blocklist/ip — manually block an IP
  app.post("/api/admin/blocklist/ip", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const { ip, durationHours = 1, reason = "Manual block" } = req.body as {
      ip?: string; durationHours?: number; reason?: string;
    };
    if (!ip || typeof ip !== "string") return res.status(400).json({ error: "ip required" });
    const now = Date.now();
    (app as any)._ipBlocklist.set(ip.trim(), {
      blockedUntil: now + durationHours * 60 * 60 * 1000,
      reason,
      blockedAt: now,
    });
    res.json({ ok: true, ip: ip.trim(), durationHours });
  });

  // ── Admin: Account lockout management ──────────────────────────────────────

  // GET /api/admin/blocklist/users — list locked accounts
  app.get("/api/admin/blocklist/users", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    const now = Date.now();
    const locked: any[] = [];
    for (const [userId, entry] of (app as any)._accountLockout.entries()) {
      if (entry.lockedUntil && entry.lockedUntil > now) {
        // fetch username
        const user = await storage.getUser(userId).catch(() => null);
        locked.push({
          userId,
          username: (user as any)?.username ?? "unknown",
          email: (user as any)?.email ?? null,
          failCount: entry.failCount,
          lockedAt: entry.lockedAt ? new Date(entry.lockedAt).toISOString() : null,
          lockedUntil: new Date(entry.lockedUntil).toISOString(),
          remainingSec: Math.ceil((entry.lockedUntil - now) / 1000),
        });
      }
    }
    res.json({ total: locked.length, items: locked });
  });

  // DELETE /api/admin/blocklist/users/:userId — unlock an account
  app.delete("/api/admin/blocklist/users/:userId", (req, res) => {
    if (!checkAdmin(req, res)) return;
    const { userId } = req.params;
    const existed = (app as any)._accountLockout.has(userId);
    (app as any)._clearAccountLockout(userId);
    res.json({ ok: true, userId, unlocked: existed });
  });

  // GET /api/admin/blocklist/users/:userId — check a specific user's lockout
  app.get("/api/admin/blocklist/users/:userId", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    const { userId } = req.params;
    const entry = (app as any)._accountLockout.get(userId);
    const now = Date.now();
    if (!entry || !entry.lockedUntil || entry.lockedUntil <= now) {
      return res.json({ locked: false, userId });
    }
    const user = await storage.getUser(userId).catch(() => null);
    res.json({
      locked: true,
      userId,
      username: (user as any)?.username ?? "unknown",
      failCount: entry.failCount,
      lockedUntil: new Date(entry.lockedUntil).toISOString(),
      remainingSec: Math.ceil((entry.lockedUntil - now) / 1000),
    });
  });

  // POST /api/admin/send-invites — manual bulk send by IDs
  app.post("/api/admin/send-invites", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const ids = (req.body as { ids?: number[] })?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "No subscriber IDs provided" });
      }
      const sent = await sendInvitesForSubscribers(ids);
      res.json({ success: true, sent });
    } catch (err) {
      console.error("[admin/send-invites]", err);
      res.status(500).json({ error: "Failed to send invites" });
    }
  });

  // GET /api/admin/confirm-batch?token=... — link target from notification email
  app.get("/api/admin/confirm-batch", async (req, res) => {
    const token = req.query.token as string | undefined;
    if (!token || !ADMIN_SECRET) return res.status(400).send("Invalid token");
    let batchId: number;
    try {
      const decoded = Buffer.from(token, "base64url").toString();
      const [batchStr, secret] = decoded.split(":");
      if (secret !== ADMIN_SECRET) return res.status(401).send("Invalid token");
      batchId = parseInt(batchStr, 10);
      if (isNaN(batchId)) throw new Error("bad batchId");
    } catch {
      return res.status(400).send("Invalid token");
    }
    try {
      const subsInBatch = await db.select({ id: waitlistSubscribers.id })
        .from(waitlistSubscribers)
        .where(and(
          eq(waitlistSubscribers.batchId, batchId),
          eq(waitlistSubscribers.status, "pending"),
        ));
      const sent = await sendInvitesForSubscribers(subsInBatch.map((s) => s.id));
      res.send(`<html><body style="font-family:sans-serif;padding:40px;max-width:500px;margin:auto">
        <h2>邀请码已发送</h2>
        <p>成功向 <strong>${sent}</strong> 位用户发送了邀请码。</p>
        <a href="/admin" style="color:#2563eb">返回后台</a>
      </body></html>`);
    } catch (err) {
      console.error("[admin/confirm-batch]", err);
      res.status(500).send("发送失败，请在后台手动重试。");
    }
  });

  // ── Helpers (waitlist) ──────────────────────────────────────────────────
  async function notifyAdminOfBatch(pending: number): Promise<void> {
    const nextBatchId = Math.floor(pending / BATCH_SIZE);
    // Tag the BATCH_SIZE most recent untagged pending subscribers.
    const untagged = await db.select().from(waitlistSubscribers)
      .where(and(eq(waitlistSubscribers.status, "pending"), isNull(waitlistSubscribers.batchId)))
      .orderBy(waitlistSubscribers.createdAt);
    const slice = untagged.slice(0, BATCH_SIZE);
    if (slice.length === 0) return;
    await Promise.all(slice.map((u) =>
      db.update(waitlistSubscribers)
        .set({ batchId: nextBatchId })
        .where(eq(waitlistSubscribers.id, u.id))
    ));

    if (!ADMIN_SECRET) return;
    const token = Buffer.from(`${nextBatchId}:${ADMIN_SECRET}`).toString("base64url");
    const confirmUrl = `${WAITLIST_BASE_URL}/api/admin/confirm-batch?token=${token}`;
    const listHtml = slice
      .map((u, i) => `<tr><td style="padding:4px 12px">${i + 1}</td><td style="padding:4px 12px">${u.email}</td><td style="padding:4px 12px">${u.isEdu ? "EDU" : "普通"}</td></tr>`)
      .join("");
    const html = `
      <h2>Waitlist Batch #${nextBatchId} — ${slice.length} 位新用户</h2>
      <table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
        <thead><tr><th style="padding:4px 12px">#</th><th style="padding:4px 12px">Email</th><th style="padding:4px 12px">类型</th></tr></thead>
        <tbody>${listHtml}</tbody>
      </table>
      <br/>
      <a href="${confirmUrl}" style="display:inline-block;padding:12px 24px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">
        确认并发送邀请码给这 ${slice.length} 位用户
      </a>
    `;
    await sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: `[CascadeAI] Waitlist Batch #${nextBatchId} — ${slice.length} 位用户待确认`,
      html,
      text: `Waitlist Batch #${nextBatchId}，共 ${slice.length} 位用户。确认链接：${confirmUrl}`,
    });
  }

  async function sendInvitesForSubscribers(subscriberIds: number[]): Promise<number> {
    if (subscriberIds.length === 0) return 0;

    // Pull the target subscribers (pending or email_failed — the latter need a retry).
    const allTargets = await db.select().from(waitlistSubscribers)
      .where(or(
        eq(waitlistSubscribers.status, "pending"),
        eq(waitlistSubscribers.status, "email_failed"),
      ));
    const targets = allTargets.filter((s) => subscriberIds.includes(s.id));
    if (targets.length === 0) return 0;

    // Codes are random (prefix + CSPRNG suffix). Each subscriber's INSERT runs in
    // its own short transaction so a unique-constraint collision (negligibly rare)
    // rolls back only that subscriber and is retried with a fresh suffix, never
    // aborting the whole batch.
    let sent = 0;

    for (const sub of targets) {
      const { trialDays, codeExpiresAt, label: trialLabel } = getTrialInfo(sub.email, sub.isEdu);

      // For email_failed retries: a code was already allocated — reuse it.
      // For pending: allocate a new code inside a transaction to avoid races.
      let code: string;
      const [existing] = await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.waitlistSubscriberId, sub.id));

      if (existing) {
        code = existing.code;
      } else {
        // Codes are now random (prefix + CSPRNG suffix), so no COUNT/sequence is
        // needed. Insert inside a transaction and retry on the (negligible, ~1 in
        // 1e9) unique-constraint collision with a freshly-drawn suffix; a collision
        // rolls back only this subscriber, not the whole batch.
        let allocated = false;
        let allocatedCode = "";
        for (let attempt = 0; attempt < 5 && !allocated; attempt++) {
          try {
            await db.transaction(async (tx) => {
              allocatedCode = formatInviteCode(sub.email);
              await tx.insert(inviteCodes).values({
                code: allocatedCode,
                isEdu: sub.isEdu,
                trialDays,
                expiresAt: codeExpiresAt,
                waitlistSubscriberId: sub.id,
              });
            });
            allocated = true;
          } catch (err: any) {
            const msg: string = err?.message ?? "";
            if (!msg.includes("unique") && !msg.includes("duplicate")) throw err;
            console.warn(`[invite-code] unique collision for subscriber ${sub.id}, attempt ${attempt + 1}`);
          }
        }
        if (!allocated) {
          console.error(`[invite-code] failed to allocate unique code for subscriber ${sub.id} after 5 attempts`);
          continue;
        }
        code = allocatedCode;
      }

      const codeExpiryStr = codeExpiresAt.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
      const html = `
        <div style="font-family:'Helvetica Neue',sans-serif;max-width:560px;margin:0 auto;padding:48px 24px;color:#111827">
          <p style="margin-bottom:24px">您好！</p>
          <p style="margin-bottom:24px">感谢申请使用 Cascade AI，您的专属邀请码如下：</p>
          <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px">
            <span style="font-size:28px;font-weight:800;letter-spacing:4px;color:#111827">${code}</span>
          </div>
          <p style="margin-bottom:24px">请前往 <a href="${WAITLIST_BASE_URL}" style="color:#2563eb">http://cascadeai.cn/</a> 注册时填写邀请码。</p>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:24px">
            <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#92400e">${trialLabel}</p>
            <p style="margin:0;font-size:13px;color:#b45309">免费期从您<strong>完成注册之日</strong>起开始计算。邀请码领取截止日期：<strong>${codeExpiryStr}</strong>，请在此日期前完成注册，逾期邀请码将失效。</p>
          </div>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0"/>
          <p style="color:#9ca3af;font-size:12px">CascadeAI · ${WAITLIST_BASE_URL.replace(/^https?:\/\//, "")}</p>
        </div>
      `;

      // --- Fix #2: send the email FIRST; only mark the subscriber as
      // "invited" if the send succeeds.  On failure, mark "email_failed" so
      // the next manual re-run (which also selects email_failed) can retry.
      try {
        await sendEmail({
          to: sub.email,
          subject: `您的 Cascade AI 邀请码`,
          html,
          text: `您好！\n\n感谢申请使用 Cascade AI，您的专属邀请码如下：\n\n${code}\n\n请前往 http://cascadeai.cn/ 注册时填写邀请码。\n\n${trialLabel}\n免费期从您完成注册之日起开始计算。邀请码领取截止日期：${codeExpiryStr}，请在此日期前完成注册，逾期邀请码将失效。`,
        });
        await db.update(waitlistSubscribers)
          .set({ status: "invited" })
          .where(eq(waitlistSubscribers.id, sub.id));
        sent++;
        // 限速：Resend 免费套餐 2 req/s，每封间隔 600ms 留余量
        await new Promise(r => setTimeout(r, 600));
      } catch (err) {
        console.error("[invite-email] send failed, marking email_failed", err, sub.email);
        await db.update(waitlistSubscribers)
          .set({ status: "email_failed" })
          .where(eq(waitlistSubscribers.id, sub.id));
        // 失败后也等一下再继续，避免连续触发限速
        await new Promise(r => setTimeout(r, 600));
      }
    }
    return sent;
  }

  // GET /api/admin/export-csv — download waitlist as CSV
  // DELETE /api/admin/otp-limit/:target — clear OTP rate-limit records for an
  // email or phone so the user can request a new code immediately.
  app.delete("/api/admin/otp-limit/:target", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const target = decodeURIComponent(req.params.target).trim().toLowerCase();
      if (!target) return res.status(400).json({ error: "target required" });
      const deleted = await db.delete(otpCodes).where(eq(otpCodes.target, target)).returning({ id: otpCodes.id });
      res.json({ ok: true, deleted: deleted.length });
    } catch (err) {
      console.error("[admin/otp-limit]", err);
      res.status(500).json({ error: "Failed to clear OTP limit" });
    }
  });

  // GET /api/admin/otp-limit/:target — show OTP records for a target
  app.get("/api/admin/otp-limit/:target", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const target = decodeURIComponent(req.params.target).trim().toLowerCase();
      if (!target) return res.status(400).json({ error: "target required" });
      const rows = await db.select({
        id: otpCodes.id, channel: otpCodes.channel, purpose: otpCodes.purpose,
        attempts: otpCodes.attempts, expiresAt: otpCodes.expiresAt,
        consumedAt: otpCodes.consumedAt, createdAt: otpCodes.createdAt,
      }).from(otpCodes).where(eq(otpCodes.target, target))
        .orderBy(desc(otpCodes.createdAt));
      res.json({ items: rows });
    } catch (err) {
      console.error("[admin/otp-limit]", err);
      res.status(500).json({ error: "Failed to fetch OTP records" });
    }
  });

  app.get("/api/admin/export-csv", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const subs = await db.select().from(waitlistSubscribers).orderBy(waitlistSubscribers.createdAt);
      const codes = await db.select().from(inviteCodes);
      const codeBySubId = new Map(codes.filter((c) => c.waitlistSubscriberId != null).map((c) => [c.waitlistSubscriberId!, c]));

      function emailType(email: string, isEdu: boolean): string {
        if (isQizhiEmail(email)) return "奇绩创坛";
        if (isEdu || email.match(/\.edu(\.cn)?(\.|\b)/i)) return "教育";
        return "其他";
      }

      function csvField(v: string | null | undefined): string {
        if (v == null || v === "") return "";
        return `"${v.replace(/"/g, '""')}"`;
      }

      const header = "id,email,邮箱类型,是否发送确认邮件,是否发送邀请码,邀请码,IP地址,注册时间\n";
      const rows = subs.map((s) => {
        const code = codeBySubId.get(s.id);
        return [
          s.id,
          csvField(s.email),
          emailType(s.email, s.isEdu),
          s.confirmationEmailSentAt ? "是" : "否",
          s.status === "invited" ? "是" : "否",
          csvField(code?.code ?? null),
          csvField(s.ipAddress ?? null),
          s.createdAt.toISOString(),
        ].join(",");
      }).join("\n");

      const csv = "﻿" + header + rows; // BOM for Excel UTF-8
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="waitlist.csv"');
      res.send(csv);
    } catch (err) {
      console.error("[admin/export-csv]", err);
      res.status(500).json({ error: "Failed to export CSV" });
    }
  });

  // POST /api/admin/sheet-update — write-back from Google Sheet to DB
  app.post("/api/admin/sheet-update", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const { applySheetUpdate } = await import("../../infra/sheets-sync.js");
      const updates = req.body.updates;
      if (!Array.isArray(updates)) return res.status(400).json({ error: "updates must be an array" });
      const changed = await applySheetUpdate(updates);
      res.json({ ok: true, changed });
    } catch (err) {
      console.error("[admin/sheet-update]", err);
      res.status(500).json({ error: "Failed to apply updates" });
    }
  });

  // POST /api/admin/sync-sheets-now — manually trigger immediate sync
  app.post("/api/admin/sync-sheets-now", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const { syncToSheets } = await import("../../infra/sheets-sync.js");
      await syncToSheets();
      res.json({ ok: true });
    } catch (err) {
      console.error("[admin/sync-sheets-now]", err);
      res.status(500).json({ error: "Sync failed" });
    }
  });

  // GET /api/admin/users — 用户总览：注册状态、最后活跃、项目数、剩余免费期。
  // 活跃时间 = 该用户名下所有项目最新一条 chat_messages 的时间戳（最贴近真实使用）。
  app.get("/api/admin/users", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      // 每用户项目数。
      const projectCounts = await db
        .select({ userId: projects.userId, n: count() })
        .from(projects)
        .groupBy(projects.userId);
      const projectCountMap = new Map<string, number>();
      for (const row of projectCounts) {
        if (row.userId) projectCountMap.set(row.userId, Number(row.n));
      }

      // 每用户最后活跃时间：关联 projects → chat_messages 取最大时间戳（bigint 毫秒）。
      const activity = await db
        .select({ userId: projects.userId, lastTs: sql<string>`max(${chatMessages.timestamp})` })
        .from(chatMessages)
        .innerJoin(projects, eq(chatMessages.projectId, projects.id))
        .groupBy(projects.userId);
      const lastActiveMap = new Map<string, number>();
      for (const row of activity) {
        if (row.userId && row.lastTs != null) lastActiveMap.set(row.userId, Number(row.lastTs));
      }

      const allUsers = await db.select().from(users);
      const now = Date.now();
      const items = allUsers.map((u) => {
        const trialMs = u.trialExpiresAt ? new Date(u.trialExpiresAt).getTime() : null;
        const lastActiveTs = lastActiveMap.get(u.id) ?? null;
        return {
          id: u.id,
          username: u.username,
          email: u.email,
          phone: u.phone,
          // 已激活 = 已兑换邀请码（通过邀请码门）。
          activated: !!u.inviteCode,
          authMethod: u.githubId ? "github" : u.email ? "email" : u.phone ? "phone" : "other",
          projectCount: projectCountMap.get(u.id) ?? 0,
          lastActiveAt: lastActiveTs ? new Date(lastActiveTs).toISOString() : null,
          trialExpiresAt: u.trialExpiresAt ? new Date(u.trialExpiresAt).toISOString() : null,
          // 剩余免费期（秒）；已过期为 0，无试用期为 null。
          trialRemainingSec: trialMs != null ? Math.max(0, Math.floor((trialMs - now) / 1000)) : null,
        };
      });
      // 最近活跃优先（无活跃记录的排末尾）。
      items.sort((a, b) => {
        const ta = a.lastActiveAt ? Date.parse(a.lastActiveAt) : 0;
        const tb = b.lastActiveAt ? Date.parse(b.lastActiveAt) : 0;
        return tb - ta;
      });

      res.json({
        total: items.length,
        activated: items.filter((i) => i.activated).length,
        items,
      });
    } catch (err) {
      console.error("[admin/users]", err);
      res.status(500).json({ error: "Failed to load users" });
    }
  });
}
