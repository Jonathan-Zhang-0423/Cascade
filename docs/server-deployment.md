# Cascade 服务器部署手册

这份手册面向实际上线操作。数据库格式细节见 `docs/database-deployment.md`。

## 1. 准备服务器

建议环境：

- Ubuntu 22.04/24.04
- Node.js 20+
- PostgreSQL client tools：`pg_dump` / `pg_restore`
- PM2
- Nginx 或同类 HTTPS 反向代理

示例：

```bash
sudo apt-get update
sudo apt-get install -y git postgresql-client nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

## 2. 拉取代码

```bash
mkdir -p /home/ubuntu/CascadeAI
cd /home/ubuntu/CascadeAI
git clone <repo-url> Cascade
cd Cascade
```

如果使用现有 PM2 配置，确认 `ecosystem.config.cjs` 里的：

- `cwd`
- `interpreter`
- `PORT`
- 日志路径

和服务器真实路径一致。

## 3. 配置环境变量

```bash
cp .env.example .env
nano .env
```

最少填：

```bash
DATABASE_URL=postgresql://...
SESSION_SECRET=<openssl rand -base64 48>
DOUBAO_API_KEY=...
APP_BASE_URL=https://your-domain.example
PORT=5000
```

生产环境不要使用默认的 `SESSION_SECRET`、`ADMIN_JWT_SECRET`、`ADMIN_TOTP_ENCRYPTION_KEY`。

## 4. 首次部署

空数据库：

```bash
npm run deploy:server -- --fresh-db --apply-schema --pm2=ecosystem.config.cjs
```

已有数据库：

```bash
npm run deploy:server -- --apply-schema --pm2=ecosystem.config.cjs
```

已有数据库会先执行 `scripts/db/backup.mjs`。确保部署机能运行 `pg_dump`。

## 5. 日常发版

```bash
cd /home/ubuntu/CascadeAI/Cascade
git pull
npm run deploy:server -- --apply-schema --pm2=ecosystem.config.cjs
```

如果确认 schema 没变，只发前后端代码：

```bash
npm run deploy:server -- --verify --pm2=ecosystem.config.cjs
```

只做上线前检查：

```bash
npm run deploy:preflight
```

## 6. Nginx 反代要点

生产 cookie 需要 HTTPS。反代到 PM2 监听端口，例如 5000：

```nginx
server {
  listen 443 ssl http2;
  server_name your-domain.example;

  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }
}
```

## 7. 健康检查

部署后检查：

```bash
pm2 status
pm2 logs cascadeai --lines 100
node --env-file=.env scripts/db/verify.mjs
curl -I https://your-domain.example
```

浏览器验证：

- 可以注册/登录；
- 新建项目能落库；
- 硬刷新后项目文件和 chat session 不丢；
- manager/build/review 的 action log 能恢复；
- agent 能读写项目文件并在完成后写入项目记忆。

## 8. 常见故障

`Not authenticated` 或登录后刷新掉线：

- 确认走 HTTPS；
- 确认 Nginx 传递 `X-Forwarded-Proto`；
- 确认 `.env` 有稳定的 `SESSION_SECRET`；
- 确认 `session` 表和 `IDX_session_expire` 存在。

数据库连接超时：

- 先运行 `node --env-file=.env scripts/db/preflight.mjs`；
- 确认云数据库白名单和 `sslmode=require`；
- 查看 PM2 日志中的 `[pg-pool]` / `[pg-session]`。

`verify.mjs` 缺表或缺索引：

- 运行 `npm run db:push`；
- 如果 diff 出现非预期 `DROP`，立即中止并核对 `database/schema/*.ts`。

PM2 启动后前端 404 或白屏：

- 确认已经运行 `npm run build`；
- 确认 `dist/public` 存在；
- 确认 `NODE_ENV=production`。
