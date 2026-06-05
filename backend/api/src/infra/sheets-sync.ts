import { google } from "googleapis";
import { db } from "./db.js";
import { waitlistSubscribers, inviteCodes } from "@cascade/database";
import { eq } from "drizzle-orm";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? "";
const CREDENTIALS_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
const SHEET_NAME = "Waitlist";

// Column order must match header row
const HEADERS = [
  "id", "email", "邮箱类型", "是否发送确认邮件", "是否发送邀请码", "邀请码", "IP地址", "注册时间"
];

function emailType(email: string, isEdu: boolean): string {
  if (email.endsWith("@westlake.edu.cn") || email.endsWith("@qizhi.com") || email.includes("qizhi")) return "奇绩创坛";
  if (isEdu || /\.edu(\.|$)/i.test(email)) return "教育";
  return "其他";
}

function getAuth() {
  if (!CREDENTIALS_JSON) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const creds = JSON.parse(CREDENTIALS_JSON);
  return new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
}

export async function syncToSheets(): Promise<void> {
  if (!SHEET_ID || !CREDENTIALS_JSON) return;

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Load all subscribers + invite codes
  const [subs, codes] = await Promise.all([
    db.select().from(waitlistSubscribers).orderBy(waitlistSubscribers.createdAt),
    db.select().from(inviteCodes),
  ]);

  const codeBySubId = new Map(
    codes.filter((c) => c.waitlistSubscriberId != null).map((c) => [c.waitlistSubscriberId!, c])
  );

  const rows: string[][] = [
    HEADERS,
    ...subs.map((s) => {
      const code = codeBySubId.get(s.id);
      return [
        String(s.id),
        s.email,
        emailType(s.email, s.isEdu),
        s.confirmationEmailSentAt ? "是" : "否",
        s.status === "invited" ? "是" : "否",
        code?.code ?? "",
        s.ipAddress ?? "",
        s.createdAt.toISOString(),
      ];
    }),
  ];

  // Ensure the named sheet tab exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const tabExists = meta.data.sheets?.some(
    (sh) => sh.properties?.title === SHEET_NAME
  );
  if (!tabExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
      },
    });
  }

  // Full overwrite: clear then write
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:Z`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

// Write-back: update a single subscriber from Sheet data
export async function applySheetUpdate(updates: {
  id: number;
  status?: string;
  confirmationEmailSentAt?: string | null;
}[]): Promise<number> {
  let changed = 0;
  for (const u of updates) {
    const patch: Partial<typeof waitlistSubscribers.$inferInsert> = {};
    if (u.status === "invited" || u.status === "pending") patch.status = u.status;
    if ("confirmationEmailSentAt" in u) {
      (patch as any).confirmationEmailSentAt = u.confirmationEmailSentAt
        ? new Date(u.confirmationEmailSentAt)
        : null;
    }
    if (Object.keys(patch).length === 0) continue;
    await db.update(waitlistSubscribers).set(patch).where(eq(waitlistSubscribers.id, u.id));
    changed++;
  }
  return changed;
}

// Start 1-minute cron
export function startSheetsSync(): void {
  if (!SHEET_ID || !CREDENTIALS_JSON) {
    console.log("[sheets-sync] GOOGLE_SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping");
    return;
  }
  console.log("[sheets-sync] starting 1-minute sync to Google Sheets");
  syncToSheets().catch((err) => console.error("[sheets-sync] initial sync failed:", err));
  setInterval(() => {
    syncToSheets().catch((err) => console.error("[sheets-sync] sync error:", err));
  }, 60_000);
}
