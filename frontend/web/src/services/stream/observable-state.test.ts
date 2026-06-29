import { describe, it, expect, vi } from "vitest";
import { ObservableState } from "./observable-state";

/**
 * ObservableState backs every per-session stream slot. The whole "switching
 * sessions doesn't wipe an in-flight build's progress" guarantee rests on each
 * slot owning an INDEPENDENT instance whose updates never bleed into another.
 * These tests lock that isolation + the change-detection contract that
 * useSyncExternalStore relies on.
 */
describe("ObservableState", () => {
  interface S { a: number; b: string; nested: Record<number, string> }
  const initial: S = { a: 0, b: "", nested: {} };

  it("set() only notifies when a value actually changes (referential)", () => {
    const s = new ObservableState<S>(initial);
    let notifications = 0;
    s.subscribe(() => { notifications++; });

    s.set({ a: 1 });
    expect(notifications).toBe(1);
    // Same value → no notify (prevents redundant re-renders).
    s.set({ a: 1 });
    expect(notifications).toBe(1);
    s.set({ a: 2 });
    expect(notifications).toBe(2);
  });

  it("getSnapshot() returns a stable ref until the next change", () => {
    const s = new ObservableState<S>(initial);
    const snap1 = s.getSnapshot();
    expect(s.getSnapshot()).toBe(snap1); // stable across reads
    s.set({ a: 1 });
    const snap2 = s.getSnapshot();
    expect(snap2).not.toBe(snap1); // new ref after change
    expect(snap2.a).toBe(1);
  });

  it("two instances are fully isolated — updates never bleed across", () => {
    const sessionA = new ObservableState<S>(initial);
    const sessionB = new ObservableState<S>(initial);

    sessionA.set({ a: 100, nested: { 1: "running", 2: "done" } });
    // B is untouched — this is the core 'switching sessions keeps each
    // session's progress' guarantee at the primitive level.
    expect(sessionB.get().a).toBe(0);
    expect(sessionB.get().nested).toEqual({});
    expect(sessionA.get().nested).toEqual({ 1: "running", 2: "done" });
  });

  it("a reset on one instance does not disturb another", () => {
    const sessionA = new ObservableState<S>(initial);
    const sessionB = new ObservableState<S>(initial);
    sessionA.set({ a: 5 });
    sessionB.set({ a: 9 });
    sessionA.reset({ a: 0, b: "", nested: {} });
    expect(sessionA.get().a).toBe(0);
    expect(sessionB.get().a).toBe(9); // B's in-flight value survives A's reset
  });

  it("unsubscribe stops further notifications", () => {
    const s = new ObservableState<S>(initial);
    let n = 0;
    const off = s.subscribe(() => { n++; });
    s.set({ a: 1 });
    expect(n).toBe(1);
    off();
    s.set({ a: 2 });
    expect(n).toBe(1); // no longer notified
  });

  it("a throwing listener does not block other listeners", () => {
    const s = new ObservableState<S>(initial);
    const good = vi.fn();
    s.subscribe(() => { throw new Error("listener boom"); });
    s.subscribe(good);
    expect(() => s.set({ a: 1 })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
