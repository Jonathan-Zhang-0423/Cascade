// One-shot backfill: gives every pre-existing user a referral code.
//
// The app already lazy-generates a code on first /api/referral/my-code hit or
// at registration (see ensureReferralCode in routes/index.ts). This script just
// fills them in eagerly for existing users so the referral feature isn't blank.
//
// Run once after `db:push` adds users.referral_code:
//   npx tsx scripts/backfill-referral-codes.ts
//
// Idempotent — only touches users whose referralCode is null. Safe to re-run.
//
// IMPORTANT: keep the code format in sync with ensureReferralCode /
// referralCodePrefix / randomSuffix in backend/api/src/api/routes/index.ts.
// prefix + 6 unambiguous chars, no separator. CSPRNG suffix (not Math.random).
import "dotenv/config";
import { eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../backend/api/src/infra/db";
import { users } from "@cascade/database";

// --- mirrors routes/index.ts ---
function randomSuffix(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // length 32, divides 256 → bias-free
  const bytes = randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[bytes[i] % chars.length];
  return s;
}

function isEduEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return lower.endsWith(".edu.cn") || lower.endsWith(".edu");
}

function isQizhiEmail(email: string): boolean {
  return email.toLowerCase().endsWith("@miracleplus.com");
}

function prefixForEmail(email: string | null): string {
  const e = email ?? "";
  if (isQizhiEmail(e)) return "CASCQJ";
  if (isEduEmail(e)) return "CASCEDU";
  return "CASC";
}
// --- end mirror ---

async function main() {
  const pending = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(users)
    .where(isNull(users.referralCode));

  console.log(`[backfill-referral] ${pending.length} users without a referral code`);
  if (pending.length === 0) return;

  // Track codes issued during this run so we don't collide within the batch
  // (the DB unique constraint is the real guard, but this avoids wasted retries).
  const issued = new Set<string>();
  let ok = 0;
  const failures: string[] = [];

  for (const u of pending) {
    const prefix = prefixForEmail(u.email);
    let done = false;
    for (let i = 0; i < 20; i++) {
      const code = `${prefix}${randomSuffix()}`;
      if (issued.has(code)) continue;
      try {
        await db.update(users).set({ referralCode: code }).where(eq(users.id, u.id));
        done = true;
        issued.add(code);
        ok++;
        break;
      } catch {
        // unique-constraint collision — retry with a new suffix
      }
    }
    if (!done) failures.push(u.username);
  }

  console.log(`[backfill-referral] assigned ${ok} codes`);
  if (failures.length) {
    console.error(`[backfill-referral] FAILED for ${failures.length}: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main()
  .then(() => {
    console.log("[backfill-referral] done");
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("[backfill-referral] failed", err);
    process.exit(1);
  });
