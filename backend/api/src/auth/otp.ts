import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { otpCodes, type OtpCode } from "@cascade/database";
import { db } from "../infra/db";
import { sendEmail } from "../infra/email";
import { sendSmsOtp } from "../infra/sms";

export type OtpChannel = "email" | "sms";
export type OtpPurpose = "login" | "reset_password";

const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SEC = 60;
const HOURLY_SEND_LIMIT = 5;
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function normalizeTarget(channel: OtpChannel, raw: string): string | null {
  // Guard against type-confused input (object/array/number) — only strings can
  // be a valid target; anything else normalizes to "no target".
  const trimmed = (typeof raw === "string" ? raw : "").trim();
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

  // NOTE: all time comparisons below are done with the DB clock (now() /
  // interval) rather than a JS `new Date()`. The otp_codes timestamp columns
  // are physically `timestamp without time zone` in the live DB, so the pg
  // driver parses them in the Node process's local timezone — comparing such a
  // value against a JS UTC Date drifts by the process's UTC offset and silently
  // disables the cooldown / hourly cap. Letting Postgres do the arithmetic
  // avoids that entirely.

  // 60-second resend cooldown for this exact (target, purpose).
  const [cooldownRow] = await db
    .select({
      elapsedSec: sql<number>`extract(epoch from (now() - ${otpCodes.createdAt}))`,
    })
    .from(otpCodes)
    .where(and(eq(otpCodes.target, target), eq(otpCodes.purpose, purpose)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (cooldownRow) {
    const elapsed = Number(cooldownRow.elapsedSec);
    if (Number.isFinite(elapsed) && elapsed < RESEND_COOLDOWN_SEC) {
      return { ok: false, error: "rate_limited", retryAfterSec: Math.ceil(RESEND_COOLDOWN_SEC - elapsed) };
    }
  }

  // Hourly cap per target (across purposes), counted against the DB clock.
  const [{ value: hourCount }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(and(eq(otpCodes.target, target), gt(otpCodes.createdAt, sql`now() - interval '1 hour'`)));
  if (hourCount >= HOURLY_SEND_LIMIT) {
    return { ok: false, error: "rate_limited", retryAfterSec: 60 * 60 };
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);

  const [inserted] = await db.insert(otpCodes).values({
    channel,
    target,
    codeHash,
    purpose,
    // Compute expiry on the DB clock for the same tz-safety reason.
    expiresAt: sql`now() + interval '${sql.raw(String(CODE_TTL_MINUTES))} minutes'`,
  }).returning({ id: otpCodes.id });

  // Send the code. If delivery throws (e.g. unverified sender domain, provider
  // outage), roll back the row we just inserted — otherwise a failed send would
  // still burn the 60s cooldown and the hourly cap, blocking the user's retry.
  try {
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
  } catch (err) {
    await db.delete(otpCodes).where(eq(otpCodes.id, inserted.id)).catch(() => {});
    throw err;
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

  const [row]: OtpCode[] = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.target, target),
        eq(otpCodes.purpose, purpose),
        isNull(otpCodes.consumedAt),
        // Compare expiry on the DB clock — see the tz note in sendOtp().
        gt(otpCodes.expiresAt, sql`now()`),
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

  await db.update(otpCodes).set({ consumedAt: sql`now()` }).where(eq(otpCodes.id, row.id));
  return { ok: true };
}
