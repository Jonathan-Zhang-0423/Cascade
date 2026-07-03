# 本地 env 安全下发与配置流程

本文档说明如何把**本地测试所需的 env**从服务器安全地发给队友，让他在本地完整测试所有功能，同时**绝不外泄生产密钥、不影响线上服务**。

> 核心原则：**不直接发生产 `.env`**。生产里的 `SESSION_SECRET` / `ADMIN_*` / 生产 DB 密码绝不离开服务器——这些在队友本地随机重生即可。

## 0. 下发什么 / 不下发什么

| 下发真实值（测功能必需的 API） | 本地随机生成（绝不发生产值） | 本地固定值 | 留空跳过 |
|---|---|---|---|
| AI：`DOUBAO_API_KEY` `GLM_API_KEY` `GLM_MODEL` `KIMI_API_KEY` `MINIMAX_API_KEY` `DEEPSEEK_API_KEY` | `SESSION_SECRET` | `DATABASE_URL`（本地库） | `WECHAT_*`（localhost 跑不通） |
| 邮件：`RESEND_API_KEY` `FROM_EMAIL` `NOTIFICATION_EMAIL` | `ADMIN_JWT_SECRET` | `APP_BASE_URL` / `BASE_URL` = `http://localhost:5200` | `FEISHU_*`（内部集成，非用户功能） |
| 短信：`TENCENT_SMS_*`（测手机号登录） | `ADMIN_SECRET` | `PORT=5200` | `VITE_ICP_BEIAN` / `VITE_GONGAN_DATACODE` |
| GitHub OAuth：`GITHUB_CLIENT_ID` `GITHUB_CLIENT_SECRET`（测 GitHub 登录） | `ADMIN_TOTP_ENCRYPTION_KEY`（64 hex） | `ADMIN_AUTH_MODE=dual` | `ENABLE_SHELL` / `HTTPS_PROXY` |

脚本 [`scripts/gen-dev-env.mjs`](../scripts/gen-dev-env.mjs) 按上表自动生成脱敏文件，无需手工挑。

## 1. 服务器侧：生成脱敏 env

```bash
cd CascadeAI-MVP
node scripts/gen-dev-env.mjs           # 生成 .env.dev.local
```

产物 `.env.dev.local` 已被 `.gitignore` 覆盖（`.env.*.local`），不会误提交。

**生成后务必人工复核**——确认里面只有"该下发的 API 真实值 + 本地重生的密钥 + 本地值"，**没有**生产 `SESSION_SECRET` / `ADMIN_*` / 生产 DB 密码 `Test123456Prod`：

```bash
# 快速自检：这几项应只出现本地随机值，生产 DB 密码应为 0 次
grep -c "Test123456Prod" .env.dev.local    # 期望 0
grep -E "^(SESSION_SECRET|ADMIN_JWT_SECRET|ADMIN_SECRET|ADMIN_TOTP_ENCRYPTION_KEY)=" .env.dev.local
```

## 2. 加密

```bash
# 方式 A：交互式输入口令（隐藏输入，会要求确认）
node scripts/secure-env.mjs encrypt .env.dev.local

# 方式 B：用环境变量传口令（适合脚本化）
ENV_PASSPHRASE="<强口令>" node scripts/secure-env.mjs encrypt .env.dev.local
```

生成 `.env.dev.local.enc`（AES-256-CBC + PBKDF2，纯文本 base64，可贴任意渠道）。

> 口令要求 ≥ 8 位，建议 20+ 位随机串。脚本用 Node 内置 `crypto`，无外部依赖。

## 3. 传输（密文与口令必须分渠道）

- ✅ **密文** `.env.dev.local.enc`：可走 Slack / 邮件 / 网盘 / 微信等任意渠道
- ✅ **口令**：必须走**带外**渠道——电话、Signal、当面，**绝不与密文同渠道**
- ❌ 禁止：明文 `.env` 直接发；密文+口令同一条消息；提交进 Git

收到方若口令错，脚本会明确报"解密失败"，不会泄任何信息。

## 4. 队友侧：解密并配置

