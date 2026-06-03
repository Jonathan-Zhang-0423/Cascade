import { ObservableState } from "./observable-state";
import {
  type ProjectStreamSlot,
  type ManagerStreamState,
  type BuildStreamState,
  INITIAL_MANAGER_STREAM_STATE,
  INITIAL_BUILD_STREAM_STATE,
} from "./types";

function createSlot(projectId: string): ProjectStreamSlot {
  const managerState = new ObservableState<ManagerStreamState>({
    ...INITIAL_MANAGER_STREAM_STATE,
  });
  const buildState = new ObservableState<BuildStreamState>({
    ...INITIAL_BUILD_STREAM_STATE,
  });

  return {
    projectId,
    manager: {
      get state() { return managerState.get(); },
      subscribe: managerState.subscribe,
      getSnapshot: managerState.getSnapshot,
    },
    build: {
      get state() { return buildState.get(); },
      subscribe: buildState.subscribe,
      getSnapshot: buildState.getSnapshot,
    },
    dispose() {
      // Future: abort SSE connections, clear timers, etc.
      managerState.reset({ ...INITIAL_MANAGER_STREAM_STATE });
      buildState.reset({ ...INITIAL_BUILD_STREAM_STATE });
    },
  };
}

/**
 * Global registry of per-project stream slots.
 * Not tied to React lifecycle — streams survive component unmounts.
 */
class StreamServiceRegistry {
  private slots = new Map<string, ProjectStreamSlot>();

  /**
   * Get or lazily create a stream slot for the given project.
   */
  get(projectId: string): ProjectStreamSlot {
    if (!projectId) {
      return createSlot("");
    }
    let slot = this.slots.get(projectId);
    if (!slot) {
      slot = createSlot(projectId);
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
