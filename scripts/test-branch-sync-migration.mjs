// scripts/test-branch-sync-migration.mjs
//
// 手工迁移：为合并 origin/main 到 test 分支引入的新表/新列建结构。全部是纯新增
// （加表 / 加列），没有重命名或数据转换，所以每条语句都幂等（IF NOT EXISTS），
// 可安全重跑。跑完后再用 `npm run db:push` 收敛剩余的索引/约束差异。
//
// 运行：cd Cascade && node --env-file=.env.test scripts/test-branch-sync-migration.mjs
import pg from "pg";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL 未设置");
  process.exit(1);
}
if (!/test/i.test(DATABASE_URL)) {
  console.error(`✗ 拒绝执行：DATABASE_URL 不像测试库 (${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")})`);
  process.exit(1);
}

const STATEMENTS = [
  // users: 账号绑定 + 资料字段（main 新增）
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS github_login text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_nickname text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS username_last_changed_at timestamptz`,

  // published_apps: 分类字段（main 新增）
  `ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'tools'`,

  // admin_users: 管理员 JWT+TOTP 登录（main 新增表）
  `CREATE TABLE IF NOT EXISTS admin_users (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     username varchar(64) NOT NULL UNIQUE,
     password_hash text NOT NULL,
     totp_secret text,
     totp_enabled boolean NOT NULL DEFAULT false,
     role varchar(32) NOT NULL DEFAULT 'admin',
     last_login_at timestamptz,
     last_login_ip varchar(45),
     is_active boolean NOT NULL DEFAULT true,
     backup_codes text,
     failed_attempts integer NOT NULL DEFAULT 0,
     locked_until timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,

  // admin_audit_log: 管理员操作审计（main 新增表）
  `CREATE TABLE IF NOT EXISTS admin_audit_log (
     id serial PRIMARY KEY,
     admin_user_id varchar NOT NULL,
     action varchar(128) NOT NULL,
     resource varchar(128),
     resource_id varchar(256),
     details jsonb,
     ip_address varchar(45) NOT NULL,
     user_agent text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
];

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
  await client.query("BEGIN");
  for (const [i, stmt] of STATEMENTS.entries()) {
    console.log(`→ [${i + 1}/${STATEMENTS.length}] 执行中...`);
    await client.query(stmt);
  }
  await client.query("COMMIT");
  console.log(`✓ 迁移完成，已提交 ${STATEMENTS.length} 条语句。`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("✗ 迁移失败，已回滚：", err.message);
  process.exit(1);
} finally {
  await client.end();
}
