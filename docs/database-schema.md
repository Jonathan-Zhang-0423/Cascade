# 数据库结构说明（服务器 MVP 现状）

本文档描述当前**服务器 MVP** 数据库 `cascade_cn_db` 的完整结构，作为团队成员本地复刻的权威参照。结构与 `database/schema/*.ts`（Drizzle 定义）以及提交进仓库的快照 [`database/server-schema.json`](../database/server-schema.json) 严格一致。

- **数据库**：PostgreSQL（服务器版本 14+ 即可，`gen_random_uuid()` 在 PG13+ 内置，无需 pgcrypto）
- **角色 / 库名**：`cascade_user` / `cascade_cn_db`（本地可用任意名，见下方复刻步骤）
- **表总数**：22 张
- **schema 即真相**：结构变更必须先改 `database/schema/*.ts`，再 `db:push`。**不要**手工 `ALTER TABLE` 后忘记同步代码——下次 `push` 会把库拉回代码定义的形状。

---

## 0. 一键复刻（本地）

```bash
node scripts/local-db-setup.mjs
```

该脚本会：建 `cascade_user` 角色 + `cascade_cn_db` 库 → 写 `.env` → `preflight / db:push / verify` 推齐 schema → 与 [`database/server-schema.json`](../database/server-schema.json) 逐项严格比对，确认本地与服务器结构一致后即可 `npm run dev`。详见 [`docs/local-db-setup.md`](./local-db-setup.md)。

如果只想手工复刻，等价步骤：

```bash
sudo -u postgres psql -c "CREATE ROLE cascade_user LOGIN PASSWORD 'cascade';"
sudo -u postgres psql -c "CREATE DATABASE cascade_cn_db OWNER cascade_user;"
# 在项目根 .env 设置：
#   DATABASE_URL=postgresql://cascade_user:cascade@localhost:5432/cascade_cn_db
npm run db:push
node --env-file=.env scripts/db/verify.mjs
```

> `session` 表由应用首次启动时 `connect-pg-simple` 自建，`db:push` 后不会立即出现；启动过一次应用即就位。

---

## 1. 表总览（按业务域分组）

| 域 | 表 | 主键类型 | 说明 |
|---|---|---|---|
| **用户体系** | `users` | varchar (uuid) | 终端用户，支持账密 / 邮箱 / 手机 / GitHub / 微信多种登录 |
| | `admin_users` | varchar (uuid) | 后台管理员，密码哈希 + 可选 TOTP |
| | `admin_audit_log` | serial (int) | 后台操作审计流水 |
| **项目与文件** | `projects` | varchar | 用户创建的项目 |
| | `project_files` | int (identity) | 项目内文件内容（path 唯一） |
| | `user_skills` / `project_skills` | int (identity) | 用户级 / 项目级技能 |
| **会话与消息** | `manager_sessions` | varchar | Plan 模式会话持久化（断线重连重放） |
| | `chat_sessions` | varchar | 项目下的命名对话 |
| | `chat_messages` | int (identity) | 对话消息明细 |
| | `session` | varchar | Express 会话存储（`connect-pg-simple` 自管） |
| **邀请与订阅** | `waitlist_subscribers` | serial | 候补名单订阅 |
| | `invite_codes` | serial | 邀请码 |
| | `otp_codes` | serial | 手机/邮箱一次性验证码 |
| | `subscription_grants` | varchar (uuid) | 给用户的试用/订阅天数授予记录 |
| **发布与互动** | `published_apps` | varchar | 发布到广场的应用 |
| | `project_videos` | varchar | 项目预览视频录制 |
| | `app_likes` | varchar | 应用点赞 |
| | `app_comments` | varchar | 应用评论 |
| **运营内容** | `user_feedback` | int (identity) | 用户反馈与回复 |
| | `notifications` | int (identity) | 站内通知 |
| | `changelog_entries` | int (identity) | 更新日志 |

---

## 2. 用户体系

### 2.1 `users`

