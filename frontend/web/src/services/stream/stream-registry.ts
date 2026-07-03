import { ManagerStreamInstance } from "./manager-stream-instance";
import { BuildStreamInstance } from "./build-stream-instance";
import {
  type StoreActions,
  type TaskStatus,
  type ManagerStreamState,
  type BuildStreamState,
  INITIAL_MANAGER_STREAM_STATE,
  INITIAL_BUILD_STREAM_STATE,
} from "./types";
import { useIDEStore, flattenFiles, type ManagerMessage } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";

/**
 * Create StoreActions bound to a specific project + session.
 * Guard: only write UI state when BOTH projectId AND currentSessionId match.
 * This prevents AI stream responses from bleeding across sessions.
 *
 * addManagerMessage / addChatMessage are special:
 *   - If guard passes → write to store (which also queues DB upload).
 *   - If guard fails  → write directly to DB so the message is persisted and
 *     visible when the user switches back to this session. Store is NOT touched,
 *     preventing cross-session UI bleed.
 */
function createStoreActions(projectId: string, sessionId: string | null): StoreActions {
  const guard = () => {
    const s = useIDEStore.getState();
    return s.idePageMounted && s.projectId === projectId && s.currentSessionId === sessionId;
  };
  const store = () => useIDEStore.getState();

  // Persist a message directly to the server when the session is in the background.
  const persistMsgToDB = (msg: { role: string; content: string; [k: string]: any }, kind: "chat" | "manager") => {
    const sid = sessionId ?? "main";
    const clientId = crypto.randomUUID();
    const seq = Date.now(); // use timestamp as fallback seq for background msgs
    const metadata: Record<string, unknown> = {};
    if (msg.plan) metadata.plan = msg.plan;
    if (msg.thinking) metadata.thinking = msg.thinking;
    if (msg.source) metadata.source = msg.source;
    if (msg.buildResult) metadata.buildResult = msg.buildResult;
    if (msg.frozenTaskStatuses) metadata.frozenTaskStatuses = msg.frozenTaskStatuses;
    if (msg.frozenTaskFailureReasons) metadata.frozenTaskFailureReasons = msg.frozenTaskFailureReasons;
    const body = JSON.stringify({
      messages: [{
        clientId,
        kind,
        role: msg.role,
        content: msg.content ?? "",
        seq,
        timestamp: Date.now(),
        sessionId: sid,
        metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
      }],
    });
    fetch(`/api/projects/${projectId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: body.length < 60_000,
    }).catch(() => {});
  };

  const freezeLatestPlanInDB = async (
    statuses?: Record<string, TaskStatus>,
    failureReasons?: Record<string, string>,
  ) => {
    const sid = sessionId ?? "main";
    try {
      const params = new URLSearchParams({ kind: "manager", limit: "100", sessionId: sid });
      const resp = await fetch(`/api/projects/${projectId}/messages?${params.toString()}`);
      if (!resp.ok) return;
      const data = await resp.json();
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      const target = [...messages].reverse().find((m: any) => {
        if (typeof m?.metadata !== "string" || !m.metadata) return false;
        try { return !!JSON.parse(m.metadata)?.plan; } catch { return false; }
      });
      if (!target) return;
      let metadata: Record<string, unknown> = {};
      if (typeof target.metadata === "string" && target.metadata) {
        try { metadata = JSON.parse(target.metadata); } catch { metadata = {}; }
      }
      metadata.frozenTaskStatuses = statuses ?? {};
      metadata.frozenTaskFailureReasons = failureReasons ?? {};
      const body = JSON.stringify({
        messages: [{
          clientId: target.clientId,
          kind: "manager",
          role: target.role,
          content: target.content ?? "",
          thinking: target.thinking ?? null,
          source: target.source ?? null,
          seq: target.seq,
          timestamp: Number(target.timestamp) || Date.now(),
          sessionId: sid,
          metadata: JSON.stringify(metadata),
        }],
      });
      fetch(`/api/projects/${projectId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: body.length < 60_000,
      }).catch(() => {});
    } catch {}
  };

  return {
    // addChatMessage / addManagerMessage: write store if active, else persist to DB
    addChatMessage: (msg) => {
      if (guard()) store().addChatMessage(msg as any);
      else persistMsgToDB(msg as any, "chat");
    },
    addManagerMessage: (msg) => {
      if (guard()) store().addManagerMessage(msg as any);
      else persistMsgToDB(msg as any, "manager");
    },
    setManagerPlan: (plan) => { if (guard()) store().setManagerPlan(plan); },
    clearManagerPlan: () => { if (guard()) store().clearManagerPlan(); },
    setManagerResponding: (v) => { store().setManagerResponding(v, sessionId ?? "main"); },
    updateTaskStatus: (id, s) => { if (guard()) store().updateTaskStatus(id, s); },
    setTaskFailureReason: (id, reason) => { if (guard()) store().setTaskFailureReason(id, reason); },
    freezeLatestPlanStatuses: (statuses, failureReasons) => {
      if (guard()) store().freezeLatestPlanStatuses(statuses, failureReasons);
      else freezeLatestPlanInDB(statuses, failureReasons);
    },
    setAiResponding: (v) => { if (guard()) store().setAiResponding(v); },
    setExecutingTaskIndex: (idx) => { if (guard()) store().setExecutingTaskIndex(idx); },
    setChatMode: (mode) => { if (guard()) store().setChatMode(mode); },
    setFixCycle: (cycle) => { if (guard()) store().setFixCycle(cycle); },
    setPendingConfirmation: (c) => { if (guard()) store().setPendingConfirmation(c); },
    setCompletionData: (data) => { if (guard()) store().setCompletionData(data); },
    setStreamingSnapshot: (snap) => { store().setStreamingSnapshot(snap as any); },
    applyCodeBlock: async (block) => {
      if (!guard()) return;
      const s = store();
      const currentFiles = flattenFiles(s.files);
      const exists = currentFiles.some((f) => f.path === block.filePath);
      if (exists) {
        s.updateFileContent(block.filePath, block.code);
      } else {
        const lastSlash = block.filePath.lastIndexOf("/");
        if (lastSlash > 0) {
          const parentPath = block.filePath.substring(0, lastSlash);
          const fileName = block.filePath.substring(lastSlash + 1);
          s.addFile(parentPath, fileName, "file");
          await new Promise((r) => setTimeout(r, 80));
          useIDEStore.getState().updateFileContent(block.filePath, block.code);
        }
      }
    },
    setLastBuildFileDiff: (path, old, next) => { if (guard()) store().setLastBuildFileDiff(path, old, next); },
    deleteFile: (path: string) => { if (guard()) store().deleteFile(path); },
    clearLastBuildFileDiffs: () => { if (guard()) store().clearLastBuildFileDiffs(); },
    refreshPreview: () => { if (guard()) store().refreshPreview(); },
    createCheckpoint: (label, opts) => { if (guard()) store().createCheckpoint(label, opts); },
    renameProject: (id, name, fromUser) => { useProjectStore.getState().renameProject(id, name, fromUser); },

    // Read-only — always safe
    getProjectId: () => store().projectId,
    getManagerMessages: () => store().managerMessages,
    getManagerPlan: () => store().managerPlan,
    getFiles: () => flattenFiles(store().files),
    getTaskStatuses: () => store().taskStatuses,
    getConsoleErrors: () => {
      const entries = store().consoleEntries || [];
      return entries
        .filter((e: any) => e.level === "error" || e.level === "warn")
        .slice(-20) // last 20 errors/warnings
        .map((e: any) => e.message || e.text || String(e))
        .filter(Boolean);
    },
    getStreamingSnapshot: () => store().streamingSnapshot as any,
    getMessagesReady: () => store().messagesReady,
  };
}

