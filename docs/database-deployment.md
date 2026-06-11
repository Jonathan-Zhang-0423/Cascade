# 数据库部署规范（Cascade）

本规范描述 Cascade 的 PostgreSQL 数据库如何在新环境部署、如何升级 schema、如何校验与回退。配套脚本位于 [`scripts/db/`](../scripts/db/)。

---

## 1. 技术栈与约定

| 项 | 取值 |
|---|---|
| 数据库 | PostgreSQL 14+（Neon / Supabase / 自建均可） |
| ORM | Drizzle ORM `0.39.x`，驱动 `node-postgres`（`pg` 8.x） |
| schema 来源 | [`database/schema/*.ts`](../database/schema/)，由 [`database/schema/index.ts`](../database/schema/index.ts) 汇总导出 |
| 迁移工具 | `drizzle-kit push`（见根 `package.json` 的 `db:push`） |
| 连接配置 | 环境变量 `DATABASE_URL`，连接池在 [`backend/api/src/infra/db.ts`](../backend/api/src/infra/db.ts) |

### schema 即真相（schema-as-source-of-truth）

生产 schema 的唯一权威是 `database/schema/*.ts`。**不要**手工 `ALTER TABLE` 后忘记同步代码——下次 `db:push` 会把数据库拉回代码定义的形状。所有结构变更先改 TS schema，再执行部署。

### 两张「运行时自管」的特殊表

| 表 | 谁创建 | 注意事项 |
|---|---|---|
| `session` | `connect-pg-simple` 在进程启动时按需建表（`createTableIfMissing: true`，见 [`backend/api/src/infra/index.ts`](../backend/api/src/infra/index.ts)） | 在 [`database/schema/session.ts`](../database/schema/session.ts) 中**声明但不由 Drizzle 拥有**。声明的目的仅是让 `drizzle-kit push` 不要每次提议 DROP 它——DROP 会清空所有在线登录态。**禁止修改其列类型或索引名 `IDX_session_expire`**，否则 push 会反复 churn。 |
| `otp_codes` / 历史一次性迁移 | 早期由 [`scripts/migrate-otp.mjs`](../scripts/migrate-otp.mjs) 等脚本建立 | 现已纳入 Drizzle schema。新环境直接 `db:push` 即可，无需再跑历史脚本。历史脚本保留仅供审计。 |

---

## 2. 环境变量

部署前必须就绪（参见 [`.env.example`](../.env.example)）：

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname   # 必填
SESSION_SECRET=<32+ 字节随机串>                          # 生产必填，缺省会回退到 dev-secret（不安全）
```

`DATABASE_URL` 指向托管库（Neon/Supabase）时建议带 `?sslmode=require`。

---

## 3. 部署流程

### 3.1 首次部署（新库）

```bash
cd Cascade
npm ci                          # 安装依赖（含 drizzle-kit）
node --env-file=.env scripts/db/preflight.mjs   # 连通性 + 扩展 + 权限预检
npm run db:push                 # 由 schema 创建全部表
node --env-file=.env scripts/db/verify.mjs      # 校验所有表/索引就位
```

`db:push` 是声明式的：它对比代码 schema 与实际库，生成并执行差异 DDL。新库会一次性建好 `users / projects / project_files / user_skills / project_skills / chat_messages / waitlist_subscribers / invite_codes / otp_codes / manager_sessions`。`session` 表由应用首次启动时自建。

### 3.2 升级部署（已有库 + schema 变更）

```bash
cd Cascade
git pull                        # 取得新的 database/schema/*.ts
npm ci
node --env-file=.env scripts/db/preflight.mjs
node --env-file=.env scripts/db/backup.mjs      # 升级前快照（见 §5）
npm run db:push                 # 应用增量差异
node --env-file=.env scripts/db/verify.mjs
pm2 restart cascadeai           # 重启应用（见 ecosystem.config.cjs）
```

### 3.3 关于 `drizzle-kit push` 的交互提示

`push` 在检测到可能丢数据的操作（删列、改类型、加非空列到非空表）时会要求确认。**生产环境严禁在没看清 diff 的情况下盲目确认。** 推荐先用 `--verbose` 预览：

```bash
npx drizzle-kit push --config=database/drizzle.config.ts --verbose
```

若 diff 中出现非预期的 `DROP`（尤其针对 `session`），立即中止——通常意味着 schema 声明与库不一致，需先排查。

---

## 4. 破坏性变更（手工迁移）

`push` 适合加表、加列、加索引。涉及**重命名列、拆表、回填数据、带数据转换的类型变更**时，`push` 会把它当成「删旧建新」从而丢数据。这类变更走显式幂等脚本，沿用仓库既有模式（见 [`scripts/migrate-otp.mjs`](../scripts/migrate-otp.mjs)、[`scripts/apply-github-auth-migration.mjs`](../scripts/apply-github-auth-migration.mjs)）：

原则：
- **幂等**：用 `IF NOT EXISTS` / `DO $$ ... pg_constraint ...$$` 包裹，可安全重跑。
- **顺序**：先跑手工脚本回填/改名，再 `db:push` 收敛剩余结构差异，最后 `verify`。
- **事务**：单脚本内多语句尽量包在一个事务里，失败整体回滚。

模板见 [`scripts/db/migration-template.mjs`](../scripts/db/migration-template.mjs)。

---

## 5. 备份与回退

`scripts/db/backup.mjs` 调用 `pg_dump` 生成带时间戳的快照到 `backups/`。要求部署机已安装 `pg_dump`（PostgreSQL client）。

回退策略：
- **结构回退**：`git revert` schema 改动后重新 `db:push`（仅对加列等可逆变更安全；删列后的数据无法靠 push 找回）。
- **数据回退**：从 `backups/` 用 `pg_restore` / `psql` 恢复。这是破坏性变更出错后的兜底，**升级前必须先 backup**。

---

## 6. 校验清单（verify.mjs 检查项）

部署后 `scripts/db/verify.mjs` 验证：
- 所有 schema 中声明的表存在；
- 关键唯一约束/索引存在：`users_email_unique`、`users_phone_unique`、`users_github_id_unique`、`project_files_project_id_path_key`、`chat_messages_project_client_unique`、`user_skills_user_name_unique`、`project_skills_project_name_unique`、`IDX_session_expire`；
- `session` 表存在（应用已成功启动过）。

任一缺失则以非零码退出，便于 CI / 部署脚本拦截。

---

## 7. CI / 自动化建议

在部署流水线中按序执行，任一失败即阻断：

```bash
node --env-file=.env scripts/db/preflight.mjs \
  && npm run db:push \
  && node --env-file=.env scripts/db/verify.mjs
```

`preflight` 和 `verify` 均为只读/幂等，可安全反复运行。
