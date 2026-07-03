// scripts/gen-dev-env.mjs
//
// 从服务器生产 .env 生成一份「本地测试用脱敏 env」(.env.dev.local)：
//   - 只保留下发必要的真实 API 值（AI / 邮件 / 短信 / GitHub OAuth）；
//   - 生产密钥（session/admin/TOTP）本地随机重生，绝不外泄生产值；
//   - DATABASE_URL / 站点 URL / PORT 改成本地值；
//   - 本地跑不通或用不到的（WeChat / 飞书 / 备案号 / shell）留空并注释。
//
// 产物 .env.dev.local 已被 .gitignore 覆盖（.env.*.local），不会误提交。
// 生成后请人工复核，再用 scripts/secure-env.mjs 加密后下发。
//
// 运行：node scripts/gen-dev-env.mjs [--force] [--out=.env.dev.local]
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const outArg = args.find((a) => a.startsWith("--out="));
const OUT = outArg ? path.resolve(outArg.slice(6)) : path.join(ROOT, ".env.dev.local");

// ── 分类配置 ─────────────────────────────────────────────────────
// 保留下发真实值的 key（API/凭据，测功能必需）
const KEEP = new Set([
  "DOUBAO_API_KEY", "GLM_API_KEY", "GLM_MODEL",
  "KIMI_API_KEY", "MINIMAX_API_KEY", "DEEPSEEK_API_KEY",
  "RESEND_API_KEY", "FROM_EMAIL", "NOTIFICATION_EMAIL",
  "TENCENT_SMS_SECRET_ID", "TENCENT_SMS_SECRET_KEY", "TENCENT_SMS_SDK_APP_ID",
  "TENCENT_SMS_SIGN_NAME", "TENCENT_SMS_TEMPLATE_ID_OTP",
  "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET",
]);

// 本地随机生成（绝不外泄生产值）
const GENERATE = {
  SESSION_SECRET: () => randomBytes(32).toString("hex"),           // 64 hex
  ADMIN_JWT_SECRET: () => randomBytes(32).toString("hex"),         // 64 hex
  ADMIN_SECRET: () => randomBytes(16).toString("hex"),             // 32 hex
  ADMIN_TOTP_ENCRYPTION_KEY: () => randomBytes(32).toString("hex"),// 64 hex (AES-256)
};

// 本地固定值
const LOCALIZE = {
  DATABASE_URL: "postgresql://cascade_user:cascade@localhost:5432/cascade_cn_db",
  APP_BASE_URL: "http://localhost:5200",
  BASE_URL: "http://localhost:5200",
  PORT: "5200",
  ADMIN_AUTH_MODE: "dual",
};

// 留空 + 注释（本地用不到或跑不通）
const BLANK = {
  WECHAT_APP_ID: "localhost 回调域未在微信开放平台登记，本地跑不通；需隧道或跳过",
  WECHAT_APP_SECRET: "同上",
  FEISHU_APP_ID: "内部集成（候补名单同步到飞书），本地功能测试无需",
  FEISHU_APP_SECRET: "同上",
  FEISHU_BITABLE_APP_TOKEN: "同上",
  FEISHU_BITABLE_TABLE_ID: "同上",
  VITE_ICP_BEIAN: "备案号，本地留空",
  VITE_GONGAN_DATACODE: "公安备号，本地留空",
  ENABLE_SHELL: "本地默认关闭沙箱 shell",
  HTTPS_PROXY: "本地一般不需要代理",
};

function parseDotenv(content) {
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function main() {
  const prodEnvPath = path.join(ROOT, ".env");
  if (!existsSync(prodEnvPath)) {
    console.error("✗ 找不到生产 .env");
    process.exit(1);
  }
  if (existsSync(OUT) && !FORCE) {
    console.error(`✗ ${path.basename(OUT)} 已存在。复核后用 --force 覆盖。`);
    process.exit(1);
  }

  const prod = parseDotenv(readFileSync(prodEnvPath, "utf8"));

  const lines = [];
  const kept = [], generated = [], localized = [], blanked = [], missingKeep = [];

  lines.push("# ── 本地测试 env（由 scripts/gen-dev-env.mjs 生成，勿提交）────────────");
  lines.push("# 含团队共享的真实 API 凭据，按密钥处理：加密后下发，勿明文走聊天/邮件。");
  lines.push("");

  // 1) 本地固定值
  lines.push("# 本地值（非密钥）");
  for (const [k, v] of Object.entries(LOCALIZE)) {
    lines.push(`${k}=${v}`);
    localized.push(k);
  }
  lines.push("");

  // 2) 本地随机生成的密钥
  lines.push("# 本地随机生成的密钥（绝不使用生产值）");
  for (const [k, gen] of Object.entries(GENERATE)) {
    lines.push(`${k}=${gen()}`);
    generated.push(k);
  }
  lines.push("");

  // 3) 下发的真实 API 凭据
  lines.push("# 团队共享 API 凭据（真实值，需加密下发）");
  for (const k of KEEP) {
    if (prod[k] != null && prod[k] !== "") {
      lines.push(`${k}=${prod[k]}`);
      kept.push(k);
    } else {
      missingKeep.push(k);
    }
  }
  lines.push("");

  // 4) 留空
  lines.push("# 本地留空（用不到 / 跑不通）");
  for (const [k, note] of Object.entries(BLANK)) {
    lines.push(`# ${note}`);
    lines.push(`${k}=`);
    blanked.push(k);
  }
  lines.push("");

  writeFileSync(OUT, lines.join("\n"));

  console.log(`✓ 已生成 ${path.relative(ROOT, OUT)}`);
  console.log("");
  console.log("  下发真实值（API）：" + (kept.length ? kept.join(", ") : "（无）"));
  if (missingKeep.length) console.log("  ⚠ 生产 .env 缺失这些必要 key：" + missingKeep.join(", "));
  console.log("  本地随机生成：" + generated.join(", "));
  console.log("  本地固定值：" + localized.join(", "));
  console.log("  留空跳过：" + blanked.join(", "));
  console.log("");
  console.log("  下一步：复核内容 → 加密 → 加密文件走任意渠道、口令走带外。");
  console.log("    node scripts/secure-env.mjs encrypt .env.dev.local");
}

main();
