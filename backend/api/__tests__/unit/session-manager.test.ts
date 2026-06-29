import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionManager, type AgentSession } from "../../src/agent/session/session-manager";
import type { SessionStore } from "../../src/agent/session/session-store";

/**
 * SessionManager unit tests — state machine transitions, cleanup guarantees,
 * and lifecycle correctness. The SessionStore is mocked (no real DB) so these
 * run as pure unit tests.
 */

function mockStore(): SessionStore {
  return {
    create: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    flushEvents: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
    loadActiveForProject: vi.fn().mockResolvedValue([]),
    markInterruptedOnStartup: vi.fn().mockResolvedValue(0),
    deleteOld: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionStore;
}

describe("SessionManager", () => {
  let store: ReturnType<typeof mockStore>;
  let mgr: SessionManager;

  beforeEach(() => {
    store = mockStore();
    mgr = new SessionManager(store);
  });

  describe("create", () => {
    it("creates a session in pending state, persists to store, returns it", async () => {
      const session = await mgr.create({ id: "s1", type: "build", userId: "u1" });
      expect(session.id).toBe("s1");
      expect(session.type).toBe("build");
      expect(session.status).toBe("pending");
      expect(session.done).toBe(false);
      expect(session.events).toEqual([]);
      expect(session.resources).toEqual([]);
      expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", status: "pending" }));
    });

    it("session is retrievable from get() after create", async () => {
      await mgr.create({ id: "s2", type: "manager" });
      const got = await mgr.get("s2");
      expect(got).not.toBeNull();
      expect(got!.id).toBe("s2");
    });
  });

  describe("state machine transitions", () => {
    it("pending → running is valid", async () => {
      await mgr.create({ id: "t1", type: "build" });
      await mgr.transition("t1", "running");
      const s = await mgr.get("t1");
      expect(s!.status).toBe("running");
      expect(store.updateStatus).toHaveBeenCalledWith("t1", "running", undefined);
    });

    it("running → done sets doneAt and done flag", async () => {
      await mgr.create({ id: "t2", type: "build" });
      await mgr.transition("t2", "running");
      await mgr.transition("t2", "done");
      const s = await mgr.get("t2");
      expect(s!.status).toBe("done");
      expect(s!.done).toBe(true);
      expect(s!.doneAt).toBeGreaterThan(0);
    });

    it("running → error is valid", async () => {
      await mgr.create({ id: "t3", type: "review" });
      await mgr.transition("t3", "running");
      await mgr.transition("t3", "error");
      const s = await mgr.get("t3");
      expect(s!.status).toBe("error");
      expect(s!.done).toBe(true);
    });

    it("done → running is INVALID (terminal state)", async () => {
      await mgr.create({ id: "t4", type: "manager" });
      await mgr.transition("t4", "running");
      await mgr.transition("t4", "done");
      await expect(mgr.transition("t4", "running")).rejects.toThrow("invalid transition");
    });

    it("pending → done is INVALID (must go through running)", async () => {
      await mgr.create({ id: "t5", type: "build" });
      await expect(mgr.transition("t5", "done")).rejects.toThrow("invalid transition");
    });

    it("running → aborted is valid (user cancel)", async () => {
      await mgr.create({ id: "t6", type: "build" });
      await mgr.transition("t6", "running");
      await mgr.transition("t6", "aborted");
      const s = await mgr.get("t6");
      expect(s!.status).toBe("aborted");
      expect(s!.done).toBe(true);
    });
  });

  describe("cleanup", () => {
    it("disposes all registered resources", async () => {
      const dispose1 = vi.fn().mockResolvedValue(undefined);
      const dispose2 = vi.fn().mockResolvedValue(undefined);
      await mgr.create({ id: "c1", type: "build", userId: "u1" });
      mgr.registerResource("c1", "lsp", dispose1);
      mgr.registerResource("c1", "shell", dispose2);
      await mgr.cleanup("c1");
      expect(dispose1).toHaveBeenCalledTimes(1);
      expect(dispose2).toHaveBeenCalledTimes(1);
    });

    it("continues cleanup even if one resource throws", async () => {
      const dispose1 = vi.fn().mockRejectedValue(new Error("lsp crash"));
      const dispose2 = vi.fn().mockResolvedValue(undefined);
      await mgr.create({ id: "c2", type: "build" });
      mgr.registerResource("c2", "lsp", dispose1);
      mgr.registerResource("c2", "shell", dispose2);
      await mgr.cleanup("c2"); // should not throw
      expect(dispose2).toHaveBeenCalledTimes(1);
    });

    it("persists final state to store", async () => {
      await mgr.create({ id: "c3", type: "manager" });
      await mgr.transition("c3", "running");
      await mgr.transition("c3", "done");
      await mgr.cleanup("c3");
      expect(store.updateStatus).toHaveBeenCalledWith("c3", "done", expect.any(Number));
      expect(store.flushEvents).toHaveBeenCalledWith("c3", [], 0);
    });

    it("is idempotent (safe to call twice)", async () => {
      await mgr.create({ id: "c4", type: "review" });
      await mgr.cleanup("c4");
      await mgr.cleanup("c4"); // should not throw
    });
  });

  describe("onStartup", () => {
    it("delegates to store.markInterruptedOnStartup", async () => {
      (store.markInterruptedOnStartup as any).mockResolvedValue(3);
      const count = await mgr.onStartup();
      expect(count).toBe(3);
      expect(store.markInterruptedOnStartup).toHaveBeenCalledTimes(1);
    });
  });

  describe("getEmit", () => {
    it("returns a function that pushes events to the session buffer", async () => {
      await mgr.create({ id: "e1", type: "build" });
      const emit = mgr.getEmit("e1");
      emit({ type: "test_event", value: 42 });
      const s = await mgr.get("e1");
      expect(s!.events).toHaveLength(1);
      expect(s!.events[0].data.type).toBe("test_event");
      expect(s!.events[0].data.value).toBe(42);
      expect(s!._dirty).toBe(true);
    });

    it("throws for unknown session", () => {
      expect(() => mgr.getEmit("nonexistent")).toThrow("not in live cache");
    });
  });

  describe("isActive", () => {
    it("returns true for pending/running sessions", async () => {
      await mgr.create({ id: "a1", type: "build" });
      expect(mgr.isActive("a1")).toBe(true);
      await mgr.transition("a1", "running");
      expect(mgr.isActive("a1")).toBe(true);
    });

    it("returns false for terminal sessions", async () => {
      await mgr.create({ id: "a2", type: "build" });
      await mgr.transition("a2", "running");
      await mgr.transition("a2", "done");
      expect(mgr.isActive("a2")).toBe(false);
    });

    it("returns false for unknown sessions", () => {
      expect(mgr.isActive("unknown")).toBe(false);
    });
  });
});