```bash
cd CascadeAI-MVP
# 解密落到项目根 .env（队友本机的 .env，与服务器无关）
node scripts/secure-env.mjs decrypt .env.dev.local.enc -o .env
```

随后建本地库并推 schema（详见 [`docs/local-db-setup.md`](./local-db-setup.md)）：

```bash
node scripts/local-db-setup.mjs      # 建角色/库 → 校验 DATABASE_URL → db:push → 与服务器结构比对
```

完成后即可：

```bash
npm run dev
```

## 5. 各功能本地测试的前置条件

| 功能 | 能否本地测 | 前置 |
|---|---|---|
| AI 对话 / 构建 | ✅ | 已下发 AI key |
| 邮件验证 / 通知 | ✅ | 已下发 Resend key |
| 手机号 OTP 登录 | ✅ | 已下发腾讯短信 key；短信为服务端发送，localhost 可用 |
| GitHub 登录 | ⚠️ 需一次性配置 | 见下方 §6 |
| 微信登录 | ❌ 本地直接跑不通 | 见下方 §7 |
| 后台管理 / TOTP | ✅ | 本地已重生 `ADMIN_*` 密钥；需建管理员账号（见 §8） |
| 候补名单 / 邀请码 / 发布广场 / 点赞评论 | ✅ | 仅依赖本地 DB |

## 6. GitHub 登录本地测试（一次性配置）

GitHub OAuth 回调地址由 `APP_BASE_URL` 拼出：`${APP_BASE_URL}/api/auth/github/callback`。本地 `APP_BASE_URL=http://localhost:5200`，故回调为：

```
http://localhost:5200/api/auth/github/callback
```

需由 GitHub OAuth App 的**拥有者**在该 App 设置页 → Authorization callback URL 中**新增**上述地址（保留生产地址，新增 localhost 即可，两者可并存）。配置后队友用下发的 `GITHUB_CLIENT_ID/SECRET` 即可在本地完成 GitHub 登录测试。

> 若不便改生产 OAuth App，队友可在 GitHub 自建一个 OAuth App（回调填 localhost），用自己的 client id/secret 覆盖 `.env` 里的 `GITHUB_*`。

## 7. 微信登录：本地为何跳过

微信开放平台要求扫码登录的 redirect 域名在 MP 控制台**预登记**，且不支持 `localhost`。因此本地 `.env` 中 `WECHAT_APP_ID/SECRET` 留空，微信登录在本地不测。

如确需本地测：用 ngrok 把 localhost 暴露成一个已登记域名，再把该隧道地址配进微信回调域——属进阶操作，非必要。

## 8. 后台管理员账号（本地）

本地 `ADMIN_AUTH_MODE=dual`、`ADMIN_TOTP_ENCRYPTION_KEY` 已随机重生。创建一个本地管理员：

```bash
node scripts/create-admin.ts   # 按提示设用户名/密码
```

随后即可在本地后台登录并测试 TOTP。该账号与生产后台完全隔离。

## 9. 轮换与回收

- 团队共享的 API key 一旦疑似泄露，立即在各 provider 控制台轮换，重新 `gen-dev-env.mjs` 生成并重发。
- 队友离职/设备失窃：轮换所有下发的 key（AI/邮件/SMS/GitHub OAuth）。
- 本地重生的 `SESSION_SECRET` / `ADMIN_*` 与生产无关，无需同步。

## 10. 速查（服务器侧一条龙）

```bash
node scripts/gen-dev-env.mjs --force              # 1. 生成脱敏 env
grep -c "Test123456Prod" .env.dev.local          # 2. 自检（期望 0）
node scripts/secure-env.mjs encrypt .env.dev.local  # 3. 加密（口令走带外）
# 4. 发 .env.dev.local.enc 给队友；口令电话告知
```

队友侧：

```bash
node scripts/secure-env.mjs decrypt .env.dev.local.enc -o .env   # 解密
node scripts/local-db-setup.mjs                                  # 建库 + 推 schema + 对齐
npm run dev                                                      # 启动
```
