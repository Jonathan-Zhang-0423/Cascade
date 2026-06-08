# 压力测试发现的漏洞 (Stress Test Findings)

本文件记录测试套件暴露的**真实产品代码缺陷**（非测试本身的问题），按严重度排序。

---

## 🔴 SEV-1: `Semaphore` 计数器在「交接」时只增不减，长跑必然死锁

**文件**：`backend/api/src/infra/concurrency.ts:23-53`
**发现于**：`backend/api/__tests__/unit/semaphore.test.ts`（饱和压测）
**影响面**：全局 `aiSemaphore`（限制所有 in-flight AI 调用）。这是承载 100+ 并发用户的核心限流器。

### 根因

```ts
async acquire(timeoutMs = 60_000) {
  if (this.current < this.max) { this.current++; return; }      // 直接获取：+1
  return new Promise((resolve, reject) => {
    const entry = { resolve: () => { this.current++; resolve(); }, ... }; // 交接获取：又 +1
    ...
    this.queue.push(entry);
  });
}

release() {
  if (this.queue.length > 0) {
    const next = this.queue.shift()!;
    next.resolve();          // ← 唤醒等待者，等待者里执行 this.current++
                             // ← 但本次 release 腾出的槽位【没有】对应 current--
  } else {
    this.current = Math.max(0, this.current - 1);   // 只有空队列分支才会 --
  }
}
```

当 `release()` 命中等待队列时：
- 释放方腾出的槽位**没有** `current--`；
- 被唤醒的等待者却执行了 `current++`。

于是**每一次「有等待者时的交接」都会让 `current` 净增 1，且永不回收**。

### 后果（已用测试证明）

- 单测 `never exceeds max with 1000 concurrent run() tasks`：1000 个任务跑完后 `running` 残留 **992**（应为 0）。
- 单测 `under capacity-1, 200 tasks`：跑完残留 **199**。
- 一旦 `current` 永久 `>= max`，之后所有 `acquire()` 全部进队列，并在 `timeoutMs`（默认 60s）后 reject。
  对长驻单例 `aiSemaphore` 而言，这是**渐进式死锁**：服务在累计足够多次「排队获取」后，所有 AI 调用开始 60s 超时失败，且**重启才能恢复**。
- `getConcurrencyMetrics()` 上报的 `running` 会虚高，监控失真。

### 修复

`release()` 在交接分支不应让等待者再 `++`：让「腾出的槽位」直接转交给等待者，`current` 保持不变（一进一出）。最小改动：

```ts
acquire(timeoutMs = 60_000) {
  if (this.current < this.max) { this.current++; return Promise.resolve(); }
  return new Promise<void>((resolve, reject) => {
    const entry = { resolve, timer: null };   // ← 去掉 resolve 里的 current++
    entry.timer = setTimeout(() => { ...reject... }, timeoutMs);
    this.queue.push(entry);
  });
}

release() {
  if (this.queue.length > 0) {
    const next = this.queue.shift()!;
    if (next.timer) clearTimeout(next.timer);
    next.resolve();              // 槽位直接转交，current 不变（占用者从释放方换成等待者）
  } else {
    this.current = Math.max(0, this.current - 1);
  }
}
```

**状态**：✅ 已修复（见对应 commit / 下方测试已全绿）。修复后 `running`/`pending` 在所有饱和压测后归零。

---
<!-- 后续发现追加到这里 -->

## 🟠 SEV-2: OTP 发送频控（60s 冷却 + 每小时上限）完全失效 — 时区误解析

**文件**：`backend/api/src/auth/otp.ts:46-68`
**发现于**：`backend/api/__tests__/integration/otp.integration.test.ts`（「60s 冷却」用例在套件中偶发、单跑稳定失败）
**影响面**：`POST /api/auth/otp/send`。频控失效意味着**任意邮箱/手机号可被无限次触发验证码发送** → 短信/邮件成本被刷爆、对第三方做 OTP 轰炸、潜在的发送方信誉损伤。

### 根因（schema 与真实库不一致 + 驱动按本地时区解析）

`database/schema/otp-codes.ts` 把三个时间列都声明为 `{ withTimezone: true }`，但**真实库里它们是 `timestamp without time zone`**（用 `drizzle-kit push` 建表时丢了时区）。已核实：

- 测试库 `cascade_test`：`created_at / expires_at / consumed_at` 全部 `timestamp without time zone`
- 生产/开发库 `codestart`：同样三列全部 `timestamp without time zone`

`created_at` 由 DB 端 `defaultNow()`（UTC）写入。`pg` 驱动读取**无时区**列时，按 **Node 进程本地时区**（本机 UTC+8）构造 JS `Date`，于是读回的 `createdAt` 比真实写入时刻**早 8 小时**。

