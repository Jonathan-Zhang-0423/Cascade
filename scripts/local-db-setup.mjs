// scripts/local-db-setup.mjs
//
// 一键本地数据库适配脚本：让团队成员拉代码后，本地 DB 能直接跑起来，
// 并且结构上与服务器 MVP（cascade_cn_db）严格对齐。
//
// 做的事（全部幂等，可反复执行）：
//   1. 用超级用户连接本地 Postgres → 创建 cascade_user 角色 + cascade_cn_db 库（已存在则跳过）；
//   2. 把 DATABASE_URL 写入 .env（已存在且一致则跳过，绝不覆盖团队已填的其它 key）；
//   3. 跑 preflight → db:push → verify（复用现有脚本，推齐 schema）；
//   4. 内省本地库并与 database/server-schema.json 逐项比对，给出对齐报告。
//
// 运行：
//   npm run local:setup                       # 默认流程
//   node scripts/local-db-setup.mjs --reset   # 危险：先 DROP 再重建目标库（需确认）
//   node scripts/local-db-setup.mjs --skip-provision  # 跳过建角色/库，只推 schema + 比对
//
// 可用环境变量覆盖默认值：
//   PGHOST / PGPORT / PG_SUPER_URL / DB_USER / DB_PASSWORD / DB_NAME / SKIP_ALIGN
import pg from "pg";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execSync } from "node:child_process";
import { compareSnapshots } from "./db/schema-diff.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
const BASELINE_PATH = path.join(ROOT, "database", "server-schema.json");

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => console.log(`  ${c("32", "✓")} ${s}`);
const skip = (s) => console.log(`  ${c("90", "○")} ${s}`);
const warn = (s) => console.log(`  ${c("33", "!")} ${s}`);
const fail = (s) => console.log(`  ${c("31", "✗")} ${s}`);
const step = (s) => console.log(`\n${c("36;1", `▸ ${s}`)}`);

const args = new Set(process.argv.slice(2));
const RESET = args.has("--reset");
const SKIP_PROVISION = args.has("--skip-provision");
const SKIP_ALIGN = !!process.env.SKIP_ALIGN;

let hadFailure = false;

// ── .env 解析（与 dev.mjs 一致）────────────────────────────────────
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
function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  return parseDotenv(readFileSync(ENV_PATH, "utf8"));
}
function writeEnv(env) {
  // 保留原文件结构，只在不存在/不一致时更新 DATABASE_URL 行。
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const target = `DATABASE_URL=${env.DATABASE_URL}`;
  const re = /^DATABASE_URL=.*/m;
  if (re.test(content)) {
    content = content.replace(re, target);
  } else {
    content = content.trimEnd() + (content ? "\n" : "") + target + "\n";
  }
  writeFileSync(ENV_PATH, content);
}

// ── 默认目标库参数 ────────────────────────────────────────────────
const PGHOST = process.env.PGHOST || "localhost";
const PGPORT = process.env.PGPORT || "5432";
const DB_USER = process.env.DB_USER || "cascade_user";
const DB_PASSWORD = process.env.DB_PASSWORD || "cascade";
const DB_NAME = process.env.DB_NAME || "cascade_cn_db";

function targetUrl() {
  return `postgresql://${DB_USER}:${encodeURIComponent(DB_PASSWORD)}@${PGHOST}:${PGPORT}/${DB_NAME}`;
}

// 解析一个连接串里的 dbname，用于重连到维护库
function parseConn(url) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^@]+)@([^:\/]+):?(\d+)?\/(\S+)$/);
  if (!m) return null;
  const [, userpass, host, port, db] = m;
  const [u, p] = userpass.split(":");
  return { user: decodeURIComponent(u), password: p ? decodeURIComponent(p) : "", host, port: port || "5432", db };
}