终端用户主表。一个账号可绑定多种登录方式（账密 / 邮箱 / 手机 / GitHub / 微信）。

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | varchar | 否 | `gen_random_uuid()` | 主键，UUID |
| `username` | text | 否 | — | 唯一用户名 |
| `password` | text | 是 | — | 账密登录的哈希；OAuth 用户可为空 |
| `email` | text | 是 | — | 唯一邮箱 |
| `email_verified` | boolean | 否 | `false` | |
| `phone` | text | 是 | — | 唯一手机号 |
| `phone_verified` | boolean | 否 | `false` | |
| `github_id` | text | 是 | — | 唯一；GitHub OAuth |
| `github_login` | text | 是 | — | |
| `wechat_open_id` | text | 是 | — | 唯一；微信 |
| `wechat_union_id` | text | 是 | — | 唯一 |
| `wechat_nickname` | text | 是 | — | |
| `avatar_url` | text | 是 | — | |
| `experience_level` | text | 否 | `'intermediate'` | |
| `has_set_experience_level` | boolean | 否 | `false` | |
| `invite_code` | text | 是 | — | 注册时使用的邀请码（字符串，非外键） |
| `trial_expires_at` | timestamptz | 是 | — | 试用到期 |
| `referral_code` | text | 是 | — | 唯一；本用户的可分享推荐码 |
| `referred_by` | varchar | 是 | — | 推荐人 user.id（非外键） |
| `first_name` / `last_name` / `bio` | text | 是 | — | 资料 |
| `username_last_changed_at` | timestamptz | 是 | — | 改名冷却用 |

唯一索引：`username`、`email`、`phone`、`github_id`、`wechat_open_id`、`wechat_union_id`、`referral_code`。

### 2.2 `admin_users`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | varchar | 否 | `gen_random_uuid()` | |
| `username` | varchar(64) | 否 | — | 唯一 |
| `password_hash` | text | 否 | — | |
| `totp_secret` | text | 是 | — | AES-256-GCM 加密 |
| `totp_enabled` | boolean | 否 | `false` | |
| `role` | varchar(32) | 否 | `'admin'` | |
| `last_login_at` | timestamptz | 是 | — | |
| `last_login_ip` | varchar(45) | 是 | — | |
| `is_active` | boolean | 否 | `true` | |
| `backup_codes` | text | 是 | — | JSON 数组（bcrypt 哈希） |
| `failed_attempts` | integer | 否 | `0` | |
| `locked_until` | timestamptz | 是 | — | |
| `created_at` / `updated_at` | timestamptz | 否 | `now()` | |

唯一索引：`username`。管理员账号由 [`scripts/create-admin.ts`](../scripts/create-admin.ts) 创建。

### 2.3 `admin_audit_log`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | serial | 否 | identity | |
| `admin_user_id` | varchar | 否 | — | 非外键 |
| `action` | varchar(128) | 否 | — | |
| `resource` | varchar(128) | 是 | — | |
| `resource_id` | varchar(256) | 是 | — | |
| `details` | jsonb | 是 | — | |
| `ip_address` | varchar(45) | 否 | — | |
| `user_agent` | text | 是 | — | |
| `created_at` | timestamptz | 否 | `now()` | |

---

## 3. 项目与文件

### 3.1 `projects`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | varchar | 否 | — | 主键（应用层生成） |
| `user_id` | varchar | 是 | — | 所有者（非外键） |
| `name` | text | 否 | — | |
| `emoji` | text | 是 | — | |
| `framework` | text | 否 | `'web'` | `web/rn-expo/flutter/swiftui/kotlin/wechat` |
| `language` | text | 否 | `'html'` | `html/typescript/dart/swift/kotlin/wxml` |
| `target_platform` | text | 是 | — | `ios/android/both` |
| `last_plan` | text | 是 | — | 最近 ManagerPlan JSON |
| `last_build_result` | text | 是 | — | |
| `action_sequence` | text | 是 | — | 录制 DSL JSON |
| `action_sequence_duration` | integer | 是 | — | 秒 |
| `created_at` | timestamp | 否 | `now()` | 无时区 |

### 3.2 `project_files`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | integer | 否 | identity | |
| `project_id` | varchar | 否 | — | **外键 → projects.id（ON DELETE CASCADE）** |
| `path` | text | 否 | — | |
| `content` | text | 否 | `''` | |

唯一约束 `project_files_project_id_path_key`：(project_id, path)，支撑 `ON CONFLICT` 原子 upsert。