而冷却判断把它和 JS 端的 `now = new Date()`（正确 UTC）相减：

```ts
const elapsed = (now.getTime() - latest.createdAt.getTime()) / 1000;  // 恒 ≈ +28800s
if (elapsed < RESEND_COOLDOWN_SEC) { ... }                            // 永远为 false
```

实测：刚插入的行读回 `createdAt=02:28:11Z`，而 `now=10:28:11Z`，`elapsed=28800.012` 秒。
→ 60s 冷却永不触发；每小时上限（`gt(createdAt, oneHourAgo)`，`oneHourAgo` 也是 JS Date）同理失效。

### 修复

把所有时间比较交给 **DB 时钟**（`now()` / `interval`），不再依赖 JS 端读回的 Date，彻底规避列时区类型问题：

- 冷却：`extract(epoch from (now() - created_at))` 在 SQL 端算 elapsed。
- 每小时上限：`created_at > now() - interval '1 hour'`。
- 过期时间：写入用 `now() + interval '10 minutes'`，verify 比较用 `expires_at > now()`。

**状态**：✅ 已修复（见下方测试，单跑 + 全套件均稳定）。

> 备注：根因之一是 schema 的 `withTimezone: true` 与真实列类型不符。彻底的根治应另跟一个 DDL 迁移把三列改成 `timestamptz`；本次先用 DB 时钟比较消除可利用的安全影响，不动生产 DDL。

---

## 🔴 SEV-1: `upsertProjectFile` 非原子（先读后写）+ `project_files` 缺唯一约束 → 并发写产生重复行并触发死锁

**文件**：`backend/api/src/infra/storage.ts:154-164`、`database/schema/files.ts`
**发现于**：`backend/api/__tests__/stress/file-writes.race.test.ts`（同路径并发写压测）
**影响面**：所有文件落库路径。不仅是 `PUT /api/projects/:id/files/single`，**AI 构建期间的每一次文件写入**都走这里（`agent/tools/agent-tools.ts:21`、`agent/tools/ast-tools.ts:145`、`agent/orchestrator/build-orchestrator.ts:696`）。即正常的一次 AI build 内部并发写同一文件，就可能静默写脏项目。

### 根因

```ts
async upsertProjectFile(projectId, path, content) {
  const [existing] = await db.select()...where(projectId, path);   // 读
  if (existing) await db.update(...);                              // 写
  else          await db.insert(...);                             // 写
}
```

1. **先读后写非原子**：N 个并发请求同时 `SELECT` 都未命中 → 全部走 `INSERT` 分支 → 同一 `(project_id, path)` 插入 **N 行重复数据**。
2. **表无唯一约束**：`project_files` 只有自增主键 `id`，`(project_id, path)` 上**没有 unique 约束**，数据库层不兜底，重复行得以落地。
3. **死锁**：并发的 `INSERT`/`UPDATE` 交错获取行锁，顺序不一致 → PostgreSQL `deadlock detected`，请求 500。

### 后果（已用测试证明）

向单一路径 `/project/hot.ts` 并发发 100 次写：
- 结果 **83 行**重复（应为 1 行）→ 之后 `GET /files` 同一路径返回多份，前端/AGENT 读到哪份不确定，项目状态损坏。
- **9/100 请求返回 500 `deadlock detected`** → 用户侧表现为保存随机失败。

`upsertProjectFiles`（批量）同样是「全表读进内存→逐条 insert/update/delete」的非原子模式，并发批量写存在相同的重复与丢写风险。

### 修复

1. **DDL**：给 `project_files` 加 `UNIQUE (project_id, path)`（先去重存量数据再加约束）。
2. **原子 upsert**：改用 `INSERT ... ON CONFLICT (project_id, path) DO UPDATE SET content = EXCLUDED.content`，单语句完成，消除先读后写窗口与重复行。
3. 批量 `upsertProjectFiles` 的 insert 段同样改 `onConflictDoUpdate`，使其在并发下幂等。

修复后死锁面也随之消失（单语句 upsert 不再有跨语句的锁顺序交错）。

**状态**：✅ 已修复（见下方测试，同路径 100 并发写后恒为 1 行、0 个 500）。

> ⚠️ **生产/开发库 `codestart` 仍需迁移**：修复后的 `onConflictDoUpdate` **依赖** `project_files` 上的 `UNIQUE (project_id, path)` 约束。本次只在**测试库 `cascade_test`** 上加了该约束（并先去重了 82 行存量重复数据）。`codestart` 上线前必须：①先按 `(project_id, path)` 去重存量重复行（保留最小 `id`），②再 `npm run db:push` 或手动 `ALTER TABLE ... ADD CONSTRAINT`。**未经确认不对 `codestart` 执行该 DDL。**


