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
const EXPECTED_TABLES = [
  "admin_audit_log",
  "admin_users",
  "agent_session_events",
  "agent_sessions",
  "app_comments",
  "app_likes",
  "changelog_entries",
  "chat_messages",
  "chat_sessions",
  "invite_codes",
  "manager_sessions",
  "notifications",
  "otp_codes",
  "project_files",
  "project_videos",
  "projects",
  "project_skills",
  "published_apps",
  "session",
  "subscription_grants",
  "user_feedback",
  "users",
  "user_skills",
  "waitlist_subscribers",
];

// 关键唯一约束 / 索引（名称取自各 schema 文件中的显式声明和 Drizzle 默认命名）。
const EXPECTED_INDEXES = [
  "IDX_session_expire",
  "admin_users_username_unique",
  "agent_session_events_session_idx",
  "agent_sessions_project_active_idx",
  "agent_sessions_project_chat_active_idx",
  "agent_sessions_type_status_idx",
  "agent_sessions_user_idx",
  "app_comments_app_id_idx",
  "app_comments_created_at_idx",
  "app_comments_user_id_idx",
  "app_likes_app_id_idx",
  "app_likes_app_user_uniq",
  "app_likes_user_id_idx",
  "changelog_published_at_idx",
  "chat_messages_project_session_client_unique",
  "chat_messages_project_session_kind_seq_idx",
  "chat_messages_session_idx",
  "chat_sessions_project_idx",
  "invite_codes_code_unique",
  "manager_sessions_project_active_idx",
  "notifications_user_idx",
  "otp_codes_target_purpose_created_idx",
  "project_files_project_id_path_key",
  "project_skills_project_name_unique",
  "published_apps_project_id_idx",
  "published_apps_project_user_uniq",
  "published_apps_user_id_idx",
  "published_apps_view_count_idx",
  "published_apps_visibility_published_at_idx",
  "user_feedback_created_idx",
  "user_feedback_user_idx",
  "user_skills_user_name_unique",
  "users_email_unique",
  "users_github_id_unique",
  "users_phone_unique",
  "users_referral_code_unique",
  "users_username_unique",
  "users_wechat_open_id_unique",
  "users_wechat_union_id_unique",
  "waitlist_subscribers_email_unique",
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
      const hint = t === "session" ? "（登录态表应由 db:push 建好）" : "";
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

  const { rows: pkRows } = await client.query(
    `
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'agent_session_events'::regclass
        AND contype = 'p'
        AND conkey = ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid = 'agent_session_events'::regclass AND attname = 'session_id'),
          (SELECT attnum FROM pg_attribute WHERE attrelid = 'agent_session_events'::regclass AND attname = 'event_id')
        ]::smallint[]
    `,
  );
  if (pkRows.length > 0) {
    console.log("  ✓ agent_session_events(session_id,event_id) primary key");
  } else {
    console.error("  ✗ 缺失：agent_session_events(session_id,event_id) primary key");
    missing++;
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