### 3.3 `user_skills` / `project_skills`

结构基本相同，`project_skills` 多一个 `project_id` 外键。

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | integer | 否 | identity | |
| `user_id` / `project_id` | varchar | 否 | — | project_id 为外键 → projects.id（CASCADE） |
| `name` | text | 否 | — | |
| `description` | text | 否 | `''` | |
| `type` | text | 否 | `'knowledge'` | |
| `content` | text | 否 | `''` | |
| `enabled` | boolean | 否 | `true` | |
| `created_at` | timestamp | 否 | `now()` | |

唯一索引：`user_skills_user_name_unique` (user_id, name)、`project_skills_project_name_unique` (project_id, name)。

---

## 4. 会话与消息

### 4.1 `manager_sessions`

Plan 模式会话持久化，断线重连时重放 `events`。

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | varchar | 否 | — | 主键 |
| `project_id` | varchar | 是 | — | 外键 → projects.id（CASCADE） |
| `done` | boolean | 否 | `false` | |
| `started_at` | bigint | 否 | — | 毫秒时间戳 |
| `done_at` | bigint | 是 | — | |
| `next_event_id` | integer | 否 | `0` | |
| `events` | text | 否 | `'[]'` | JSON 数组，事件缓冲 |

索引：`manager_sessions_project_active_idx` (project_id, done)。

### 4.2 `chat_sessions`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | varchar | 否 | — | nanoid |
| `project_id` | varchar | 否 | — | 外键 → projects.id（CASCADE） |
| `name` | text | 否 | `'新对话'` | |
| `created_at` | timestamptz | 否 | `now()` | |
| `last_message_at` | timestamptz | 是 | — | |
| `message_count` | integer | 否 | `0` | |

索引：`chat_sessions_project_idx` (project_id, created_at)。

### 4.3 `chat_messages`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | integer | 否 | identity | |
| `project_id` | varchar | 否 | — | 外键 → projects.id（CASCADE） |
| `session_id` | varchar | 否 | `'main'` | 非外键；主会话固定 `main` |
| `client_id` | varchar | 否 | — | |
| `kind` | text | 否 | — | |
| `role` | text | 否 | — | |
| `content` | text | 否 | `''` | |
| `thinking` | text | 是 | — | |
| `source` | text | 是 | — | |
| `seq` | integer | 否 | — | 单调序号 |
| `timestamp` | bigint | 否 | — | 毫秒 |
| `metadata` | text | 是 | — | |

索引：`chat_messages_project_session_client_unique`（唯一，project_id+session_id+client_id）、`chat_messages_project_session_kind_seq_idx`、`chat_messages_session_idx`。

### 4.4 `session`（⚠️ 运行时自管）

Express 会话存储表，由 `connect-pg-simple` 在应用启动时按需自建（`createTableIfMissing: true`），**不由 Drizzle 拥有**。在 schema 中声明仅为阻止 `db:push` 每次提议 DROP 它（DROP 会清空所有在线登录态）。

| 列 | 类型 | 可空 | 默认 |
|---|---|---|---|
| `sid` | varchar | 否 | — 主键 |
| `sess` | json | 否 | — |
| `expire` | timestamp（**无时区**） | 否 | — |

索引：`IDX_session_expire`。**禁止改列类型或索引名**，否则 `push` 反复 churn。

---

## 5. 邀请与订阅

### 5.1 `waitlist_subscribers`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | serial | 否 | identity | |
| `email` | text | 否 | — | 唯一 |
| `created_at` | timestamptz | 否 | `now()` | |
| `ip_address` | text | 是 | — | |
| `is_edu` | boolean | 否 | `false` | |
| `status` | text | 否 | `'pending'` | |
| `batch_id` | integer | 是 | — | |
| `confirmation_email_sent_at` | timestamptz | 是 | — | |

### 5.2 `invite_codes`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | serial | 否 | identity | |
| `code` | text | 否 | — | 唯一 |
| `is_edu` | boolean | 否 | `false` | |
| `trial_days` | integer | 否 | — | |
| `expires_at` | timestamptz | 否 | — | |
| `redeemed_by_user_id` | varchar | 是 | — | 外键 → users.id |
| `redeemed_at` | timestamptz | 是 | — | |
| `waitlist_subscriber_id` | integer | 是 | — | 外键 → waitlist_subscribers.id |
| `created_at` | timestamptz | 否 | `now()` | |

