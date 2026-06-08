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