// ── 超级用户候选连接 ──────────────────────────────────────────────
function superCandidates() {
  const list = [];
  if (process.env.PG_SUPER_URL) list.push({ url: process.env.PG_SUPER_URL, label: "PG_SUPER_URL" });
  list.push({ url: `postgres://postgres:postgres@${PGHOST}:${PGPORT}/postgres`, label: "postgres/postgres" });
  list.push({ url: `postgres://postgres@${PGHOST}:${PGPORT}/postgres`, label: "postgres (peer/trust)" });
  // OS 用户同名角色（很多本地 dev 装法）
  try {
    const osu = execSync("whoami", { encoding: "utf8" }).trim();
    if (osu) list.push({ url: `postgres://${osu}@${PGHOST}:${PGPORT}/postgres`, label: `${osu} (peer)` });
  } catch {}
  return list;
}

async function connectSuper() {
  for (const cand of superCandidates()) {
    const client = new pg.Client({ connectionString: cand.url, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      const { rows } = await client.query(
        "SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS sup",
      );
      const isSuper = rows[0].sup;
      if (isSuper) {
        ok(`超级用户连接成功：${cand.label}（user=${rows[0].u}）`);
        return client;
      }
      await client.end();
      skip(`${cand.label} 可连但非超级用户，跳过`);
    } catch {
      // 试下一个
    }
  }
  return null;
}

// ── 步骤 1：建角色 + 库 ───────────────────────────────────────────
async function provision() {
  step("创建角色与数据库");
  if (SKIP_PROVISION) { skip("--skip-provision，跳过建角色/库"); return targetUrl(); }

  const super_ = await connectSuper();
  if (!super_) {
    warn("无法以超级用户连接本地 Postgres，跳过自动建角色/库。");
    warn("请手动执行（macOS/Linux 常见）：");
    console.log(`    sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';"`);
    console.log(`    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"`);
    warn(`或设置 PG_SUPER_URL=postgres://<super>:<pass>@${PGHOST}:${PGPORT}/postgres 后重试。`);
    warn("已存在的角色/库可加 --skip-provision 跳过本步。");
    hadFailure = true;
    return targetUrl();
  }

  try {
    // 角色（幂等）
    await super_.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
           CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD.replace(/'/g, "''")}';
         END IF;
       END $$;`,
    );
    ok(`角色就绪：${DB_USER}`);

    // 库（幂等；CREATE DATABASE 不能在事务里，单独执行）
    const { rows: dbExists } = await super_.query(
      "SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME],
    );
    if (dbExists.length === 0) {
      await super_.query(`CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}`);
      ok(`数据库已创建：${DB_NAME}`);
    } else {
      skip(`数据库已存在：${DB_NAME}`);
      if (RESET) {
        console.log(`  ${c("36", "→")} --reset：重建数据库…`);
        // 必须先断开所有连接
        await super_.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()`,
        );
        await super_.query(`DROP DATABASE ${DB_NAME}`);
        await super_.query(`CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}`);
        ok(`数据库已重建：${DB_NAME}`);
      }
    }

    // 确保 pgcrypto / gen_random_uuid 可用（users.id 依赖）
    try {
      await super_.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      ok("pgcrypto 扩展已确保可用");
    } catch (e) {
      warn(`pgcrypto 启用失败（PG13+ 内置 gen_random_uuid 时可忽略）：${e.message}`);
    }
  } finally {
    await super_.end();
  }
  return targetUrl();
}

// ── 步骤 2：写 .env ───────────────────────────────────────────────
function ensureEnv(url) {
  step("配置 .env");
  const env = loadEnv();
  if (!existsSync(ENV_PATH)) {
    const example = path.join(ROOT, ".env.example");
    if (existsSync(example)) {
      writeFileSync(ENV_PATH, readFileSync(example, "utf8"));
      skip("从 .env.example 复制了一份 .env");
    } else {
      writeFileSync(ENV_PATH, `DATABASE_URL=${url}\n`);
    }
  }
  const cur = loadEnv();
  if (cur.DATABASE_URL === url) {
    skip(`.env 中 DATABASE_URL 已是目标值`);
  } else {
    cur.DATABASE_URL = url;
    writeEnv(cur);
    ok(`DATABASE_URL 已写入 .env`);
    warn("首次配置：请按 .env.example 补齐 DOUBAO_API_KEY 等业务 key 再启动。");
  }
}