### 5.3 `otp_codes`

手机/邮箱一次性验证码。

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | serial | 否 | identity | |
| `channel` | text | 否 | — | `sms` / `email` |
| `target` | text | 否 | — | 手机号或邮箱 |
| `code_hash` | text | 否 | — | |
| `purpose` | text | 否 | — | |
| `expires_at` | timestamptz | 否 | — | |
| `attempts` | integer | 否 | `0` | |
| `consumed_at` | timestamptz | 是 | — | |
| `created_at` | timestamptz | 否 | `now()` | |

索引：`otp_codes_target_purpose_created_idx`。

### 5.4 `subscription_grants`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | varchar | 否 | `gen_random_uuid()` | |
| `user_id` | varchar | 否 | — | 非外键 |
| `granted_days` | integer | 否 | — | |
| `reason` | text | 是 | — | |
| `related_user_id` | varchar | 是 | — | 推荐关系等 |
| `created_at` | timestamp | 否 | `now()` | 无时区 |

---

## 6. 发布与互动

### 6.1 `published_apps`

发布到创造者广场的应用。

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | varchar | 否 | — | 主键 |
| `project_id` | varchar | 否 | — | 非外键 |
| `user_id` | varchar | 否 | — | 非外键 |
| `title` | text | 否 | — | |
| `description` | text | 是 | — | |
| `is_open_source` | boolean | 否 | `false` | |
| `visibility` | text | 否 | `'public'` | `public/link_only/private` |
| `preview_screenshot` | text | 是 | — | |
| `preview_video` | text | 是 | — | |
| `framework` | text | 否 | `'web'` | |
| `view_count` | integer | 否 | `0` | |
| `fork_count` | integer | 否 | `0` | |
| `like_count` | integer | 否 | `0` | |
| `admin_taken_down` | boolean | 否 | `false` | |
| `category` | text | 否 | `'tools'` | |
| `published_at` | timestamp | 否 | `now()` | 无时区 |
| `updated_at` | timestamp | 否 | `now()` | 无时区 |

索引：`published_apps_visibility_published_at_idx`、`published_apps_user_id_idx`、`published_apps_project_id_idx`、`published_apps_view_count_idx`；唯一约束 `published_apps_project_user_uniq` (project_id, user_id)。

### 6.2 `project_videos`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | varchar | 否 | — | 主键 |
| `project_id` | varchar | 否 | — | 非外键 |
| `user_id` | varchar | 是 | — | |
| `status` | text | 否 | `'pending'` | `pending/running/done/error` |
| `local_path` | text | 是 | — | 录制阶段磁盘路径 |
| `cos_url` | text | 是 | — | 上传后 COS URL |
| `duration` | integer | 是 | — | 秒 |
| `style` | text | 否 | `'raw'` | `raw` 或派生样式 |
| `parent_video_id` | varchar | 是 | — | 派生自哪个 raw 视频 |
| `action_sequence` | text | 是 | — | 录制用 DSL 快照 |
| `error_message` | text | 是 | — | |
| `created_at` | timestamp | 否 | `now()` | 无时区 |
| `finished_at` | timestamp | 是 | — | 无时区 |

### 6.3 `app_likes`

| 列 | 类型 | 可空 | 默认 |
|---|---|---|---|
| `id` | varchar | 否 | — 主键 |
| `app_id` | varchar | 否 | — |
| `user_id` | varchar | 否 | — |
| `created_at` | timestamptz | 否 | `now()` |

索引：`app_likes_app_id_idx`、`app_likes_user_id_idx`；唯一约束 `app_likes_app_user_uniq` (app_id, user_id)。

### 6.4 `app_comments`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | varchar | 否 | — | 主键 |
| `app_id` | varchar | 否 | — | |
| `user_id` | varchar | 否 | — | |
| `content` | text | 否 | — | 1–500 字 |
| `created_at` | timestamptz | 否 | `now()` | |
| `updated_at` | timestamptz | 否 | `now()` | |

