# 测试套件 (Test Suite)

本项目的自动化测试覆盖三层：**单元 (unit)**、**集成 (integration)**、**压力 (stress)**，外加浏览器端 **端到端 (E2E)**。目标是尽可能模拟真实用户的边界行为（高并发、高频操作、断线重连、畸形输入），并把暴露出的真实产品缺陷记录在仓库根目录的 [`STRESS_FINDINGS.md`](../../../STRESS_FINDINGS.md)。

## 快速开始

```bash
# 单元测试（纯逻辑，无需数据库，CI 安全）
npm run test:unit

# 集成测试（需要测试数据库，见下方“数据库”）
npm run test:integration

# 压力测试（并发/高频/模糊，同样走测试库）
npm run test:stress

# vitest 全量（unit + integration + stress）
npm test

# 端到端（真实 Chromium + 真实服务器 + mock 掉的 /api）
npm run test:e2e

# 全部（vitest + playwright）
npm run test:all
```

## 目录结构

```
backend/api/__tests__/
  _helpers/                 # 共享测试基建
    setup-env.ts            #   把 TEST_DATABASE_URL 重定向到 DATABASE_URL（在任何 app 模块加载前）
    db.ts                   #   describeIntegration / truncateAll / seedInviteCode（带“只允许测试库”安全闸）
    app-factory.ts          #   在随机端口拉起一个真实 Express 实例供 HTTP 测试
    http-client.ts          #   基于 fetch 的轻客户端 + cookie jar（支持会话流）+ stream()
    ai-mock.ts              #   拦截所有 AI provider 的 chat.completions.create（流式/非流式/延迟/报错）
    sse.ts                  #   SSE 帧解析 + 断点重连 + eventId 收集
  unit/                     # 纯逻辑，无 I/O
    semaphore.test.ts       #   信号量不变量（含 1000 并发饱和）
    user-session-tracker.test.ts
    otp-logic.test.ts       #   normalizeTarget / 验证码格式
  integration/              # 路由 + 真实 Postgres
    projects.crud.test.ts   #   /api/projects 增删改查 + 模板播种
    project-files.test.ts   #   批量/单文件 upsert 三态、自愈分支
    messages.test.ts        #   字段清洗、按 clientId 幂等 upsert、afterSeq 删除
    auth.test.ts            #   密码注册/登录/登出、会话、邀请码闸
    otp.integration.test.ts #   OTP 发送/校验、冷却、锁定、消费
    waitlist.test.ts        #   候补名单提交/去重/管理员闸
    build-session.lifecycle.test.ts
    manager-chat.lifecycle.test.ts
    harness.smoke.test.ts   #   基建自检
  stress/                   # 并发 / 高频 / 模糊（与 integration 共用 setup）
    file-writes.race.test.ts        # 同路径 100 并发写 → 恒 1 行、0 死锁
    session-cap.stress.test.ts      # 单用户会话上限 429
    sse-reconnect.stress.test.ts    # 断流重连无丢失/无重复
    semaphore-saturation.stress.test.ts
    rapid-fire.stress.test.ts       # 连点/连存/启停
    fuzz.stress.test.ts             # 类型混淆 / 超大 / 控制符 / 注入 / 原型污染
    otp-bruteforce.stress.test.ts   # 暴力猜码锁定

e2e/                        # Playwright 浏览器端
  _helpers/mock-api.ts      #   浏览器层拦截所有 /api/*（auth/projects/files/messages/SSE）
  smoke.e2e.ts              #   仪表盘加载、未登录跳转、建项目进 IDE
  plan-mode-streaming.e2e.ts#   plan 模式 SSE 流式渲染 + 计划卡片
  concurrent-projects.e2e.ts#   多项目创建/切换/删除
  reconnect.e2e.ts          #   刷新/重进/中断后恢复
  rapid-interaction.e2e.ts  #   连点提交、狂切模式、连发消息
```

## 数据库

集成与压力测试跑在独立的 **`cascade_test`** 库上，绝不碰开发/生产数据：

1. 在仓库根目录创建 `.env.test`（已 gitignore），至少包含：
   ```
   TEST_DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/cascade_test
   ```
2. 建库并迁移 schema：
   ```bash
   createdb cascade_test           # 或用你的 PG 客户端
   cross-env DATABASE_URL=$TEST_DATABASE_URL npm run db:push
   ```
3. 安全保障：
   - `setup-env.ts` 在任何 app 模块加载前，把 `TEST_DATABASE_URL` 写到 `DATABASE_URL`。
   - `db.ts` 的 `truncateAll()` 带闸：当前连接串里不含 `test` 字样时**拒绝**清表，防止误删开发数据。
   - 没配 `TEST_DATABASE_URL` 时，`describeIntegration` 自动 `skip`，集成/压力测试变成 no-op 而非失败——单元测试仍可在任意机器上跑。

## AI 调用如何处理

所有会真实打到 AI 厂商（Doubao / GLM / Kimi / MiniMax）的路径都被 **mock**：

- vitest 侧：`_helpers/ai-mock.ts` 用 `vi.spyOn` 替换每个 provider 单例的 `chat.completions.create`，可配置流式分片、每片延迟（用于饱和信号量）、报错（测重试/降级）。
- E2E 侧：`e2e/_helpers/mock-api.ts` 在浏览器网络层拦截保留的基础 API，避免依赖真实外部服务。

因此测试**确定、离线、零成本**，且可放心做高并发/高频压测。

## 端到端 (E2E) 说明

- `playwright.config.ts` 的 `webServer` 用 `tsx` 以 `NODE_ENV=production` 拉起真实服务器（serve `dist/public` 的 SPA），监听 `E2E_PORT`（默认 5099），DB 指向测试库。
  - 用 `tsx`（而非 `node dist/index.mjs`）纯粹是为了免去每次 E2E 前重新打包后端；两条路径如今都能正常启动（SEV-4 的 CJS 崩溃已修复，构建产物现为 ESM `dist/index.mjs`）。
- 需要先有前端构建产物 `dist/public`；缺失时先 `npm run build`。
- 首次需安装浏览器：`npx playwright install chromium`。
- 认证：`/api/auth/me` 被 mock 成已登录用户，E2E 无需真实会话或邀请码。
- 已知的 SPA 行为：硬刷新/整页 `goto` 会重挂 `App.tsx` 并重跑 `/api/auth/me`，与拦截存在竞态；helper 通过**注册在 browser context 上的路由** + **走应用内导航（点卡片/返回键）**规避，IDE↔仪表盘切换请用 `backToDashboard()` 而非 `page.goto`。

## 发现的真实缺陷

测试过程中发现并（多数）修复了 5 个真实产品缺陷，详见根目录 [`STRESS_FINDINGS.md`](../../../STRESS_FINDINGS.md)：信号量死锁、OTP 频控时区失效、文件并发写重复行+死锁、多端点畸形输入 500、生产 CJS 构建崩溃。

## 约定

- 集成/压力测试串行跑（`fileParallelism` 关闭），避免共享测试库的跨用例污染。
- 每个用例 `beforeEach` 调 `truncateAll()` 保证隔离。
- 新增集成测试请用 `describeIntegration` 而非 `describe`，以便无测试库时自动跳过。
