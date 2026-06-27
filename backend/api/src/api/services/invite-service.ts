import { randomBytes } from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../infra/db";
import { users, inviteCodes, waitlistSubscribers, subscriptionGrants } from "@cascade/database";

/**
 * Invite-code / trial / referral service. These were closures inside
 * registerRoutes shared across the auth, referral, waitlist, and admin route
 * groups. Consolidated here (single source of truth) so those domains can be
 * split into their own route modules without duplicating the logic. Pure
 * functions over the DB + env — no request/closure state. Behavior unchanged.
 */

// ── Tier / trial policy ──────────────────────────────────────────────────────
const TRIAL_DAYS_NORMAL = 30;
const TRIAL_DAYS_EDU = 60;
const CODE_EXPIRY_DAYS = 90; // how long an issued code stays claimable
export const QIZHI_FREE_UNTIL = new Date("2026-09-30T23:59:59+08:00");
export const REFERRAL_GRANT_DAYS = 30;
// Anti-abuse cap on how many referrals earn the *inviter* a reward.
export const REFERRAL_MAX_REWARDED = 10;

export function isEduEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return lower.endsWith(".edu.cn") || lower.endsWith(".edu");
}

export function isQizhiEmail(email: string): boolean {
  return email.toLowerCase().endsWith("@miracleplus.com");
}

export function getTrialInfo(email: string, isEdu: boolean): { trialDays: number; codeExpiresAt: Date; label: string } {
  const codeExpiresAt = new Date(Date.now() + CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  if (isQizhiEmail(email)) {
    const daysUntilDeadline = Math.ceil((QIZHI_FREE_UNTIL.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return {
      trialDays: daysUntilDeadline,
      codeExpiresAt,
      label: "奇绩创坛专属免费期至 2026 年 9 月 30 日（自注册之日起计算）",
    };
  }
  if (isEdu) {
    return { trialDays: TRIAL_DAYS_EDU, codeExpiresAt, label: `教育优惠免费期 ${TRIAL_DAYS_EDU} 天（自注册之日起计算）` };
  }
  return { trialDays: TRIAL_DAYS_NORMAL, codeExpiresAt, label: `免费试用期 ${TRIAL_DAYS_NORMAL} 天（自注册之日起计算）` };
}

// ── Code generation ────────────────────────────────────────────────────────
// 6-char suffix from an unambiguous charset via CSPRNG (not Math.random) so
// codes can't be enumerated/guessed. charset length 32 divides 256 → bias-free.
export function randomSuffix(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[bytes[i] % chars.length];
  return s;
}

export function inviteCodePrefix(email: string): string {
  if (isQizhiEmail(email)) return "CASCQJ";
  if (isEduEmail(email)) return "CASCEDU";
  return "CASC";
}

export function formatInviteCode(email: string): string {
  return `${inviteCodePrefix(email)}${randomSuffix()}`;
}

// ── Invite redemption ──────────────────────────────────────────────────────
export type RedeemResult =
  | { ok: true; trialExpiresAt: Date; code: string }
  | { ok: false; error: "Invalid invite code" | "Invite code already used" | "Invite code expired" };

export async function redeemInviteCode(code: string, userId: string): Promise<RedeemResult> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, error: "Invalid invite code" };
  const [invite] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, trimmed));
  if (!invite) return { ok: false, error: "Invalid invite code" };
  if (invite.redeemedByUserId) return { ok: false, error: "Invite code already used" };
  if (new Date(invite.expiresAt).getTime() < Date.now()) return { ok: false, error: "Invite code expired" };
  const now = new Date();
  let trialExpiresAt = new Date(now.getTime() + invite.trialDays * 24 * 60 * 60 * 1000);
  if (invite.waitlistSubscriberId) {
    const [sub] = await db.select({ email: waitlistSubscribers.email })
      .from(waitlistSubscribers)
      .where(eq(waitlistSubscribers.id, invite.waitlistSubscriberId));
    if (sub && isQizhiEmail(sub.email)) {
      trialExpiresAt = QIZHI_FREE_UNTIL < trialExpiresAt ? QIZHI_FREE_UNTIL : trialExpiresAt;
    }
  }
  const updated = await db.update(inviteCodes)
    .set({ redeemedByUserId: userId, redeemedAt: now })
    .where(and(eq(inviteCodes.id, invite.id), isNull(inviteCodes.redeemedByUserId)))
    .returning({ id: inviteCodes.id });
  if (updated.length === 0) return { ok: false, error: "Invite code already used" };
  return { ok: true, trialExpiresAt, code: trimmed };
}

// ── Referral ─────────────────────────────────────────────────────────────────
async function referralCodePrefix(userId: string): Promise<string> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const email = row?.email ?? "";
  if (isQizhiEmail(email)) return "CASCQJ";
  if (isEduEmail(email)) return "CASCEDU";
  return "CASC";
}

/** Ensure the user has a referral code, generating one (retry on collision). */
export async function ensureReferralCode(userId: string): Promise<string> {
  const [row] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId));
  if (row?.referralCode) return row.referralCode;
  const prefix = await referralCodePrefix(userId);
  for (let i = 0; i < 20; i++) {
    const code = `${prefix}${randomSuffix()}`;
    try {
      await db.update(users).set({ referralCode: code }).where(eq(users.id, userId));
      return code;
    } catch {
      // unique constraint violation — retry with a new suffix
    }
  }
  throw new Error("Failed to generate referral code after 20 attempts");
}

/** Extend trialExpiresAt by N days (from now or current expiry, whichever later). */
export async function extendTrial(userId: string, days: number, reason: string, relatedUserId?: string): Promise<void> {
  const [row] = await db.select({ trialExpiresAt: users.trialExpiresAt }).from(users).where(eq(users.id, userId));
  const base = row?.trialExpiresAt && row.trialExpiresAt > new Date() ? row.trialExpiresAt : new Date();
  const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  await db.update(users).set({ trialExpiresAt: newExpiry }).where(eq(users.id, userId));
  await db.insert(subscriptionGrants).values({ userId, grantedDays: days, reason, relatedUserId: relatedUserId ?? null });
}
