import type { ActionLogEntry } from "@/components/ide/chat/chat-types";
import type { BuildPhase } from "@/components/ide/chat/BuildPhaseIndicator";
import type { ManagerMessage, ManagerPlan, FileNode } from "@/stores/ide-store";

// ─── Manager Stream ────────────────────────────────────────────────────────

export interface ManagerStreamState {
  thinkingText: string;
  narrationText: string;
  actionLog: ActionLogEntry[];
  preparingPlan: boolean;
  isReconnecting: boolean;
  sessionId: string | null;
}

export const INITIAL_MANAGER_STREAM_STATE: ManagerStreamState = {
  thinkingText: "",
  narrationText: "",
  actionLog: [],
  preparingPlan: false,
  isReconnecting: false,
  sessionId: null,
};

// ─── Build Stream ──────────────────────────────────────────────────────────

export interface BuildStreamState {
  thinkingText: string;
  narrationText: string;
  actionLog: ActionLogEntry[];
  buildPhase: BuildPhase;
  isReconnecting: boolean;
  thinkingElapsedSec: number | null;
  sessionId: string | null;
  stepNarrations: Record<number, string>;
  /** Per-session task statuses — survives project switching (unlike the global
   *  store's taskStatuses which is reset on loadProject). Source of truth for
   *  restoring plan-card step progress when returning to an active build. */
  taskStatuses: Record<string, TaskStatus>;
}

export const INITIAL_BUILD_STREAM_STATE: BuildStreamState = {
  thinkingText: "",
  narrationText: "",
  actionLog: [],
  buildPhase: null,
  isReconnecting: false,
  thinkingElapsedSec: null,
  sessionId: null,
  stepNarrations: {},
  taskStatuses: {},
};

// ─── Store Actions (injected into stream instances) ────────────────────────

export type TaskStatus = "pending" | "running" | "done" | "failed" | "needs-input" | "bug";
export type ChatMode = "manager" | "build";

export interface StreamingSnapshot {
  type: "manager" | "build";
  thinkingText: string;
  narrationText: string;
  sessionId: string;
  projectId: string;
  updatedAt: number;
  lastEventId: number;
}

export interface StoreActions {
  // Chat message operations
  addChatMessage: (msg: { role: "user" | "assistant" | "checkpoint"; content: string; buildResult?: { actionLog: ActionLogEntry[]; segments?: { id: string; narration: string; actions: ActionLogEntry[]; isLive: boolean; stepLabel?: string }[]; completionData?: { changedFiles: string[]; summary?: string } } }) => void;

  // Manager message operations
  addManagerMessage: (msg: Omit<ManagerMessage, "id" | "timestamp" | "seq">) => void;
  setManagerPlan: (plan: ManagerPlan | null) => void;
  clearManagerPlan: () => void;
  setManagerResponding: (v: boolean) => void;

  // Task status
  updateTaskStatus: (subTaskId: string, status: TaskStatus) => void;
  setTaskFailureReason: (subTaskId: string, reason: string) => void;
  freezeLatestPlanStatuses: (
    statuses?: Record<string, TaskStatus>,
    failureReasons?: Record<string, string>,
  ) => void;

  // Build state
  setAiResponding: (v: boolean) => void;
  setExecutingTaskIndex: (index: number | null) => void;
  setChatMode: (mode: ChatMode) => void;
  setFixCycle: (cycle: number) => void;
  setPendingConfirmation: (confirmation: { stepKey: string; items: string[] } | null) => void;
  setCompletionData: (data: { changedFiles: string[]; summary: string } | null) => void;

  // Streaming snapshot (for reconnect persistence)
  setStreamingSnapshot: (snapshot: StreamingSnapshot | null) => void;

  // File operations
  applyCodeBlock: (block: { filePath: string; code: string; language: string }) => Promise<void>;
  deleteFile: (path: string) => void;
  setLastBuildFileDiff: (filePath: string, oldContent: string, newContent: string) => void;
  clearLastBuildFileDiffs: () => void;
  refreshPreview: () => void;

  // Checkpoint
  createCheckpoint: (label: string, opts?: { includeManagerThread?: boolean }) => void;

  // Project rename
  renameProject: (id: string, name: string, fromUser?: boolean) => void;

  // Read-only accessors (not guarded — safe from any project context)
  getProjectId: () => string | null;
  getManagerMessages: () => ManagerMessage[];
  getManagerPlan: () => ManagerPlan | null;
  getFiles: () => FileNode[];
  getTaskStatuses: () => Record<string, TaskStatus>;
  getConsoleErrors: () => string[];
  getStreamingSnapshot: () => StreamingSnapshot | null;
  getMessagesReady: () => boolean;
}

// ─── Stream Slot ───────────────────────────────────────────────────────────

export interface ProjectStreamSlot {
  projectId: string;
  manager: {
    state: ManagerStreamState;
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => ManagerStreamState;
  };
  build: {
    state: BuildStreamState;
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => BuildStreamState;
  };
  dispose: () => void;
}