// ── 步骤 3：preflight → db:push → verify ──────────────────────────
function runShell(cmd, label) {
  console.log(`  ${c("36", "→")} ${label}`);
  const r = spawnSync(cmd, { cwd: ROOT, stdio: "inherit", shell: true, env: { ...process.env } });
  if (r.status !== 0) { fail(`${label} 退出码 ${r.status}`); hadFailure = true; return false; }
  return true;
}

function pushSchema() {
  step("推送 schema（preflight → db:push → verify）");
  if (!runShell(`node --env-file=.env scripts/db/preflight.mjs`, "preflight")) return;
  if (!runShell(`npm run db:push`, "db:push（drizzle-kit push --force）")) return;
  runShell(`node --env-file=.env scripts/db/verify.mjs`, "verify");
}

// ── 步骤 4：与服务器快照严格比对 ──────────────────────────────────
async function alignCheck(url) {
  if (SKIP_ALIGN) { skip("SKIP_ALIGN 已设置，跳过对齐校验"); return; }
  step("与服务器结构快照严格比对");
  if (!existsSync(BASELINE_PATH)) {
    fail(`基准快照缺失：${BASELINE_PATH}`);
    warn("请从服务器执行 introspect 重新生成（见 scripts/db/introspect.mjs）。");
    hadFailure = true;
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

  // 复用 introspect.mjs 的内省：子进程跑一次写临时 JSON
  const tmp = path.join(ROOT, ".cache", "local-schema.json");
  const r = spawnSync(
    `node --env-file=.env scripts/db/introspect.mjs --out=${tmp}`,
    { cwd: ROOT, stdio: "inherit", shell: true, env: { ...process.env, DATABASE_URL: url } },
  );
  if (r.status !== 0 || !existsSync(tmp)) {
    fail("本地内省失败");
    hadFailure = true;
    return;
  }
  const local = JSON.parse(readFileSync(tmp, "utf8"));
  const { diffs, aligned } = compareSnapshots(local, baseline);

  if (aligned) {
    ok(`✓ 本地 DB 与服务器严格对齐（${Object.keys(local.tables).length} 表，0 差异）`);
    return;
  }
  fail(`检测到 ${diffs.length} 处结构差异：`);
  for (const d of diffs.slice(0, 80)) {
    const where = d.table || d.enum || d.index || d.constraint || d.sequence || d.extension || "";
    console.log(`    ${c("31", "•")} [${d.kind}] ${where} ${d.column || ""} — ${d.detail || ""}`);
  }
  if (diffs.length > 80) console.log(`    …还有 ${diffs.length - 80} 处未显示`);
  warn("提示：db:push 通常能收敛差异；若仍不一致，检查 database/schema/*.ts 是否落后于服务器，");
  warn("     或用 --reset 重建本地库后重跑。若服务器结构有更新，请在服务器上重生成 server-schema.json。");
  hadFailure = true;
}

// ── 主流程 ────────────────────────────────────────────────────────
async function main() {
  console.log(c("1", "Cascade 本地数据库适配"));
  const url = await provision();
  ensureEnv(url);
  pushSchema();
  await alignCheck(url);

  if (hadFailure) {
    console.log(`\n${c("33;1", "完成但有警告/失败项")} — 见上方标注。`);
    process.exit(1);
  }
  console.log(`\n${c("32;1", "本地数据库就绪且与服务器严格对齐。")}`);
  console.log(c("36", "▸ 现在可以：npm run dev"));
}

main().catch((e) => { fail(String(e?.stack ?? e)); process.exit(1); });
