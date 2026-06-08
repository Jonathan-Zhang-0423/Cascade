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
});
