import { describe, it, expect, vi } from "vitest";
import { Semaphore } from "../../src/infra/concurrency";

/**
 * Unit + micro-stress tests for the Semaphore that caps in-flight AI calls.
 * The whole concurrency story for 100+ users rests on this class, so we probe
 * FIFO ordering, the timeout/queue-cleanup path, release-without-waiters
 * underflow, and a 1000-way saturation run that must never exceed `max`.
 */
describe("Semaphore", () => {
  it("acquires immediately when under capacity", async () => {
    const s = new Semaphore(2);
    await s.acquire();
    await s.acquire();
    expect(s.running).toBe(2);
    expect(s.available).toBe(0);
    expect(s.pending).toBe(0);
  });

  it("queues acquirers past capacity and releases FIFO", async () => {
    const s = new Semaphore(1);
    await s.acquire(); // holder

    const order: number[] = [];
    const p1 = s.acquire().then(() => order.push(1));
    const p2 = s.acquire().then(() => order.push(2));
    expect(s.pending).toBe(2);

    s.release(); // wakes p1
    await p1;
    s.release(); // wakes p2
    await p2;

    expect(order).toEqual([1, 2]);
  });

  it("release without waiters decrements running (and never goes negative)", async () => {
    const s = new Semaphore(2);
    await s.acquire();
    s.release();
    expect(s.running).toBe(0);
    // Extra releases must not underflow.
    s.release();
    s.release();
    expect(s.running).toBe(0);
    // Capacity is intact afterwards.
    await s.acquire();
    expect(s.running).toBe(1);
  });

  it("times out a queued acquirer and removes it from the queue", async () => {
    vi.useFakeTimers();
    try {
      const s = new Semaphore(1);
      await s.acquire();
      const waiter = s.acquire(1000);
      const rejected = waiter.catch((e) => e);
      expect(s.pending).toBe(1);

      await vi.advanceTimersByTimeAsync(1001);
      const err = await rejected;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/timeout/i);
      expect(s.pending).toBe(0); // cleaned up
    } finally {
      vi.useRealTimers();
    }
  });

  it("run() releases on success and on throw", async () => {
    const s = new Semaphore(1);
    await expect(s.run(async () => 42)).resolves.toBe(42);
    expect(s.running).toBe(0);

    await expect(s.run(async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(s.running).toBe(0); // released despite the throw
  });

  it("a released slot from run() lets a queued run() proceed", async () => {
    const s = new Semaphore(1);
    let secondStarted = false;
    const first = s.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const second = s.run(async () => {
      secondStarted = true;
    });
    expect(secondStarted).toBe(false); // blocked behind first
    await Promise.all([first, second]);
    expect(secondStarted).toBe(true);
    expect(s.running).toBe(0);
  });

  describe("saturation stress", () => {
    it("never exceeds max with 1000 concurrent run() tasks", async () => {
      const MAX = 8;
      const s = new Semaphore(MAX);
      let live = 0;
      let observedMax = 0;
      let completed = 0;

      const tasks = Array.from({ length: 1000 }, (_, i) =>
        s.run(async () => {
          live++;
          observedMax = Math.max(observedMax, live);
          // tiny variable delay to interleave
          await new Promise((r) => setTimeout(r, i % 3));
          live--;
          completed++;
        }, 30_000),
      );

      await Promise.all(tasks);

      expect(observedMax).toBeLessThanOrEqual(MAX);
      expect(completed).toBe(1000);
      expect(s.running).toBe(0); // no leak
      expect(s.pending).toBe(0);
    });

    it("under capacity-1, all 200 tasks still complete eventually (queue drains)", async () => {
      const s = new Semaphore(1);
      let completed = 0;
      const tasks = Array.from({ length: 200 }, () =>
        s.run(async () => {
          completed++;
        }, 30_000),
      );
      await Promise.all(tasks);
      expect(completed).toBe(200);
      expect(s.running).toBe(0);
      expect(s.pending).toBe(0);
    });
  });

  describe("timeout vs hand-off race (orphan-slot guard)", () => {
    it("a waiter that times out does not consume a slot when the holder later releases", async () => {
      vi.useFakeTimers();
      try {
        const s = new Semaphore(1);
        await s.acquire(); // holder owns the only slot

        // Two queued waiters: w1 will time out, w2 should still get the slot.
        const w1 = s.acquire(1000).catch((e) => e);
        const w2created = s.acquire(60_000);
        let w2Acquired = false;
        const w2 = w2created.then(() => { w2Acquired = true; });
        expect(s.pending).toBe(2);

        // w1 times out and removes itself from the queue.
        await vi.advanceTimersByTimeAsync(1001);
        const err = await w1;
        expect(err).toBeInstanceOf(Error);
        expect(s.pending).toBe(1); // only w2 remains

        // Holder releases — the freed slot must hand off to w2, not be orphaned.
        s.release();
        await w2;
        expect(w2Acquired).toBe(true);
        expect(s.pending).toBe(0);
        expect(s.running).toBe(1); // w2 holds it now; count is exactly 1, no leak

        // w2 releases — back to empty.
        s.release();
        expect(s.running).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("repeated timeout+release churn keeps running count exact (no ratchet)", async () => {
      vi.useFakeTimers();
      try {
        const s = new Semaphore(2);
        await s.acquire();
        await s.acquire(); // both slots held
        expect(s.running).toBe(2);

        // Pile on 10 waiters that all time out.
        const waiters = Array.from({ length: 10 }, () => s.acquire(500).catch((e) => e));
        expect(s.pending).toBe(10);
        await vi.advanceTimersByTimeAsync(501);
        await Promise.all(waiters);
        expect(s.pending).toBe(0);

        // Release both holders. running must land exactly at 0, never negative
        // and never stuck above 0 (the "ratchet" failure mode).
        s.release();
        s.release();
        expect(s.running).toBe(0);
        // Capacity fully restored.
        await s.acquire();
        await s.acquire();
        expect(s.running).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
