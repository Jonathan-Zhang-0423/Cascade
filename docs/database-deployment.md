# Cascade 数据库格式与服务器部署规范

本文是生产部署前的数据库和运行环境检查清单。当前仓库采用 Drizzle schema 作为唯一结构来源，部署脚本位于 `scripts/db/` 和 `scripts/deploy/`。

## 1. 运行环境要求

| 项 | 要求 |
| --- | --- |
| Node.js | 20+；PM2 配置当前写的是 Node 20 路径，换机器后要改 `ecosystem*.config.cjs` 里的 `interpreter` |
| PostgreSQL | 14+，需要支持 `gen_random_uuid()`；脚本会尝试启用 `pgcrypto` |
| 包管理 | 使用根目录 `package-lock.json`，服务器执行 `npm ci --legacy-peer-deps` |
| 数据库工具 | 升级已有生产库前需要 `pg_dump`，用于 `scripts/db/backup.mjs` |
| 进程管理 | 推荐 PM2；当前生产配置为 `ecosystem.config.cjs` / `ecosystem-cn.config.cjs` |

当前 PM2 配置是用 `tsx` 直接跑 `backend/api/src/infra/index.ts`，同时依赖 `npm run build` 生成的 `dist/public` 静态资源。不要只跑源码而忘记构建前端。

## 2. 必填环境变量

