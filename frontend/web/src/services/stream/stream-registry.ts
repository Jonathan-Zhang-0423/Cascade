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
 * Create StoreActions bound to a specific projectId.
 * Actions that write UI state are guarded (only execute when projectId is active).
 * Actions that persist data (messages, snapshots) always execute.
 */
function createStoreActions(projectId: string): StoreActions {
  const guard = () => useIDEStore.getState().projectId === projectId;
  const store = () => useIDEStore.getState();

  return {
    // Guarded — only write when this project is active
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
  manager: ManagerStreamInstance;
  build: BuildStreamInstance;
  dispose: () => void;
}

/**
 * Global registry of per-project stream instances.
 * Not tied to React lifecycle — streams survive component unmounts.
 */
class StreamServiceRegistry {
  private slots = new Map<string, FullProjectStreamSlot>();

  /**
   * Get or lazily create stream instances for the given project.
   */
  get(projectId: string): FullProjectStreamSlot {
    if (!projectId) {
      // Return a disposable empty slot — shouldn't happen in practice
      const actions = createStoreActions("");
      return {
        projectId: "",
        manager: new ManagerStreamInstance("", actions),
        build: new BuildStreamInstance("", actions),
        dispose: () => {},
      };
    }
    let slot = this.slots.get(projectId);
    if (!slot) {
      const actions = createStoreActions(projectId);
      const manager = new ManagerStreamInstance(projectId, actions);
      const build = new BuildStreamInstance(projectId, actions);
      slot = {
        projectId,
        manager,
        build,
        dispose: () => {
          manager.dispose();
          build.dispose();
        },
      };
      this.slots.set(projectId, slot);
    }
    return slot;
  }

  /**
   * Check if a slot exists without creating one.
   */
  has(projectId: string): boolean {
    return this.slots.has(projectId);
  }

  /**
   * Dispose and remove a project's stream slot.
   * Call when a project is closed/deleted.
   */
  dispose(projectId: string): void {
    const slot = this.slots.get(projectId);
    if (slot) {
      slot.dispose();
      this.slots.delete(projectId);
    }
  }

  /**
   * List all active project IDs with stream slots.
   */
  activeProjectIds(): string[] {
    return Array.from(this.slots.keys());
  }

  /**
   * Dispose all slots. For testing/cleanup.
   */
  disposeAll(): void {
    for (const slot of this.slots.values()) {
      slot.dispose();
    }
    this.slots.clear();
  }
}

export const streamRegistry = new StreamServiceRegistry();
