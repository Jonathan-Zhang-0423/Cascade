import { db } from "./db.js";
import { waitlistSubscribers, inviteCodes } from "@cascade/database";
import { eq } from "drizzle-orm";

const APP_ID = process.env.FEISHU_APP_ID ?? "";
const APP_SECRET = process.env.FEISHU_APP_SECRET ?? "";
const BITABLE_APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN ?? "T6CvbWtMiaN0zasaIIacG9jWnzb";
const TABLE_ID = process.env.FEISHU_BITABLE_TABLE_ID ?? "tblakWqZo22ESYtV";

const FEISHU_API = "https://open.feishu.cn/open-apis";

// Column field names in the bitable (must match table headers exactly)
const FIELD_ID = "id";
const FIELD_EMAIL = "email";
const FIELD_EMAIL_TYPE = "邮箱类型";
const FIELD_CONFIRMATION_SENT = "是否发送确认邮件";
const FIELD_INVITE_SENT = "是否发送邀请码";
const FIELD_INVITE_CODE = "邀请码";
const FIELD_IP = "IP地址";
const FIELD_CREATED_AT = "注册时间";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getTenantToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const resp = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = (await resp.json()) as { tenant_access_token?: string; expire?: number; code?: number; msg?: string };
  if (!data.tenant_access_token) {
    throw new Error(`[feishu-sync] auth failed: ${data.msg ?? JSON.stringify(data)}`);
  }
  cachedToken = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire ?? 7200) * 1000,
  };
  return cachedToken.token;
}

function emailType(email: string, isEdu: boolean): string {
  if (
    email.endsWith("@westlake.edu.cn") ||
    email.endsWith("@qizhi.com") ||
    email.includes("qizhi")
  )
    return "奇绩创坛";
  if (isEdu || /\.edu(\.|$)/i.test(email)) return "教育";
  return "其他";
}

async function feishuRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getTenantToken();
  const resp = await fetch(`${FEISHU_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await resp.json()) as { code?: number; msg?: string; data?: unknown };
  if (json.code !== 0) {
    throw new Error(`[feishu-sync] API error ${json.code}: ${json.msg} (${path})`);
  }
  return json.data as T;
}

// Fetch all existing records from the bitable, returns map of db_id → record_id
async function fetchExistingRecords(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ page_size: "500" });
    if (pageToken) params.set("page_token", pageToken);

    const data = await feishuRequest<{
      items?: Array<{ record_id: string; fields: Record<string, unknown> }>;
      has_more?: boolean;
      page_token?: string;
    }>(
      "GET",
      `/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TABLE_ID}/records?${params}`,
    );

    for (const item of data.items ?? []) {
      const rawId = item.fields[FIELD_ID];
      const dbId =
        typeof rawId === "number"
          ? rawId
          : typeof rawId === "string"
          ? parseInt(rawId, 10)
          : NaN;
      if (!isNaN(dbId)) map.set(dbId, item.record_id);
    }

    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);

  return map;
}

export async function syncToFeishu(): Promise<void> {
  if (!APP_ID || !APP_SECRET) return;

  const [subs, codes] = await Promise.all([
    db.select().from(waitlistSubscribers).orderBy(waitlistSubscribers.createdAt),
    db.select().from(inviteCodes),
  ]);

  const codeBySubId = new Map(
    codes
      .filter((c) => c.waitlistSubscriberId != null)
      .map((c) => [c.waitlistSubscriberId!, c]),
  );

  const existingRecords = await fetchExistingRecords();

  const toCreate: Array<{ fields: Record<string, unknown> }> = [];
  const toUpdate: Array<{ record_id: string; fields: Record<string, unknown> }> = [];

  for (const s of subs) {
    const code = codeBySubId.get(s.id);
    const fields: Record<string, unknown> = {
      [FIELD_ID]: s.id,
      [FIELD_EMAIL]: s.email,
      [FIELD_EMAIL_TYPE]: emailType(s.email, s.isEdu),
      [FIELD_CONFIRMATION_SENT]: s.confirmationEmailSentAt ? "是" : "否",
      [FIELD_INVITE_SENT]: s.status === "invited" ? "是" : "否",
      [FIELD_INVITE_CODE]: code?.code ?? "",
      [FIELD_IP]: s.ipAddress ?? "",
      [FIELD_CREATED_AT]: s.createdAt.toISOString(),
    };

    const existingRecordId = existingRecords.get(s.id);
    if (existingRecordId) {
      toUpdate.push({ record_id: existingRecordId, fields });
    } else {
      toCreate.push({ fields });
    }
  }

  // Batch create (max 500 per request)
  for (let i = 0; i < toCreate.length; i += 500) {
    const batch = toCreate.slice(i, i + 500);
    await feishuRequest(
      "POST",
      `/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TABLE_ID}/records/batch_create`,
      { records: batch },
    );
  }

  // Batch update (max 500 per request)
  for (let i = 0; i < toUpdate.length; i += 500) {
    const batch = toUpdate.slice(i, i + 500);
    await feishuRequest(
      "POST",
      `/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TABLE_ID}/records/batch_update`,
      { records: batch },
    );
  }

  console.log(
    `[feishu-sync] synced ${toCreate.length} new + ${toUpdate.length} updated records`,
  );
}

// Write-back: update a single subscriber from Feishu edits
export async function applyFeishuUpdate(
  updates: {
    id: number;
    status?: string;
    confirmationEmailSentAt?: string | null;
  }[],
): Promise<number> {
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
    await db
      .update(waitlistSubscribers)
      .set(patch)
      .where(eq(waitlistSubscribers.id, u.id));
    changed++;
  }
  return changed;
}

export function startFeishuSync(): void {
  if (!APP_ID || !APP_SECRET) {
    console.log("[feishu-sync] FEISHU_APP_ID or FEISHU_APP_SECRET not set — skipping");
    return;
  }
  console.log("[feishu-sync] starting 1-minute sync to Feishu Bitable");
  syncToFeishu().catch((err) => console.error("[feishu-sync] initial sync failed:", err));
  setInterval(() => {
    syncToFeishu().catch((err) => console.error("[feishu-sync] sync error:", err));
  }, 60_000);
}