索引：`app_comments_app_id_idx`、`app_comments_user_id_idx`、`app_comments_created_at_idx`。

---

## 7. 运营内容

### 7.1 `user_feedback`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | integer | 否 | identity | |
| `user_id` | varchar | 否 | — | 外键 → users.id（CASCADE） |
| `content` | text | 否 | — | |
| `source` | varchar(20) | 否 | `'pc'` | |
| `created_at` | timestamptz | 否 | `now()` | |
| `replied_at` | timestamptz | 是 | — | |
| `reply_content` | text | 是 | — | |

索引：`user_feedback_user_idx`、`user_feedback_created_idx`。

### 7.2 `notifications`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | integer | 否 | identity | |
| `user_id` | varchar | 否 | — | 外键 → users.id（CASCADE） |
| `type` | varchar(50) | 否 | `'admin_reply'` | `admin_reply/system` |
| `title` | text | 否 | — | |
| `body` | text | 否 | — | |
| `is_read` | boolean | 否 | `false` | |
| `created_at` | timestamptz | 否 | `now()` | |

索引：`notifications_user_idx` (user_id, created_at)。

### 7.3 `changelog_entries`

| 列 | 类型 | 可空 | 默认 | 说明 |
|---|---|---|---|---|
| `id` | integer | 否 | identity | |
| `version` | text | 是 | — | |
| `title` | text | 否 | — | |
| `content` | text | 否 | — | |
| `published_at` | timestamptz | 否 | `now()` | |
| `is_published` | boolean | 否 | `true` | |

索引：`changelog_published_at_idx`。

---

## 8. 序列

以下表使用 `serial` / `identity` 自增主键，PG 会自动创建对应序列：

- `admin_audit_log_id_seq`
- `invite_codes_id_seq`
- `otp_codes_id_seq`
- `waitlist_subscribers_id_seq`

`db:push` 会随表一起建好，无需手工干预。

---

## 9. 外键关系总览

| 子表 | 列 | 父表 | 删除行为 |
|---|---|---|---|
| `project_files` | `project_id` → `projects.id` | CASCADE |
| `project_skills` | `project_id` → `projects.id` | CASCADE |
| `chat_messages` | `project_id` → `projects.id` | CASCADE |
| `chat_sessions` | `project_id` → `projects.id` | CASCADE |
| `manager_sessions` | `project_id` → `projects.id` | CASCADE |
| `invite_codes` | `redeemed_by_user_id` → `users.id` | NO ACTION |
| `invite_codes` | `waitlist_subscriber_id` → `waitlist_subscribers.id` | NO ACTION |
| `user_feedback` | `user_id` → `users.id` | CASCADE |
| `notifications` | `user_id` → `users.id` | CASCADE |

> 其余 `user_id` / `project_id` / `app_id` 等字段为**逻辑外键**（schema 中未声明 `.references()`），不做数据库级约束——这是项目当前有意的设计，便于跨表写入与清理。复刻时无需为它们建外键。

---

## 10. 复刻后的验证

```bash
# 1. 表/索引是否就位
node --env-file=.env scripts/db/verify.mjs

# 2. 与服务器结构逐项严格比对（脚本内部调用）
node scripts/local-db-setup.mjs --skip-provision
```

通过后即可：

```bash
npm run dev
```

应用首次启动会自动创建 `session` 表。其余 21 张表由 `db:push` 一次性建好。

---

## 11. 结构变更流程（保持本地与服务器一致）

1. 改 `database/schema/*.ts`；
2. 本地 `npm run db:push` 验证；
3. 在**服务器**上重新生成基准快照并提交：
   ```bash
   DATABASE_URL=postgresql://cascade_user:<pwd>@localhost:5432/cascade_cn_db \
     CASCADE_SNAPSHOT_LABEL="server MVP (cascade_cn_db)" \
     node scripts/db/introspect.mjs --out=database/server-schema.json
   ```
4. 同步更新本文档（新增/变更的表与列）；
5. 提交 PR，队友 `git pull` 后重跑 `local-db-setup.mjs` 即可对齐。

> 服务器基准快照的刷新由你在服务器侧手动控制；本地脚本运行时**不会**回连服务器。
