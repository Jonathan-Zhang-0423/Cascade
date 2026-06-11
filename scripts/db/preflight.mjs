// scripts/db/preflight.mjs
//
// 部署前预检：连通性、Postgres 版本、pgcrypto 扩展（users.id 依赖 gen_random_uuid()）、
// 建表/索引权限。只读+幂等，可反复运行。
//
// 运行：cd Cascade && node --env-file=.env scripts/db/preflight.mjs
import pg from "pg";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL 未设置");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

try {
  await client.connect();
  ok("数据库连接成功");

  // 1) 版本
  const { rows: ver } = await client.query("SHOW server_version");
  const version = ver[0].server_version;
  const major = parseInt(version, 10);
  if (Number.isNaN(major) || major < 14) {
    fail(`Postgres 版本 ${version}，要求 14+`);
  } else {
    ok(`Postgres 版本 ${version}`);
  }

  // 2) gen_random_uuid() 可用性（pgcrypto 或 PG13+ 内置）。
  //    users.id 默认值依赖它；不可用则建表后插入会失败。
  try {
    await client.query("SELECT gen_random_uuid()");
    ok("gen_random_uuid() 可用");
  } catch {
    // 尝试启用 pgcrypto
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
      await client.query("SELECT gen_random_uuid()");
      ok("已启用 pgcrypto，gen_random_uuid() 可用");
    } catch (e) {
      fail(
        `gen_random_uuid() 不可用且无法启用 pgcrypto：${e.message}。` +
          `请让 DBA 执行 CREATE EXTENSION pgcrypto。`,
      );
    }
  }

  // 3) 建表 / 索引权限（在临时表上验证，立即清理）。
  try {
    await client.query("CREATE TABLE IF NOT EXISTS __preflight_probe (id int)");
    await client.query("CREATE INDEX IF NOT EXISTS __preflight_probe_idx ON __preflight_probe (id)");
    await client.query("DROP TABLE __preflight_probe");
    ok("具备 CREATE TABLE / INDEX 权限");
  } catch (e) {
    fail(`建表/索引权限不足：${e.message}`);
  }

  // 4) 当前库名/用户提示（便于确认没连错环境）
  const { rows: who } = await client.query(
    "SELECT current_database() AS db, current_user AS usr",
  );
  ok(`目标库：${who[0].db}（用户 ${who[0].usr}）`);

  if (process.exitCode === 1) {
    console.error("\n预检未通过，请先解决上述问题再部署。");
  } else {
    console.log("\n预检通过，可以执行 npm run db:push。");
  }
} catch (e) {
  fail(`预检异常：${e.message}`);
} finally {
  await client.end();
}
