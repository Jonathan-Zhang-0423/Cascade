import type { Express } from "express";
import { z } from "zod";
import { eq, desc, count } from "drizzle-orm";
import { db } from "../../infra/db";
import { waitlistSubscribers, inviteCodes } from "@cascade/database";
import { sendEmail } from "../../infra/email";
import { isEduEmail, getTrialInfo, formatInviteCode } from "../services/invite-service";
import { checkAdmin } from "../middleware/auth-middleware";

const WAITLIST_BASE_URL = process.env.BASE_URL ?? process.env.APP_BASE_URL ?? "https://cascadeai.co";

/**
 * Waitlist routes (Step C). POST is public (join + auto-issue invite email);
 * GET is admin-gated. Logic helpers live in invite-service; behavior unchanged.
 */
export function registerWaitlistRoutes(app: Express): void {
  // POST /api/waitlist — public submit
  app.post("/api/waitlist", async (req, res) => {
    try {
      const schema = z.object({ email: z.string().email() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Valid email required" });
      const email = parsed.data.email.trim().toLowerCase();
      const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null;
      const isEdu = isEduEmail(email);

      const existing = await db.select().from(waitlistSubscribers).where(eq(waitlistSubscribers.email, email));
      if (existing.length > 0) {
        return res.json({ queued: true, alreadyOnList: true });
      }

      const [sub] = await db.insert(waitlistSubscribers).values({ email, ipAddress, isEdu }).returning();

      // Immediately allocate an invite code and send the invite email.
      (async () => {
        try {
          const { trialDays, codeExpiresAt, label: trialLabel } = getTrialInfo(email, isEdu);
          let code = "";
          let allocated = false;
          for (let attempt = 0; attempt < 5 && !allocated; attempt++) {
            try {
              await db.transaction(async (tx) => {
                code = formatInviteCode(email);
                await tx.insert(inviteCodes).values({
                  code,
                  isEdu,
                  trialDays,
                  expiresAt: codeExpiresAt,
                  waitlistSubscriberId: sub.id,
                });
              });
              allocated = true;
            } catch (err: any) {
              const msg: string = err?.message ?? "";
              if (!msg.includes("unique") && !msg.includes("duplicate")) throw err;
            }
          }
          if (!allocated) {
            console.error(`[waitlist/invite] failed to allocate code for ${email}`);
            return;
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
          await sendEmail({
            to: email,
            subject: `您的 Cascade AI 邀请码`,
            html,
            text: `您好！\n\n感谢申请使用 Cascade AI，您的专属邀请码如下：\n\n${code}\n\n请前往 http://cascadeai.cn/ 注册时填写邀请码。\n\n${trialLabel}\n免费期从您完成注册之日起开始计算。邀请码领取截止日期：${codeExpiryStr}，请在此日期前完成注册，逾期邀请码将失效。`,
          });
          await db.update(waitlistSubscribers).set({ status: "invited" }).where(eq(waitlistSubscribers.id, sub.id));
        } catch (err) {
          console.error("[waitlist/invite]", err);
          await db.update(waitlistSubscribers).set({ status: "email_failed" }).where(eq(waitlistSubscribers.id, sub.id));
        }
      })();

      res.json({ queued: true });
    } catch (err) {
      console.error("[waitlist/submit]", err);
      res.status(500).json({ error: "Failed to join waitlist" });
    }
  });

  // GET /api/waitlist — admin list
  app.get("/api/waitlist", async (req, res) => {
    if (!checkAdmin(req, res)) return;
    try {
      const [subs, [totalRow]] = await Promise.all([
        db.select().from(waitlistSubscribers).orderBy(desc(waitlistSubscribers.createdAt)),
        db.select({ total: count() }).from(waitlistSubscribers),
      ]);
      // Pull the most recent invite code per subscriber for the admin view.
      const issuedCodes = await db.select().from(inviteCodes);
      const codeBySubId = new Map<number, typeof issuedCodes[number]>();
      for (const c of issuedCodes) {
        if (c.waitlistSubscriberId) codeBySubId.set(c.waitlistSubscriberId, c);
      }
      res.json({
        total: totalRow?.total ?? 0,
        subscribers: subs.map((s) => {
          const c = codeBySubId.get(s.id);
          return {
            id: s.id,
            email: s.email,
            createdAt: s.createdAt,
            isEdu: s.isEdu,
            status: s.status,
            batchId: s.batchId,
            inviteCode: c?.code ?? null,
            invitedAt: c?.createdAt ?? null,
            expiresAt: c?.expiresAt ?? null,
            seqNum: c?.id ?? null,
            registeredAt: c?.redeemedAt ?? null,
          };
        }),
      });
    } catch (err) {
      console.error("[waitlist/list]", err);
      res.status(500).json({ error: "Failed to fetch waitlist" });
    }
  });
}
