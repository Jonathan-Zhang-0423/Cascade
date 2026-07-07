import type { Express } from "express";
import { eq, count } from "drizzle-orm";
import { db } from "../../infra/db";
import { users } from "@cascade/database";
import {
  ensureReferralCode, extendTrial, REFERRAL_GRANT_DAYS, REFERRAL_MAX_REWARDED,
} from "../services/invite-service";

/**
 * Referral routes (Step C). Logic helpers live in services/invite-service.ts;
 * this module only wires the two endpoints. Behavior unchanged.
 */
export function registerReferralRoutes(app: Express): void {
  // GET /api/referral/my-code — return the current user's referral code and stats
  app.get("/api/referral/my-code", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const code = await ensureReferralCode(userId);

      const [{ referralCount }] = await db
        .select({ referralCount: count() })
        .from(users)
        .where(eq(users.referredBy, userId));

      const baseUrl = process.env.APP_BASE_URL || "http://localhost:5000";
      res.json({
        referralCode: code,
        referralLink: `${baseUrl}/register?ref=${code}`,
        referralCount: Number(referralCount),
        grantDays: REFERRAL_GRANT_DAYS,
      });
    } catch (err) {
      console.error("[referral/my-code]", err);
      res.status(500).json({ error: "Failed to get referral code" });
    }
  });

  // POST /api/referral/redeem — new user redeems a referral code after registration
  app.post("/api/referral/redeem", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { referralCode: code } = req.body as { referralCode?: string };
      if (!code?.trim()) return res.status(400).json({ error: "Referral code required" });

      const [me] = await db.select({ referredBy: users.referredBy }).from(users).where(eq(users.id, userId));
      if (me?.referredBy) return res.status(400).json({ error: "You have already used a referral code" });

      const [referrer] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code.trim().toUpperCase()));
      if (!referrer) return res.status(400).json({ error: "Invalid referral code" });
      if (referrer.id === userId) return res.status(400).json({ error: "You cannot use your own referral code" });

      // Invitee always gets the one-time reward; the inviter's reward is capped
      // (anti-abuse). Count existing referrals BEFORE recording this one.
      const [{ priorReferrals }] = await db
        .select({ priorReferrals: count() })
        .from(users)
        .where(eq(users.referredBy, referrer.id));

      await db.update(users).set({ referredBy: referrer.id }).where(eq(users.id, userId));
      await extendTrial(userId, REFERRAL_GRANT_DAYS, "referral_invitee", referrer.id);

      const inviterRewarded = Number(priorReferrals) < REFERRAL_MAX_REWARDED;
      if (inviterRewarded) {
        await extendTrial(referrer.id, REFERRAL_GRANT_DAYS, "referral_inviter", userId);
      }

      res.json({ ok: true, grantedDays: REFERRAL_GRANT_DAYS, inviterRewarded });
    } catch (err) {
      console.error("[referral/redeem]", err);
      res.status(500).json({ error: "Failed to redeem referral code" });
    }
  });
}
