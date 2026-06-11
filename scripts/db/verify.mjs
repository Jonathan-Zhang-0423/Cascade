// scripts/db/verify.mjs
//
// 部署后校验：检查所有 schema 中声明的表、关键约束/索引是否就位。
// 任一缺失则以非零码退出，供 CI / 部署脚本拦截。只读，可反复运行。
//
// 运行：cd Cascade && node --env-file=.env scripts/db/verify.mjs
import pg from "pg";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL 未设置");
  process.exit(1);
}

// 与 database/schema/*.ts 保持一致。
// session 由 connect-pg-simple 运行时自建——应用启动过才会存在。
const EXPECTED_TABLES = [
  "users",
  "projects",
  "project_files",
  "user_skills",
  "project_skills",
  "chat_messages",
  "waitlist_subscribers",
  "invite_codes",
  "otp_codes",
  "manager_sessions",
  "session",
];

// 关键唯一约束 / 索引（名称取自各 schema 文件中的显式声明）。
const EXPECTED_INDEXES = [
  "users_email_unique",
  "users_phone_unique",
  "users_github_id_unique",
  "project_files_project_id_path_key",
  "chat_messages_project_client_unique",
  "chat_messages_project_kind_seq_idx",
  "user_skills_user_name_unique",
  "project_skills_project_name_unique",
  "manager_sessions_project_active_idx",
  "otp_codes_target_purpose_created_idx",
  "IDX_session_expire",
];

const client = new pg.Client({ connectionString: DATABASE_URL });
let missing = 0;

try {
  await client.connect();

  // 表
  const { rows: tableRows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const present = new Set(tableRows.map((r) => r.tablename));

  console.log("表检查：");
  for (const t of EXPECTED_TABLES) {
    if (present.has(t)) {
      console.log(`  ✓ ${t}`);
    } else {
      const hint = t === "session" ? "（需应用至少成功启动一次）" : "";
      console.error(`  ✗ 缺失：${t} ${hint}`);
      missing++;
    }
  }

  // 索引 / 约束（pg_indexes 覆盖 unique index；unique 约束也会有对应 index）
  const { rows: idxRows } = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
  );
  const idxPresent = new Set(idxRows.map((r) => r.indexname));

  console.log("\n索引 / 约束检查：");
  for (const i of EXPECTED_INDEXES) {
    if (idxPresent.has(i)) {
      console.log(`  ✓ ${i}`);
    } else {
      console.error(`  ✗ 缺失：${i}`);
      missing++;
    }
  }

  if (missing > 0) {
    console.error(`\n校验未通过：${missing} 项缺失。请检查 db:push 是否成功执行。`);
    process.exitCode = 1;
  } else {
    console.log("\n校验通过：全部表与关键索引就位。");
  }
} catch (e) {
  console.error(`✗ 校验异常：${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
