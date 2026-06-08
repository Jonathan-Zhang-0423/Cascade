import { expect, it, describe, beforeEach } from "vitest";
import { Semaphore } from "../../src/infra/concurrency";

/**
 * Semaphore saturation stress — the global aiSemaphore is the single limiter
 * standing between 100+ concurrent users and provider rate-limit bans. These
 * tests pound it with far more concurrent acquirers than slots and assert the
 * three invariants that the SEV-1 deadlock violated:
 *   1. never more than `max` holders at once (the cap actually caps),
 *   2. counters return to zero after every holder releases (no ratchet/leak),
 *   3. queued waiters are admitted in FIFO order as slots free.
 */
describe("stress: semaphore saturation", () => {
  it("never exceeds max under 1000 concurrent run() tasks, and drains to zero", async () => {
    const max = 8;
    const sem = new Semaphore(max);
    let live = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 1000 }, () =>
        sem.run(async () => {
          live++;
          peak = Math.max(peak, live);
          // Yield so overlap is real, not serialized by the microtask queue.
          await new Promise((r) => setTimeout(r, 1));
          live--;
        }),
      ),
    );

    expect(peak).toBeLessThanOrEqual(max);
    expect(sem.running).toBe(0);
    expect(sem.pending).toBe(0);
    expect(sem.available).toBe(max);
  });

  it("holds the line at capacity-1 with 500 tasks and leaves no residual", async () => {
    const max = 1;
    const sem = new Semaphore(max);
    let live = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 500 }, () =>
        sem.run(async () => {
          live++;
          peak = Math.max(peak, live);
          await new Promise((r) => setTimeout(r, 0));
          live--;
        }),
      ),
    );
    expect(peak).toBe(1);
    expect(sem.running).toBe(0);
    expect(sem.pending).toBe(0);
  });

  it("admits queued waiters in FIFO order", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    await sem.acquire(); // occupy the only slot

    // Queue 10 waiters; each records its index when admitted.
    const waiters = Array.from({ length: 10 }, (_, i) =>
      sem.acquire().then(() => {
        order.push(i);
        sem.release();
      }),
    );

    // Release the initial holder → cascade through the queue.
    sem.release();
    await Promise.all(waiters);

    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sem.running).toBe(0);
    expect(sem.pending).toBe(0);
  });

  it("times out a waiter that never gets a slot, without corrupting the counter", async () => {
    const sem = new Semaphore(1);
    await sem.acquire(); // hold the slot forever (within this test)

    // This waiter can never be admitted; it must reject on timeout.
    await expect(sem.acquire(50)).rejects.toThrow(/timeout/i);

    // The timed-out waiter must have been removed from the queue — no leak.
    expect(sem.pending).toBe(0);
    expect(sem.running).toBe(1);

    // Releasing the holder returns the semaphore to a clean state.
    sem.release();
    expect(sem.running).toBe(0);
    expect(sem.available).toBe(1);
  });

  it("survives interleaved acquire/timeout/release churn and ends balanced", async () => {
    const max = 4;
    const sem = new Semaphore(max);
    const tasks: Promise<unknown>[] = [];

    for (let i = 0; i < 300; i++) {
      // Mix of fast holders and impatient waiters with short timeouts.
      if (i % 5 === 0) {
        tasks.push(sem.acquire(5).then(() => sem.release()).catch(() => {}));
      } else {
        tasks.push(
          sem
            .run(async () => {
              await new Promise((r) => setTimeout(r, Math.floor(i % 7)));
            })
            .catch(() => {}),
        );
      }
    }
    await Promise.all(tasks);

    // Allow any straggler timers to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(sem.running).toBe(0);
    expect(sem.pending).toBe(0);
    expect(sem.available).toBe(max);
  });
});