export interface FullProjectStreamSlot {
  projectId: string;
  sessionId: string | null;
  manager: ManagerStreamInstance;
  build: BuildStreamInstance;
  dispose: () => void;
}

/** Composite key: "projectId:sessionId" where null sessionId = "__main__" */
function slotKey(projectId: string, sessionId: string | null): string {
  return `${projectId}:${sessionId ?? "__main__"}`;
}

class StreamServiceRegistry {
  private slots = new Map<string, FullProjectStreamSlot>();

  get(projectId: string, sessionId: string | null = null): FullProjectStreamSlot {
    if (!projectId) {
      const actions = createStoreActions("", null);
      return {
        projectId: "",
        sessionId: null,
        manager: new ManagerStreamInstance("", actions, "main"),
        build: new BuildStreamInstance("", actions, "main"),
        dispose: () => {},
      };
    }
    const key = slotKey(projectId, sessionId);
    let slot = this.slots.get(key);
    if (!slot) {
      const actions = createStoreActions(projectId, sessionId);
      const chatSid = sessionId ?? "main";
      const manager = new ManagerStreamInstance(projectId, actions, chatSid);
      const build = new BuildStreamInstance(projectId, actions, chatSid);
      slot = {
        projectId,
        sessionId,
        manager,
        build,
        dispose: () => {
          manager.dispose();
          build.dispose();
        },
      };
      this.slots.set(key, slot);
    }
    return slot;
  }

  has(projectId: string, sessionId: string | null = null): boolean {
    return this.slots.has(slotKey(projectId, sessionId));
  }

  dispose(projectId: string, sessionId: string | null = null): void {
    const key = slotKey(projectId, sessionId);
    const slot = this.slots.get(key);
    if (slot) {
      slot.dispose();
      this.slots.delete(key);
    }
  }

  disposeProject(projectId: string): void {
    const prefix = `${projectId}:`;
    for (const [key, slot] of this.slots) {
      if (key.startsWith(prefix)) {
        slot.dispose();
        this.slots.delete(key);
      }
    }
  }

  activeProjectIds(): string[] {
    const ids = new Set<string>();
    for (const slot of this.slots.values()) ids.add(slot.projectId);
    return Array.from(ids);
  }

  disposeAll(): void {
    for (const slot of this.slots.values()) slot.dispose();
    this.slots.clear();
  }
}

export const streamRegistry = new StreamServiceRegistry();
export type { ManagerStreamState, BuildStreamState };
