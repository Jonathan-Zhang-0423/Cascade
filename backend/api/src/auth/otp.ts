import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { otpCodes, type OtpCode } from "@cascade/database";
import { db } from "../infra/db";
import { sendEmail } from "../infra/email";
import { sendSmsOtp } from "../infra/sms";

export type OtpChannel = "email" | "sms";
export type OtpPurpose = "login";

const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SEC = 60;
const HOURLY_SEND_LIMIT = 5;
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function normalizeTarget(channel: OtpChannel, raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (channel === "email") {
    const lower = trimmed.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) return null;
    return lower;
  }
  // Phone: require E.164 (+ followed by 8–15 digits)
  if (!/^\+\d{8,15}$/.test(trimmed)) return null;
  return trimmed;
}

export type SendOtpResult =
  | { ok: true }
  | { ok: false; error: "rate_limited"; retryAfterSec: number };

export async function sendOtp(args: {
  channel: OtpChannel;
  target: string;
  purpose: OtpPurpose;
}): Promise<SendOtpResult> {
  const { channel, target, purpose } = args;
  const now = new Date();

  // 60-second resend cooldown for this exact (target, purpose)
  const [latest] = await db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(and(eq(otpCodes.target, target), eq(otpCodes.purpose, purpose)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (latest) {
    const elapsed = (now.getTime() - latest.createdAt.getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SEC) {
      return { ok: false, error: "rate_limited", retryAfterSec: Math.ceil(RESEND_COOLDOWN_SEC - elapsed) };
    }
  }

  // Hourly cap per target (across purposes)
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [{ value: hourCount }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(and(eq(otpCodes.target, target), gt(otpCodes.createdAt, oneHourAgo)));
  if (hourCount >= HOURLY_SEND_LIMIT) {
    return { ok: false, error: "rate_limited", retryAfterSec: 60 * 60 };
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000);

  await db.insert(otpCodes).values({ channel, target, codeHash, purpose, expiresAt });

  if (channel === "email") {
    await sendEmail({
      to: target,
      subject: `Your Cascade verification code: ${code}`,
      text: `Your Cascade verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. If you didn't request this, ignore this email.`,
      html: `<p>Your Cascade verification code is <strong style="font-size:20px;letter-spacing:4px">${code}</strong>.</p><p>It expires in ${CODE_TTL_MINUTES} minutes. If you didn't request this, ignore this email.</p>`,
    });
  } else {
    await sendSmsOtp({ to: target, code, expiresMinutes: CODE_TTL_MINUTES });
  }

  return { ok: true };
}

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; error: "invalid_or_expired" | "locked" };

export async function verifyOtp(args: {
  channel: OtpChannel;
  target: string;
  code: string;
  purpose: OtpPurpose;
}): Promise<VerifyOtpResult> {
  const { target, code, purpose } = args;
  const now = new Date();

  const [row]: OtpCode[] = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.target, target),
        eq(otpCodes.purpose, purpose),
        isNull(otpCodes.consumedAt),
        gt(otpCodes.expiresAt, now),
      ),
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!row) return { ok: false, error: "invalid_or_expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "locked" };

  const match = await bcrypt.compare(code, row.codeHash);
  if (!match) {
    await db
      .update(otpCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(otpCodes.id, row.id));
    if (row.attempts + 1 >= MAX_ATTEMPTS) return { ok: false, error: "locked" };
    return { ok: false, error: "invalid_or_expired" };
  }

  await db.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, row.id));
  return { ok: true };
}
