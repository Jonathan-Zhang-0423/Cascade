# 本地数据库一键适配脚本

团队成员拉取代码到本地后，用 `scripts/local-db-setup.mjs` 一键把本地 PostgreSQL 适配到能直接跑项目的状态，并保证本地库结构与服务器 MVP（`cascade_cn_db`）**严格对齐**。

> **作用范围**：本脚本只在团队成员的**本机**运行，只连本机 Postgres。**对服务器、对线上运行中的 MVP 服务没有任何影响**——既不连远程，也不回写服务器。

## 它做了什么

全部步骤幂等，可反复执行：

1. **建角色 + 库**：以超级用户连接本机 Postgres，幂等创建 `cascade_user` 角色与 `cascade_cn_db` 库（已存在则跳过）。
2. **写 `.env`**：把 `DATABASE_URL` 写入项目根 `.env`（已存在且一致则跳过；绝不覆盖团队已填的其它 key）。
3. **推 schema**：依次跑 `preflight → db:push → verify`（复用 `scripts/db/` 下现有脚本），把 Drizzle schema 推齐。
4. **严格对齐校验**：用 `scripts/db/introspect.mjs` 内省本地库，与 `database/server-schema.json`（服务器结构快照）逐项比对，输出差异报告。

## 用法

```bash
# 默认：建库 → 写 .env → 推 schema → 与服务器快照比对
node scripts/local-db-setup.mjs

# 已有本地库，跳过建角色/库，只推 schema + 比对
node scripts/local-db-setup.mjs --skip-provision

# 危险：先 DROP 再重建本地目标库（会清空本地数据，需确认）
node scripts/local-db-setup.mjs --reset
```

> 没有给 `package.json` 加 npm 脚本（避免改动 MVP 既有文件），直接 `node` 运行即可。

## 可用环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PGHOST` | `localhost` | 本机 PG 主机 |
| `PGPORT` | `5432` | 本机 PG 端口 |
| `PG_SUPER_URL` | — | 显式指定超级用户连接串，如 `postgres://postgres:postgres@localhost:5432/postgres` |
| `DB_USER` | `cascade_user` | 目标角色名 |
| `DB_PASSWORD` | `cascade` | 目标角色密码 |
| `DB_NAME` | `cascade_cn_db` | 目标库名 |
| `SKIP_ALIGN` | — | 设置后跳过与服务器快照的比对 |

超级用户连接会依次尝试：`PG_SUPER_URL` → `postgres/postgres` → `postgres`（peer/trust）→ OS 用户同名角色（peer）。都连不上时会打印手动建库命令，**不会去连远程**。

## 文件清单

| 文件 | 作用 |
|---|---|
| `scripts/local-db-setup.mjs` | 主脚本：建库 → 写 `.env` → 推 schema → 对齐校验 |
| `scripts/db/introspect.mjs` | 把任一 PG 库只读内省成规范化 JSON（走 `information_schema`/`pg_catalog`，版本无关） |
| `scripts/db/schema-diff.mjs` | 纯逻辑比对模块：表/列/类型/默认值/可空/索引/约束/枚举/序列/扩展 |
| `database/server-schema.json` | 服务器 `cascade_cn_db` 的结构快照基准（纯结构，无业务数据，可安全提交） |

## 对齐基准说明

`database/server-schema.json` 是某次在服务器上执行内省得到的**静态结构快照**，作为本地对齐的参照物被读取。脚本运行时**不会回连服务器**——比对的是「本地库」与「这份提交进仓库的基准文件」。

比对维度：表的有无、每列的类型/可空/默认值、索引（含唯一/主键/部分谓词）、约束（PK/UK/FK/CHECK）、枚举、序列、扩展。任一不一致都会列出具体差异。

## 常见问题

**比对报告出现差异怎么办？**
- 多数情况下 `db:push` 已能收敛差异；可重跑一次。
- 仍不一致：检查 `database/schema/*.ts` 是否落后于服务器，或用 `--reset` 重建本地库后重跑。

**服务器结构更新后如何刷新基准？**
在服务器上手动执行（由你控制，脚本本身不会自动连服务器）：
```bash
DATABASE_URL=postgresql://cascade_user:<pwd>@localhost:5432/cascade_cn_db \
  CASCADE_SNAPSHOT_LABEL="server MVP (cascade_cn_db)" \
  node scripts/db/introspect.mjs --out=database/server-schema.json
```
然后把更新后的 `database/server-schema.json` 提交进仓库。

**连不上超级用户怎么办？**
脚本会打印手动命令，例如（macOS/Linux 常见）：
```bash
sudo -u postgres psql -c "CREATE ROLE cascade_user LOGIN PASSWORD 'cascade';"
sudo -u postgres psql -c "CREATE DATABASE cascade_cn_db OWNER cascade_user;"
```
建好后加 `--skip-provision` 重跑即可。
