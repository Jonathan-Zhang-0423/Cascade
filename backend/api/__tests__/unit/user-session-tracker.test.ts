import { describe, it, expect } from "vitest";
import { UserSessionTracker } from "../../src/infra/concurrency";

/**
 * UserSessionTracker enforces the per-user active-session cap that stops one
 * user from hogging all build slots. Tests cover the anonymous bypass,
 * idempotent registration, the cap boundary, cleanup on unregister, and a
 * high-churn interleaving that must not leak or go negative.
 */
describe("UserSessionTracker", () => {
  it("does not limit anonymous users (empty userId)", () => {
    const t = new UserSessionTracker(1);
    expect(t.register("", "s1")).toBe(true);
    expect(t.register("", "s2")).toBe(true);
    expect(t.register("", "s3")).toBe(true);
    // Anonymous sessions are not tracked, so total stays 0.
    expect(t.totalSessions()).toBe(0);
  });

  it("allows up to maxPerUser then rejects", () => {
    const t = new UserSessionTracker(3);
    expect(t.register("u1", "a")).toBe(true);
    expect(t.register("u1", "b")).toBe(true);
    expect(t.register("u1", "c")).toBe(true);
    expect(t.register("u1", "d")).toBe(false); // at cap
    expect(t.count("u1")).toBe(3);
  });

  it("is idempotent for an already-registered session", () => {
    const t = new UserSessionTracker(1);
    expect(t.register("u1", "a")).toBe(true);
    expect(t.register("u1", "a")).toBe(true); // same session, still ok
    expect(t.count("u1")).toBe(1);
    // A different session is rejected at cap 1.
    expect(t.register("u1", "b")).toBe(false);
  });

  it("frees a slot on unregister", () => {
    const t = new UserSessionTracker(1);
    expect(t.register("u1", "a")).toBe(true);
    expect(t.register("u1", "b")).toBe(false);
    t.unregister("u1", "a");
    expect(t.count("u1")).toBe(0);
    expect(t.register("u1", "b")).toBe(true);
  });

  it("unregister of unknown user/session is a no-op", () => {
    const t = new UserSessionTracker(2);
    t.unregister("ghost", "nope"); // must not throw
    t.register("u1", "a");
    t.unregister("u1", "other"); // session not present
    expect(t.count("u1")).toBe(1);
  });

  it("cleans up the user entry when the last session leaves", () => {
    const t = new UserSessionTracker(2);
    t.register("u1", "a");
    t.unregister("u1", "a");
    expect(t.count("u1")).toBe(0);
    expect(t.totalSessions()).toBe(0);
  });

  it("totalSessions sums across users", () => {
    const t = new UserSessionTracker(5);
    t.register("u1", "a");
    t.register("u1", "b");
    t.register("u2", "c");
    expect(t.totalSessions()).toBe(3);
  });

  it("high-churn register/unregister never leaks or goes negative", () => {
    const t = new UserSessionTracker(5);
    const users = ["u1", "u2", "u3"];
    let sid = 0;
    const live = new Map<string, string[]>(users.map((u) => [u, []]));

    for (let i = 0; i < 5000; i++) {
      const u = users[i % users.length];
      const sessions = live.get(u)!;
      // Randomly add or drop.
      if (sessions.length === 0 || i % 2 === 0) {
        const id = `s${sid++}`;
        if (t.register(u, id)) sessions.push(id);
      } else {
        const id = sessions.pop()!;
        t.unregister(u, id);
      }
      expect(t.count(u)).toBe(sessions.length);
      expect(t.count(u)).toBeLessThanOrEqual(5);
      expect(t.count(u)).toBeGreaterThanOrEqual(0);
    }
  });
});