生产 `.env` 至少需要：

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
SESSION_SECRET=<32+ 字符随机串>
DOUBAO_API_KEY=<豆包 API Key>
NODE_ENV=production
PORT=5000
```

建议生产同时配置：

```bash
APP_BASE_URL=https://your-domain.example
ADMIN_SECRET=<后台共享密钥>
ADMIN_JWT_SECRET=<后台 JWT 密钥>
ADMIN_TOTP_ENCRYPTION_KEY=<64 位 hex，openssl rand -hex 32>
AGENT_ROUTING_MODE=role_first
GLM_API_KEY=
KIMI_API_KEY=
MINIMAX_API_KEY=
DEEPSEEK_API_KEY=
```

可选集成变量见 `.env.example`：GitHub OAuth、Resend 邮件、腾讯 SMS/验证码、飞书/Google 表格同步、视频目录、telemetry 和 agent 并发限制。

注意：代码里的 shell 工具读取 `ENABLE_SHELL === "true"`，不是 `"1"`。

## 3. 数据库 schema 来源

权威 schema 在 `database/schema/*.ts`，由 `database/schema/index.ts` 汇总导出。迁移配置是 `database/drizzle.config.ts`，根脚本：

```bash
npm run db:push
```

该脚本执行 `drizzle-kit push --config=database/drizzle.config.ts --force`。它会把实际数据库收敛到 TS schema，生产环境执行前必须先预检和备份。

## 4. 表结构清单

当前生产库应包含以下表：

| 表 | 用途 | 关键格式/注意点 |
| --- | --- | --- |
| `users` | 用户账号与第三方登录身份 | `id` 默认 `gen_random_uuid()`；`username/email/phone/github_id/wechat_open_id/wechat_union_id/referral_code` 唯一 |
| `projects` | 项目元数据 | `id` 由应用生成；`last_plan/last_build_result/action_sequence` 存文本 JSON |
| `project_files` | 项目文件内容 | `(project_id,path)` 唯一，是文件 upsert 和防并发重复的关键约束 |
| `chat_sessions` | 项目内多会话 | `project_id + created_at` 索引用于列表恢复 |
| `chat_messages` | 聊天、plan、build/review 最终消息 | `(project_id,session_id,client_id)` 唯一；`metadata` 是文本 JSON |
| `agent_sessions` | manager/build/review/aigc 统一运行态 | `events/current_snapshot/ledger_snapshot/final_artifact/payload` 均为文本 JSON |
| `agent_session_events` | agent 事件 append-only replay | 主键 `(session_id,event_id)`，用于硬刷新和断线恢复 |
| `manager_sessions` | 旧 manager session 兼容表 | 仍保留，后续逐步由 `agent_sessions` 替代 |
| `session` | Express 登录态 | `connect-pg-simple` 兼容格式：`sid/sess/expire`，索引名必须是 `IDX_session_expire` |
| `user_skills` | 用户级技能/知识 | `(user_id,name)` 唯一 |
| `project_skills` | 项目级记忆/技能 | `(project_id,name)` 唯一；项目记忆依赖此表 |
| `waitlist_subscribers` | waitlist | `email` 唯一 |
| `invite_codes` | 邀请码 | `code` 唯一 |
| `otp_codes` | 邮箱/手机号验证码 | `(target,purpose,created_at)` 索引用于限流和查询 |
| `subscription_grants` | 订阅/试用赠送记录 | `id` 默认 `gen_random_uuid()` |
| `user_feedback` | 用户反馈 | `user_id` 外键级联删除 |
| `notifications` | 用户通知 | `(user_id,created_at)` 索引 |
| `changelog_entries` | 更新日志 | `published_at` 索引 |
| `published_apps` | 发布广场应用 | `(project_id,user_id)` 唯一，含可见性和计数 |
| `app_likes` | 发布应用点赞 | `(app_id,user_id)` 唯一 |
| `app_comments` | 发布应用评论 | `content` 应用层限制 1-500 字 |
| `project_videos` | 项目视频生成任务 | `action_sequence` 为文本 DSL/JSON 快照 |
| `admin_users` | 后台用户 | `totp_secret` 应用层 AES-GCM 加密，`backup_codes` 是 JSON 文本 |
| `admin_audit_log` | 后台审计日志 | `details` 是 `jsonb` |

JSON 文本字段的约定是“由应用编码/解码，不在数据库侧施加强 schema”。部署校验只检查表和关键索引是否存在，不验证 JSON 内容。

## 5. 关键索引和约束

上线后 `scripts/db/verify.mjs` 会检查全部关键索引，包括：

- session/agent 恢复：`agent_session_events_pkey`、`agent_sessions_project_chat_active_idx`、`agent_session_events_session_idx`
- 消息去重：`chat_messages_project_session_client_unique`
- 文件唯一性：`project_files_project_id_path_key`
- 项目记忆：`project_skills_project_name_unique`
- 登录态：`IDX_session_expire`
- 发布广场：`published_apps_project_user_uniq`、`app_likes_app_user_uniq`
- 登录身份唯一性：`users_email_unique`、`users_phone_unique`、`users_github_id_unique` 等

如果 verify 报缺索引，不要手工随便补；先确认 `database/schema/*.ts` 和生产库是否一致，再执行 `db:push`。

## 6. 首次部署流程

新库可以直接使用部署脚本：

```bash
cd Cascade
cp .env.example .env
# 填好 DATABASE_URL / SESSION_SECRET / DOUBAO_API_KEY 等
npm run deploy:server -- --fresh-db --apply-schema
```

脚本会执行：

1. 读取 `.env`
2. 检查 Node 版本和关键环境变量
3. `npm ci --legacy-peer-deps`
4. `scripts/db/preflight.mjs`
5. `npm run db:push`
6. `scripts/db/verify.mjs`
7. `npm run build`

如果需要直接交给 PM2：

```bash
npm run deploy:server -- --fresh-db --apply-schema --pm2=ecosystem.config.cjs
```

## 7. 已有生产库升级流程

已有数据的库必须先备份：

```bash
cd Cascade
git pull
npm run deploy:server -- --apply-schema --pm2=ecosystem.config.cjs
```

默认会在 `db:push` 前调用 `scripts/db/backup.mjs`，输出到 `backups/cascade-YYYYMMDD-HHMMSS.dump`。只有在你确认是空库或已由云厂商做了快照时，才使用：

```bash
npm run deploy:server -- --apply-schema --skip-backup
```

仅做预检，不改库不构建：

```bash
npm run deploy:preflight
```

预览脚本将执行什么：

```bash
npm run deploy:server -- --dry-run --apply-schema
```

## 8. 手工迁移原则

`drizzle-kit push` 适合加表、加列、加索引。以下情况不要直接依赖 push：

- 重命名列或表
- 拆表/合表
- 带数据回填的数据类型变化
- 删除生产列
- 给已有大表加非空且无默认值的列

这类变更应新建幂等脚本，参考 `scripts/db/migration-template.mjs`：

1. 先用 SQL 脚本回填或重命名；
2. 再改 `database/schema/*.ts`；
3. 执行 `npm run db:push` 收敛；
4. 执行 `scripts/db/verify.mjs`。

## 9. 反向代理和 Cookie

生产模式下 session cookie 使用：

- `sameSite: "none"`
- `secure: true`
- `trust proxy: true`

因此服务器必须走 HTTPS 反代，否则浏览器不会保存登录 cookie。Nginx 至少要转发：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

SSE/build 长连接建议关闭响应缓冲并放宽超时。

## 10. 回退

结构或数据出问题时：

```bash
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" backups/cascade-YYYYMMDD-HHMMSS.dump
```

普通代码回退：

```bash
git revert <bad_commit>
npm run deploy:server -- --apply-schema --pm2=ecosystem.config.cjs
```

如果变更包含删列或数据转换，代码回退不能恢复数据，必须依赖备份。
