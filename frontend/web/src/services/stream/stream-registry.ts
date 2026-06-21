import { ManagerStreamInstance } from "./manager-stream-instance";
import { BuildStreamInstance } from "./build-stream-instance";
import {
  type StoreActions,
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
 */
function createStoreActions(projectId: string, sessionId: string | null): StoreActions {
  const guard = () => {
    const s = useIDEStore.getState();
    return s.projectId === projectId && s.currentSessionId === sessionId;
  };
  const store = () => useIDEStore.getState();

  return {
    // Guarded — only write when this project+session is active
    addChatMessage: (msg) => { if (guard()) store().addChatMessage(msg as any); },
    addManagerMessage: (msg) => { if (guard()) store().addManagerMessage(msg as any); },
    setManagerPlan: (plan) => { if (guard()) store().setManagerPlan(plan); },
    clearManagerPlan: () => { if (guard()) store().clearManagerPlan(); },
    setManagerResponding: (v) => { if (guard()) store().setManagerResponding(v); },
    updateTaskStatus: (id, s) => { if (guard()) store().updateTaskStatus(id, s); },
    setTaskFailureReason: (id, reason) => { if (guard()) store().setTaskFailureReason(id, reason); },
    freezeLatestPlanStatuses: () => { if (guard()) store().freezeLatestPlanStatuses(); },
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
