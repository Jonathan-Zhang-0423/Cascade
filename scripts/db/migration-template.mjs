// scripts/db/migration-template.mjs
//
// 破坏性 / 数据回填类迁移的模板。drizzle-kit push 只能安全处理「加表/加列/加索引」，
// 涉及重命名列、拆表、回填、带转换的类型变更时会丢数据——这类走显式幂等脚本。
//
// 使用：复制本文件为 scripts/<feature>-migration.mjs，填入 STATEMENTS，按 docs/database-deployment.md §4 执行。
// 原则：每条语句都要幂等（IF NOT EXISTS / DO $$ ... pg_constraint ... $$），整体包在一个事务里。
//
// 运行：cd Cascade && node --env-file=.env scripts/db/migration-template.mjs
import pg from "pg";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL 未设置");
  process.exit(1);
}

// 在此列出按序执行的幂等语句。下面是示例，替换为实际变更。
const STATEMENTS = [
  // 加列（幂等）
  // `ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname text`,

  // 加唯一约束（用 pg_constraint 判存，幂等）
  // `DO $$ BEGIN
  //    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_nickname_unique') THEN
  //      ALTER TABLE users ADD CONSTRAINT users_nickname_unique UNIQUE (nickname);
  //    END IF;
  //  END $$`,

  // 数据回填（带 WHERE 限定，可重跑）
  // `UPDATE users SET nickname = username WHERE nickname IS NULL`,

  // 重命名列（先判断旧列是否存在，幂等）
  // `DO $$ BEGIN
  //    IF EXISTS (SELECT 1 FROM information_schema.columns
  //               WHERE table_name='users' AND column_name='old_name')
  //       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
  //               WHERE table_name='users' AND column_name='new_name') THEN
  //      ALTER TABLE users RENAME COLUMN old_name TO new_name;
  //    END IF;
  //  END $$`,
];

if (STATEMENTS.length === 0) {
  console.error("✗ STATEMENTS 为空——这是模板，请先填入实际迁移语句。");
  process.exit(1);
}

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
  console.log("  下一步：npm run db:push 收敛剩余结构差异，再跑 scripts/db/verify.mjs。");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`✗ 迁移失败，已回滚：${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
