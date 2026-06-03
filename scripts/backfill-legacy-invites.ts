// One-shot backfill: gives every pre-existing user a sentinel "LEGACY" invite
// code so the new gate (App.tsx + GitHub OAuth callback) doesn't bounce them.
//
// Run once after `pnpm db:push` adds the new tables and columns:
//   npx tsx scripts/backfill-legacy-invites.ts
//
// Idempotent — safe to re-run; only updates users whose inviteCode is null.
import "dotenv/config";
import { eq, isNull } from "drizzle-orm";
import { db } from "../backend/api/src/infra/db";
import { users, inviteCodes } from "@cascade/database";

const LEGACY_CODE = "LEGACY";
const FAR_FUTURE = new Date("2099-12-31T00:00:00Z");

async function main() {
  // Sentinel code row — never redeemed via the normal flow; we set
  // users.inviteCode = LEGACY directly below.
  const existing = await db.select().from(inviteCodes).where(eq(inviteCodes.code, LEGACY_CODE));
  if (existing.length === 0) {
    await db.insert(inviteCodes).values({
      code: LEGACY_CODE,
      isEdu: false,
      trialDays: 36500,
      expiresAt: FAR_FUTURE,
    });
    console.log("[backfill] inserted sentinel LEGACY invite code");
  } else {
    console.log("[backfill] sentinel LEGACY invite code already present");
  }

  const legacyUsers = await db.select({ id: users.id, username: users.username })
    .from(users).where(isNull(users.inviteCode));
  console.log(`[backfill] ${legacyUsers.length} users without an invite code`);
  if (legacyUsers.length === 0) return;

  await db.update(users)
    .set({ inviteCode: LEGACY_CODE, trialExpiresAt: FAR_FUTURE })
    .where(isNull(users.inviteCode));
  console.log(`[backfill] updated ${legacyUsers.length} users`);
}

main().then(() => {
  console.log("[backfill] done");
  process.exit(0);
}).catch((err) => {
  console.error("[backfill] failed", err);
  process.exit(1);
});
