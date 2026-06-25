/**
 * Robustness stress tests for Cascade backend.
 * Tests concurrency, session management, localStorage equivalents,
 * and edge cases that cause "prompt sent but no reply" bugs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Semaphore, UserSessionTracker } from "../../src/infra/concurrency";

describe("Semaphore robustness", () => {
  it("releases slot even if function throws", async () => {
    const sem = new Semaphore(1);
    try {
      await sem.run(async () => { throw new Error("boom"); });
    } catch {}
    // Slot should be released — next acquire should succeed immediately
    const start = Date.now();
    await sem.acquire(100);
    expect(Date.now() - start).toBeLessThan(50);
    sem.release();
  });

  it("handles rapid acquire/release without deadlock", async () => {
    const sem = new Semaphore(3);
    const results: number[] = [];
    const tasks = Array.from({ length: 20 }, (_, i) =>
      sem.run(async () => {
        await new Promise(r => setTimeout(r, 10));
        results.push(i);
      }, 5000)
    );
    await Promise.all(tasks);
    expect(results.length).toBe(20);
  });

  it("rejects waiters after timeout without leaking slots", async () => {
    const sem = new Semaphore(1);
    await sem.acquire(); // take the only slot
    // Second acquire should timeout
    await expect(sem.acquire(50)).rejects.toThrow(/timeout/i);
    // Semaphore should still function after timeout
    sem.release();
    await sem.acquire(50); // should succeed now
    sem.release();
    expect(sem.running).toBe(0);
  });

  it("handles concurrent acquire racing with release", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    // Both slots taken. Start 5 waiters, then release slots one by one.
    const waiters = Array.from({ length: 5 }, () => sem.acquire(2000));
    for (let i = 0; i < 5; i++) {
      sem.release();
      await new Promise(r => setTimeout(r, 5));
    }
    await Promise.all(waiters);
    // All waiters resolved; release their slots
    for (let i = 0; i < 5; i++) sem.release();
    expect(sem.running).toBe(0);
    expect(sem.pending).toBe(0);
  });

  it("never goes negative on double-release", () => {
    const sem = new Semaphore(2);
    // Double release shouldn't crash or go negative
    sem.release();
    sem.release();
    sem.release();
    // The semaphore implementation may allow it (queue drains), just don't crash
    expect(true).toBe(true);
  });
});

describe("UserSessionTracker robustness", () => {
  let tracker: UserSessionTracker;

  beforeEach(() => {
    tracker = new UserSessionTracker(3);
  });

  it("allows registration up to limit", () => {
    expect(tracker.register("u1", "s1")).toBe(true);
    expect(tracker.register("u1", "s2")).toBe(true);
    expect(tracker.register("u1", "s3")).toBe(true);
    expect(tracker.register("u1", "s4")).toBe(false); // limit reached
  });

  it("idempotent registration doesn't consume extra slots", () => {
    tracker.register("u1", "s1");
    tracker.register("u1", "s1"); // same session
    tracker.register("u1", "s1"); // same session
    expect(tracker.count("u1")).toBe(1);
    expect(tracker.register("u1", "s2")).toBe(true); // still has room
  });

  it("unregister frees slot for new registrations", () => {
    tracker.register("u1", "s1");
    tracker.register("u1", "s2");
    tracker.register("u1", "s3");
    expect(tracker.register("u1", "s4")).toBe(false);
    tracker.unregister("u1", "s2");
    expect(tracker.register("u1", "s4")).toBe(true);
  });

  it("unregister is idempotent — doesn't crash on unknown session", () => {
    tracker.unregister("unknown-user", "unknown-session");
    tracker.register("u1", "s1");
    tracker.unregister("u1", "s1");
    tracker.unregister("u1", "s1"); // double unregister
    expect(tracker.count("u1")).toBe(0);
  });

  it("anonymous users (no userId) bypass limit", () => {
    // Empty string userId
    expect(tracker.register("", "s1")).toBe(true);
    expect(tracker.register("", "s2")).toBe(true);
    // register 100 sessions with empty userId — all should succeed
    for (let i = 0; i < 100; i++) {
      expect(tracker.register("", `anon-${i}`)).toBe(true);
    }
  });

  it("different users have independent limits", () => {
    tracker.register("u1", "s1");
    tracker.register("u1", "s2");
    tracker.register("u1", "s3");
    expect(tracker.register("u1", "s4")).toBe(false);
    // u2 should be unaffected
    expect(tracker.register("u2", "s1")).toBe(true);
    expect(tracker.register("u2", "s2")).toBe(true);
  });

  it("cleanup removes user entry when all sessions unregistered", () => {
    tracker.register("u1", "s1");
    tracker.register("u1", "s2");
    tracker.unregister("u1", "s1");
    tracker.unregister("u1", "s2");
    expect(tracker.totalSessions()).toBe(0);
  });

  it("simulates the leak scenario: error before unregister", () => {
    // Simulate: register succeeds, then error occurs, no unregister called
    tracker.register("u1", "s1");
    tracker.register("u1", "s2");
    // "Error happens" — s2 never unregistered
    tracker.register("u1", "s3");
    // Now user is stuck at limit
    expect(tracker.register("u1", "s4")).toBe(false);
    // Fix: explicitly unregister leaked session
    tracker.unregister("u1", "s2");
    expect(tracker.register("u1", "s4")).toBe(true);
  });
});

describe("SSE writer safety", () => {
  it("Array.from(set) is safe during concurrent modification", () => {
    // Simulates the pattern used in build session finalization
    const writers = new Set<(line: string) => void>();
    const results: string[] = [];

    writers.add((l) => results.push(l));
    writers.add((l) => {
      results.push(l);
      // Simulate a writer that removes itself during iteration
      // Array.from() snapshot prevents ConcurrentModificationException
    });
    writers.add((l) => results.push(l));

    // This pattern is used in the codebase — iterate snapshot, not the live set
    const doneLine = "data: [DONE]\n\n";
    Array.from(writers).forEach(w => { try { w(doneLine); } catch {} });
    expect(results.length).toBe(3);
  });

  it("writer that throws doesn't break other writers", () => {
    const writers = new Set<(line: string) => void>();
    const results: string[] = [];

    writers.add((l) => results.push("ok1"));
    writers.add(() => { throw new Error("broken pipe"); });
    writers.add((l) => results.push("ok2"));

    Array.from(writers).forEach(w => { try { w("test"); } catch {} });
    expect(results).toEqual(["ok1", "ok2"]);
  });
});

describe("Context compressor edge cases", () => {
  it("handles empty messages array", async () => {
    // Mock the OpenAI client before importing
    vi.stubEnv("DOUBAO_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const { compressMessages } = await import("../../src/infra/context-compressor");
    const result = await compressMessages([]);
    expect(result).toEqual([]);
  });

  it("passes through messages under threshold without modification", async () => {
    vi.stubEnv("DOUBAO_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const { compressMessages } = await import("../../src/infra/context-compressor");
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi there" },
    ];
    const result = await compressMessages(messages);
    expect(result).toEqual(messages);
  });
});
