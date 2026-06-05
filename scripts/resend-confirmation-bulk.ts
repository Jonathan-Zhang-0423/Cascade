/**
 * 补发确认邮件脚本
 * 给 waitlist_subscribers 表中所有用户发送一次确认邮件
 *
 * 使用方法（在服务器上执行）：
 *   npx tsx scripts/resend-confirmation-bulk.ts
 *
 * 可选参数：
 *   --dry-run   只打印邮件列表，不实际发送
 *   --limit N   限制最多发送 N 封（用于测试）
 *
 * 示例：
 *   npx tsx scripts/resend-confirmation-bulk.ts --dry-run
 *   npx tsx scripts/resend-confirmation-bulk.ts --limit 10
 *   npx tsx scripts/resend-confirmation-bulk.ts
 */

import "dotenv/config";
import pg from "pg";
import { Resend } from "resend";

// ── 配置 ──────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM_EMAIL = process.env.FROM_EMAIL || "CascadeAI <noreply@cascadeai.co>";
const BASE_URL = process.env.WAITLIST_BASE_URL || "cascadeai.co";

// Resend 免费版每秒限速 2 封，付费版更高；这里保守用 500ms 间隔
const DELAY_MS = 500;
// ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL 未设置");
  process.exit(1);
}
if (!RESEND_API_KEY && !DRY_RUN) {
  console.error("❌ RESEND_API_KEY 未设置");
  process.exit(1);
}

function buildEmail(_email: string): { html: string; text: string } {
  const domain = BASE_URL.replace(/^https?:\/\//, "");
  const logoSvg = `data:image/svg+xml;base64,${Buffer.from('<svg viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="175" y="155" width="56" height="260" fill="#111111"/><rect x="355" y="275" width="56" height="245" fill="#111111"/><rect x="540" y="380" width="65" height="255" fill="#111111"/></svg>').toString("base64")}`;
  const html = `
    <div style="font-family:'Helvetica Neue',sans-serif;max-width:560px;margin:0 auto;padding:48px 24px;color:#111827">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px">
        <img src="${logoSvg}" alt="Cascade AI" width="28" height="28" style="display:inline-block;vertical-align:middle"/>
        <span style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#111827;vertical-align:middle">Cascade AI</span>
      </div>
      <h2 style="font-size:22px;font-weight:700;margin-bottom:16px;color:#111827">Thanks for signing up!</h2>
      <p style="color:#374151;font-size:15px;line-height:1.7;margin-bottom:16px">Hi there,</p>
      <p style="color:#374151;font-size:15px;line-height:1.7;margin-bottom:16px">
        Thanks for checking out Cascade AI! We're stoked to invite you to our founding user cohort — your first month is on us.
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.7;margin-bottom:16px">
        Our engineering team is shipping non&#8209;stop to build an AI Agent that redefines how developers build with AI. We'll drop full launch details as we inch closer to the big day. Stay tuned for updates :)
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.7;margin-bottom:4px">Jonathan</p>
      <p style="color:#6b7280;font-size:14px;line-height:1.6;margin-bottom:32px">Founder, Cascade AI</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0"/>
      <p style="color:#9ca3af;font-size:12px">Cascade AI · ${domain}</p>
    </div>
  `;
  const text = `Hi there,\n\nThanks for checking out Cascade AI! We're stoked to invite you to our founding user cohort — your first month is on us.\n\nOur engineering team is shipping non‑stop to build an AI Agent that redefines how developers build with AI. We'll drop full launch details as we inch closer to the big day. Stay tuned for updates :)\n\nJonathan\nFounder, Cascade AI\n\nCascade AI · ${domain}`;
  return { html, text };
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const resend = DRY_RUN ? null : new Resend(RESEND_API_KEY);

  // 查询所有 waitlist 用户
  const { rows } = await pool.query<{ email: string }>(
    "SELECT email FROM waitlist_subscribers ORDER BY created_at ASC"
  );

  const emails = rows.map((r) => r.email).slice(0, isFinite(LIMIT) ? LIMIT : undefined);

  console.log(`\n📋 共找到 ${rows.length} 位用户，本次处理 ${emails.length} 位`);
  if (DRY_RUN) console.log("🔍 DRY RUN 模式 — 不会实际发送\n");

  let sent = 0;
  let failed = 0;

  for (const email of emails) {
    if (DRY_RUN) {
      console.log(`  [dry-run] ${email}`);
      sent++;
      continue;
    }

    try {
      const { html, text } = buildEmail(email);
      const { error } = await resend!.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: "Thanks for signing up!",
        html,
        text,
      });

      if (error) {
        console.error(`  ❌ ${email} — ${error.message ?? JSON.stringify(error)}`);
        failed++;
      } else {
        console.log(`  ✅ ${email}`);
        sent++;
      }
    } catch (err) {
      console.error(`  ❌ ${email} — ${err}`);
      failed++;
    }

    // 限速：避免触发 Resend rate limit
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  await pool.end();

  console.log(`\n====================================`);
  console.log(`  完成：成功 ${sent} 封，失败 ${failed} 封`);
  console.log(`====================================\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
