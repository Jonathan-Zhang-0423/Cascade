import { create } from "zustand";
import { getMainEntryFile } from "@/lib/preview-adapters";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  content?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "checkpoint";
  content: string;
  timestamp: number;
  seq: number;
  checkpointId?: string;
  hidden?: boolean;
}

export interface ConsoleEntry {
  id: string;
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: number;
}

export type ToolPanel = "files" | "chat" | "history" | "skills" | null;
export type ChatMode = "build" | "manager";
export type AIProvider = "doubao" | "kimi" | "minimax" | "glm" | "deepseek-pro" | "deepseek-flash";

export interface ManagerSubTask {
  step: number;
  sub_task_id?: string;
  title: string;
  description: string;
  acceptance_criteria?: string;
  required_files?: string[];
}

export interface ManagerPlan {
  summary: string;
  steps: ManagerSubTask[];
  needs_input: string[];
  overview?: string;
  what_and_why?: string;
  done_looks_like?: string;
  out_of_scope?: string;
  relevant_files?: string[];
  narrated_what_and_why?: string;
  narrated_done_looks_like?: string;
  narrated_out_of_scope?: string;
  /** "direct": plan was synthesized for a direct build (no verifier, slim UI). Default is plan-mode. */
  mode?: "plan" | "direct";
}

export interface VerificationItem {
  item: string;
  result: "pass" | "fail" | "warning";
  details: string;
}

export interface VerificationResult {
  sub_task_id: string;
  verification_items: VerificationItem[];
  requirement_match_percent: number;
  error_summary: string;
  user_confirmation_needed: string[];
  suggestion: string;
}

export interface HolisticReviewBug {
  id: string;
  severity: "critical" | "major" | "minor";
  file: string;
  description: string;
  expected: string;
  actual: string;
}

export interface HolisticReviewResult {
  overall_status: "pass" | "fail";
  requirement_match_percent: number;
  bugs: HolisticReviewBug[];
  missing_features: Array<{ id: string; description: string; related_step: number }>;
  regressions: Array<{ id: string; file: string; description: string }>;
  user_confirmation_needed: string[];
  summary: string;
  suggestion: string;
}

export type ReviewPhase = "idle" | "building" | "reviewing" | "review_passed" | "review_failed" | "fixing" | "review_skipped";

export interface BuildResultData {
  actionLog: { type: string; label: string; detail: string; timestamp: number; filePath?: string }[];
  completionData: { changedFiles: string[]; userLang?: string; summary?: string };
  nextStepSuggestion?: string;
  sessionId?: string;
}

export interface ManagerMessage {
  id: string;
  role: "user" | "assistant" | "checkpoint";
  content: string;
  plan?: ManagerPlan;
  timestamp: number;
  seq: number;
  source?: "communicator" | "manager_raw" | "manager";
  typing?: boolean;
  hidden?: boolean;
  checkpointId?: string;
  thinking?: string;
  preparingPlan?: boolean;
  buildResult?: BuildResultData;
  errorCode?: "connect" | "build_interrupted" | "build_generic";
}

interface FlatFile {
  path: string;
  content: string;
}

interface FileDiff {
  path: string;
  action: "add" | "modify" | "delete";
  content?: string;
}

export interface Checkpoint {
  id: string;
  label: string;
  timestamp: number;
  snapshot?: FlatFile[];
  diff?: FileDiff[];
}

export interface StreamingSnapshot {
  type: "manager" | "build";
  thinkingText: string;
  narrationText: string;
  sessionId?: string;
  projectId: string;
  updatedAt: number;
  lastEventId?: number;
}

function flattenToFlatFiles(files: FileNode[]): FlatFile[] {
  const result: FlatFile[] = [];
  for (const file of files) {
    if (file.type === "file") {
      result.push({ path: file.path, content: file.content || "" });
    }
    if (file.children) {
      result.push(...flattenToFlatFiles(file.children));
    }
  }
  return result;
}

function computeReverseDiff(olderFiles: FlatFile[], newerFiles: FlatFile[]): FileDiff[] {
  const diffs: FileDiff[] = [];
  const olderMap = new Map(olderFiles.map((f) => [f.path, f.content]));
  const newerMap = new Map(newerFiles.map((f) => [f.path, f.content]));

  olderMap.forEach((content, path) => {
    if (!newerMap.has(path)) {
      diffs.push({ path, action: "add", content });
    } else if (newerMap.get(path) !== content) {
      diffs.push({ path, action: "modify", content });
    }
  });

  newerMap.forEach((_content, path) => {
    if (!olderMap.has(path)) {
      diffs.push({ path, action: "delete" });
    }
  });

  return diffs;
}

function applyReverseDiff(files: FlatFile[], diff: FileDiff[]): FlatFile[] {
  const fileMap = new Map(files.map((f) => [f.path, f.content]));

  for (const d of diff) {
    if (d.action === "add") {
      fileMap.set(d.path, d.content || "");
    } else if (d.action === "modify") {
      fileMap.set(d.path, d.content || "");
    } else if (d.action === "delete") {
      fileMap.delete(d.path);
    }
  }

  return Array.from(fileMap.entries()).map(([path, content]) => ({ path, content }));
}

function rebuildFileTree(flatFiles: FlatFile[]): FileNode[] {
  const root: FileNode[] = [];

  for (const { path, content } of flatFiles) {
    const segments = path.split("/").filter(Boolean);
    let currentLevel = root;
    let builtPath = "";

    for (let i = 0; i < segments.length; i++) {
      builtPath = builtPath ? `${builtPath}/${segments[i]}` : `/${segments[i]}`;
      const isFile = i === segments.length - 1;

      let existing = currentLevel.find((n) => n.path === builtPath);
      if (!existing) {
        if (isFile) {
          existing = { name: segments[i], path: builtPath, type: "file", content };
          currentLevel.push(existing);
        } else {
          existing = { name: segments[i], path: builtPath, type: "folder", children: [] };
          currentLevel.push(existing);
        }
      }
      if (!isFile) {
        if (!existing.children) existing.children = [];
        currentLevel = existing.children;
      }
    }
  }

  return root;
}

function reconstructCheckpointFiles(checkpoints: Checkpoint[], targetId: string): FlatFile[] | null {
  const lastIdx = checkpoints.length - 1;
  if (lastIdx < 0) return null;

  const last = checkpoints[lastIdx];
  if (!last.snapshot) return null;

  if (last.id === targetId) return [...last.snapshot];

  let current = [...last.snapshot];

  for (let i = lastIdx - 1; i >= 0; i--) {
    const cp = checkpoints[i];
    if (cp.diff) {
      current = applyReverseDiff(current, cp.diff);
    } else if (cp.snapshot) {
      current = [...cp.snapshot];
    }
    if (cp.id === targetId) return current;
  }

  return null;
}

interface IDEState {
  projectId: string | null;
  projectFramework: string;
  files: FileNode[];
  activeFile: string | null;
  openFiles: string[];
  chatMessages: ChatMessage[];
  consoleEntries: ConsoleEntry[];
  activeTool: ToolPanel;
  isConsoleOpen: boolean;
  isSidebarOpen: boolean;
  isChatOpen: boolean;
  isAiResponding: boolean;
  theme: string;
  previewFile: string;
  previewRefreshKey: number;
  previewOverrideHtml: string | null;
  pendingPrompt: string | null;
  pendingPromptMode: ChatMode | null;
  checkpoints: Checkpoint[];
  lastBuildFileDiffs: Record<string, { old: string; new: string }>;
  setLastBuildFileDiff: (filePath: string, old: string, newContent: string) => void;
  clearLastBuildFileDiffs: () => void;

  layoutMode: "preview" | "code";
  setLayoutMode: (mode: "preview" | "code") => void;
  codeVisible: boolean;
  toggleCodeVisible: () => void;

  chatMode: ChatMode;
  reviewEnabled: boolean;
  managerPlan: ManagerPlan | null;
  managerMessages: ManagerMessage[];
  _nextSeq: number;
  streamingSnapshot: StreamingSnapshot | null;
  executingTaskIndex: number | null;
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "needs-input" | "bug">;
  taskFailureReasons: Record<string, string>;
  isManagerResponding: boolean;
  verificationResults: Record<string, VerificationResult>;
  pendingConfirmation: { stepKey: string; items: string[] } | null;
  userConfirmationInput: string;
  reviewPhase: ReviewPhase;
  holisticReview: HolisticReviewResult | null;
  fixCycle: number;
  completionData: { changedFiles: string[]; summary: string } | null;

  isLLMMonitorOpen: boolean;
  setLLMMonitorOpen: (v: boolean) => void;
  toggleLLMMonitor: () => void;

  selectedProvider: AIProvider;
  setSelectedProvider: (provider: AIProvider) => void;

  selectedDevice: string;
  deviceOrientation: "portrait" | "landscape";
  devicePlatform: "ios" | "android";
  deviceFrameStyle: "light" | "dark";
  customDeviceWidth: number;
  customDeviceHeight: number;
  setSelectedDevice: (device: string) => void;
  setDeviceOrientation: (orientation: "portrait" | "landscape") => void;
  setDevicePlatform: (platform: "ios" | "android") => void;
  setDeviceFrameStyle: (style: "light" | "dark") => void;
  setCustomDeviceDimensions: (width: number, height: number) => void;

  loadProject: (id: string, framework?: string) => void;
  saveProject: () => void;
  setPendingPrompt: (prompt: string, mode?: ChatMode) => void;
  clearPendingPrompt: () => void;
  setStreamingSnapshot: (snapshot: StreamingSnapshot | null) => void;
  setActiveFile: (path: string) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  addChatMessage: (message: Omit<ChatMessage, "id" | "timestamp" | "seq">) => void;
  updateLastAssistantMessage: (content: string) => void;
  addConsoleEntry: (entry: Omit<ConsoleEntry, "id" | "timestamp">) => void;
  clearConsole: () => void;
  setActiveTool: (tool: ToolPanel) => void;
  setAiResponding: (v: boolean) => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  toggleConsole: () => void;
  addFile: (parentPath: string, name: string, type: "file" | "folder") => void;
  renameFile: (oldPath: string, newName: string) => void;
  deleteFile: (path: string) => void;
  setPreviewFile: (path: string) => void;
  setPreviewOverrideHtml: (html: string | null) => void;
  refreshPreview: () => void;
  createCheckpoint: (label: string, options?: { includeManagerThread?: boolean }) => void;
  restoreCheckpoint: (id: string) => void;

  setChatMode: (mode: ChatMode) => void;
  setReviewEnabled: (v: boolean) => void;
  setManagerPlan: (plan: ManagerPlan | null) => void;
  addManagerMessage: (message: Omit<ManagerMessage, "id" | "timestamp" | "seq">) => void;
  updateTaskStatus: (subTaskId: string, status: "pending" | "running" | "done" | "failed" | "needs-input" | "bug") => void;
  setTaskFailureReason: (subTaskId: string, reason: string) => void;
  setExecutingTaskIndex: (index: number | null) => void;
  setManagerResponding: (v: boolean) => void;
  clearManagerPlan: () => void;
  updateVerificationResult: (subTaskId: string, result: VerificationResult) => void;
  setPendingConfirmation: (confirmation: { stepKey: string; items: string[] } | null) => void;
  setUserConfirmationInput: (input: string) => void;
  setReviewPhase: (phase: ReviewPhase) => void;
  setHolisticReview: (review: HolisticReviewResult | null) => void;
  setFixCycle: (cycle: number) => void;
  setCompletionData: (data: { changedFiles: string[]; summary: string } | null) => void;

  updateManagerMessageThinking: (index: number, thinking: string) => void;

  userId: string | null;
  setUserId: (id: string | null) => void;
  username: string | null;
  setUsername: (name: string | null) => void;
}

const defaultFiles: FileNode[] = [
  {
    name: "project",
    path: "/project",
    type: "folder",
    children: [
      {
        name: "index.html",
        path: "/project/index.html",
        type: "file",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <script src="app.js"></script>
</body>
</html>`,
      },
      {
        name: "style.css",
        path: "/project/style.css",
        type: "file",
        content: "",
      },
      {
        name: "app.js",
        path: "/project/app.js",
        type: "file",
        content: "",
      },
      {
        name: "cascade.md",
        path: "/project/cascade.md",
        type: "file",
        content: `# cascade.md

## Overview

_Generated after planning is complete._

## User Preferences

_Populated after the first plan is created._

## System Architecture

_Populated after the first plan is created._

## External Dependencies

_Populated after the first plan is created._
`,
      },
    ],
  },
];

function flattenFilesForHash(files: FileNode[]): string {
  const parts: string[] = [];
  const collect = (nodes: FileNode[]) => {
    for (const f of nodes) {
      if (f.type === "file" && f.content) {
        parts.push(f.path + ":" + f.content);
      }
      if (f.children) collect(f.children);
    }
  };
  collect(files);
  parts.sort();
  return parts.join("\n");
}

export function computeFilesHash(files: FileNode[]): string {
  const str = flattenFilesForHash(files);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash.toString(36);
}

function getPersistedState(projectId: string) {
  try {
    const data = localStorage.getItem(`cascade-project-${projectId}`);
    if (data) return JSON.parse(data);
  } catch {}
  return null;
}

const MAX_PERSISTED_CHAT_MESSAGES = 200;
const MAX_PERSISTED_MANAGER_MESSAGES = 200;

function persistState(state: IDEState) {
  if (!state.projectId) return;
  const toSave = {
    files: state.files,
    openFiles: state.openFiles,
    activeFile: state.activeFile,
    previewFile: state.previewFile,
    chatMessages: state.chatMessages.length > MAX_PERSISTED_CHAT_MESSAGES
      ? state.chatMessages.slice(-MAX_PERSISTED_CHAT_MESSAGES)
      : state.chatMessages,
    theme: state.theme,
    pendingPrompt: state.pendingPrompt,
    pendingPromptMode: state.pendingPromptMode,
    chatMode: state.chatMode,
    reviewEnabled: state.reviewEnabled,
    _nextSeq: state._nextSeq,
    managerMessages: state.managerMessages.length > MAX_PERSISTED_MANAGER_MESSAGES
      ? state.managerMessages.slice(-MAX_PERSISTED_MANAGER_MESSAGES)
      : state.managerMessages,
    streamingSnapshot: state.streamingSnapshot,
    managerPlan: state.managerPlan,
    selectedDevice: state.selectedDevice,
    deviceOrientation: state.deviceOrientation,
    devicePlatform: state.devicePlatform,
    deviceFrameStyle: state.deviceFrameStyle,
    customDeviceWidth: state.customDeviceWidth,
    customDeviceHeight: state.customDeviceHeight,
    layoutMode: state.layoutMode,
    codeVisible: state.codeVisible,
  };
  localStorage.setItem(
    `cascade-project-${state.projectId}`,
    JSON.stringify(toSave)
  );
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPersist(state: IDEState) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistState(state);
    persistTimer = null;
  }, 500);
}

let serverSyncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingServerSync: { projectId: string; files: { path: string; content: string }[] } | null = null;

function syncFilesToServer(projectId: string, files: FileNode[]) {
  const flat = flattenToFlatFiles(files);

  if (serverSyncTimer) clearTimeout(serverSyncTimer);
  pendingServerSync = { projectId, files: flat };

  serverSyncTimer = setTimeout(() => {
    if (!pendingServerSync) return;
    const { projectId: pid, files: flatFiles } = pendingServerSync;
    pendingServerSync = null;
    serverSyncTimer = null;

    fetch(`/api/projects/${pid}/files`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: flatFiles }),
    }).catch(() => {});
  }, 1000);
}

async function fetchFilesFromServer(projectId: string): Promise<{ path: string; content: string }[] | null> {
  try {
    const resp = await fetch(`/api/projects/${projectId}/files`);
    if (!resp.ok) return null;
    const data = await resp.json();
    const files: { path: string; content: string }[] = data.files || [];
    if (files.length === 0) return null;
    return files;
  } catch {
    return null;
  }
}

function loadCheckpoints(projectId: string): Checkpoint[] {
  try {
    const data = localStorage.getItem(`cascade-checkpoints-${projectId}`);
    if (data) {
      const parsed: Checkpoint[] = JSON.parse(data);
      if (parsed.length > 0 && !parsed[parsed.length - 1].snapshot) {
        return [];
      }
      return parsed;
    }
  } catch {}
  return [];
}

function persistCheckpoints(projectId: string, checkpoints: Checkpoint[]) {
  try {
    localStorage.setItem(
      `cascade-checkpoints-${projectId}`,
      JSON.stringify(checkpoints)
    );
  } catch (e: any) {
    if (e?.name === "QuotaExceededError" && checkpoints.length > 1) {
      const reconstructed = reconstructCheckpointFiles(checkpoints, checkpoints[1].id);
      const trimmed = checkpoints.slice(1);
      if (trimmed.length > 0 && reconstructed) {
        trimmed[0] = { ...trimmed[0], snapshot: reconstructed, diff: undefined };
      }
      persistCheckpoints(projectId, trimmed);
    }
  }
}

export const useIDEStore = create<IDEState>((set, get) => ({
  projectId: null,
  projectFramework: "web",
  files: defaultFiles,
  activeFile: "/project/index.html",
  openFiles: ["/project/index.html"],
  chatMessages: [
    {
      id: "welcome",
      role: "assistant",
      content:
        "你好！我是你的 AI 编程助手。告诉我你想构建什么，我会帮你分析需求、编写代码并实现功能。",
      timestamp: Date.now(),
      seq: 0,
    },
  ],
  consoleEntries: [],
  activeTool: "files" as ToolPanel,
  isConsoleOpen: false,
  isSidebarOpen: true,
  isChatOpen: false,
  isAiResponding: false,
  theme: "vs-dark",
  previewFile: "/project/index.html",
  previewRefreshKey: 0,
  previewOverrideHtml: null,
  pendingPrompt: null,
  pendingPromptMode: null,
  checkpoints: [],
  lastBuildFileDiffs: {},
  setLastBuildFileDiff: (filePath, old, newContent) =>
    set((s) => ({ lastBuildFileDiffs: { ...s.lastBuildFileDiffs, [filePath]: { old, new: newContent } } })),
  clearLastBuildFileDiffs: () => set({ lastBuildFileDiffs: {} }),

  layoutMode: "code",
  setLayoutMode: (mode) => { set({ layoutMode: mode }); debouncedPersist(get()); },
  codeVisible: false,
  toggleCodeVisible: () => { set((s) => ({ codeVisible: !s.codeVisible })); debouncedPersist(get()); },

  chatMode: "build",
  reviewEnabled: false,
  managerPlan: null,
  managerMessages: [],
  _nextSeq: 1,
  streamingSnapshot: null,
  executingTaskIndex: null,
  taskStatuses: {},
  taskFailureReasons: {},
  isManagerResponding: false,
  verificationResults: {},
  pendingConfirmation: null,
  userConfirmationInput: "",
  reviewPhase: "idle",
  holisticReview: null,
  fixCycle: 0,
  completionData: null,

  isLLMMonitorOpen: false,
  setLLMMonitorOpen: (v) => set({ isLLMMonitorOpen: v }),
  toggleLLMMonitor: () => set((s) => ({ isLLMMonitorOpen: !s.isLLMMonitorOpen })),

  userId: (() => {
    try {
      const stored = localStorage.getItem("cascade-auth");
      return stored ? JSON.parse(stored).userId : null;
    } catch { return null; }
  })(),
  setUserId: (id) => {
    set({ userId: id });
    if (id) {
      const stored = localStorage.getItem("cascade-auth");
      const parsed = stored ? JSON.parse(stored) : {};
      localStorage.setItem("cascade-auth", JSON.stringify({ ...parsed, userId: id }));
    } else {
      localStorage.removeItem("cascade-auth");
    }
  },

  username: (() => {
    try {
      const stored = localStorage.getItem("cascade-auth");
      return stored ? JSON.parse(stored).username ?? null : null;
    } catch { return null; }
  })(),
  setUsername: (name) => {
    set({ username: name });
    try {
      const stored = localStorage.getItem("cascade-auth");
      const parsed = stored ? JSON.parse(stored) : {};
      if (name) {
        localStorage.setItem("cascade-auth", JSON.stringify({ ...parsed, username: name }));
      } else {
        const { username: _, ...rest } = parsed;
        localStorage.setItem("cascade-auth", JSON.stringify(rest));
      }
    } catch {}
  },


  selectedDevice: "iphone-16-pro",
  deviceOrientation: "portrait" as const,
  devicePlatform: "ios" as const,
  deviceFrameStyle: "dark" as const,
  customDeviceWidth: 390,
  customDeviceHeight: 844,

  selectedProvider: (() => {
    try {
      const saved = localStorage.getItem("cascade-selected-provider");
      // Migrate old "deepseek" value (pre-pro/flash split) to deepseek-pro.
      if (saved === "deepseek") return "deepseek-pro";
      if (saved === "doubao" || saved === "kimi" || saved === "minimax" || saved === "glm" || saved === "deepseek-pro" || saved === "deepseek-flash") return saved;
    } catch {}
    return "glm";
  })(),
  setSelectedProvider: (provider) => {
    try { localStorage.setItem("cascade-selected-provider", provider); } catch {}
    set({ selectedProvider: provider });
  },

  setSelectedDevice: (device) => {
    set({ selectedDevice: device });
    debouncedPersist(get());
  },

  setDeviceOrientation: (orientation) => {
    set({ deviceOrientation: orientation });
    debouncedPersist(get());
  },

  setDevicePlatform: (platform) => {
    set({ devicePlatform: platform });
    debouncedPersist(get());
  },

  setDeviceFrameStyle: (style) => {
    set({ deviceFrameStyle: style });
    debouncedPersist(get());
  },

  setCustomDeviceDimensions: (width, height) => {
    set({ customDeviceWidth: width, customDeviceHeight: height });
    debouncedPersist(get());
  },

  loadProject: (id, framework) => {
    const current = get();
    if (current.projectId) {
      persistState(current);
    }

    const saved = getPersistedState(id);
    const savedCheckpoints = loadCheckpoints(id);
    const defaultChat = [
      {
        id: "welcome",
        role: "assistant" as const,
        content:
          "你好！我是你的 AI 编程助手。告诉我你想构建什么，我会帮你分析需求、编写代码并实现功能。",
        seq: 1,
        timestamp: Date.now(),
      },
    ];

    const isNonWeb = framework && framework !== "web";

    // Backfill seq on old persisted messages that lack it.
    // Sort by timestamp, assign monotonically from seqStart upward.
    const backfillSeq = <T extends { seq?: number; timestamp: number }>(msgs: T[], seqStart: number): { msgs: T[]; nextSeq: number } => {
      const needsSeq = msgs.filter((m) => typeof m.seq !== "number");
      if (needsSeq.length === 0) return { msgs, nextSeq: seqStart };
      let counter = seqStart;
      // Assign in timestamp order so older messages get lower seqs
      const sorted = [...msgs].sort((a, b) => a.timestamp - b.timestamp);
      const seqMap = new Map<string, number>();
      for (const m of sorted) {
        if (typeof (m as any).seq !== "number") {
          seqMap.set((m as any).id, counter++);
        }
      }
      return {
        msgs: msgs.map((m) => typeof (m as any).seq === "number" ? m : { ...m, seq: seqMap.get((m as any).id) ?? counter++ }),
        nextSeq: counter,
      };
    };

    let chatMsgsWithSeq: ChatMessage[] = defaultChat;
    let mgrMsgsWithSeq: ManagerMessage[] = [];
    let finalNextSeq = 2;

    if (saved) {
      const rawChatMsgs: ChatMessage[] = saved.chatMessages || defaultChat;
      const rawMgrMsgs: ManagerMessage[] = saved.managerMessages || [];
      const computedNextSeq = (() => {
        if (typeof saved._nextSeq === "number" && saved._nextSeq > 1) return saved._nextSeq;
        const allMsgs = [...rawChatMsgs, ...rawMgrMsgs];
        const maxSeq = allMsgs.reduce((m: number, msg: any) => Math.max(m, typeof msg.seq === "number" ? msg.seq : 0), 0);
        return maxSeq + 1;
      })();
      const backfilledChat = backfillSeq(rawChatMsgs, computedNextSeq);
      chatMsgsWithSeq = backfilledChat.msgs;
      const backfilledMgr = backfillSeq(rawMgrMsgs, backfilledChat.nextSeq);
      mgrMsgsWithSeq = backfilledMgr.msgs;
      finalNextSeq = backfilledMgr.nextSeq;
    }

    const baseState = saved ? {
      projectId: id,
      projectFramework: framework || "web",
      files: saved.files || (isNonWeb ? [] : defaultFiles),
      openFiles: saved.openFiles || ["/project/index.html"],
      activeFile: saved.activeFile || "/project/index.html",
      previewFile: saved.previewFile || "/project/index.html",
      chatMessages: chatMsgsWithSeq,
      pendingPrompt: saved.pendingPrompt || null,
      pendingPromptMode: (saved.pendingPromptMode === "manager" || saved.pendingPromptMode === "build") ? saved.pendingPromptMode : null,
      checkpoints: savedCheckpoints,
      consoleEntries: [],
      isAiResponding: false,
      previewRefreshKey: Date.now(),
      activeTool: "chat" as ToolPanel,
      isChatOpen: true,
      isSidebarOpen: false,
      chatMode: (saved.chatMode === "manager" ? "manager" : "build") as ChatMode,
      reviewEnabled: !!saved.reviewEnabled,
      managerMessages: mgrMsgsWithSeq,
      _nextSeq: finalNextSeq,
      streamingSnapshot: saved.streamingSnapshot || null,
      managerPlan: (saved.managerMessages || []).slice().reverse().find((m: ManagerMessage) => m.plan)?.plan || saved.managerPlan || null,
      executingTaskIndex: null,
      taskStatuses: {},
      taskFailureReasons: {},
      isManagerResponding: false,
      verificationResults: {},
      pendingConfirmation: null,
      userConfirmationInput: "",
      reviewPhase: "idle" as ReviewPhase,
      holisticReview: null,
      fixCycle: 0,
      selectedDevice: saved.selectedDevice || "iphone-16-pro",
      deviceOrientation: (saved.deviceOrientation || "portrait") as "portrait" | "landscape",
      devicePlatform: (saved.devicePlatform || "ios") as "ios" | "android",
      deviceFrameStyle: (saved.deviceFrameStyle || "dark") as "light" | "dark",
      customDeviceWidth: saved.customDeviceWidth || 390,
      customDeviceHeight: saved.customDeviceHeight || 844,
      layoutMode: (saved.layoutMode || "code") as "preview" | "code",
      codeVisible: saved.codeVisible !== undefined ? saved.codeVisible : true,
    } : {
      projectId: id,
      projectFramework: framework || "web",
      files: defaultFiles,
      openFiles: ["/project/index.html"],
      activeFile: "/project/index.html",
      previewFile: "/project/index.html",
      chatMessages: defaultChat,
      pendingPrompt: null,
      pendingPromptMode: null,
      checkpoints: [],
      consoleEntries: [],
      isAiResponding: false,
      previewRefreshKey: Date.now(),
      activeTool: "chat" as ToolPanel,
      isChatOpen: true,
      isSidebarOpen: false,
      chatMode: "build" as ChatMode,
      reviewEnabled: false,
      managerMessages: [],
      _nextSeq: 2,
      streamingSnapshot: null,
      managerPlan: null,
      executingTaskIndex: null,
      taskStatuses: {},
      taskFailureReasons: {},
      isManagerResponding: false,
      verificationResults: {},
      pendingConfirmation: null,
      userConfirmationInput: "",
      reviewPhase: "idle" as ReviewPhase,
      holisticReview: null,
      fixCycle: 0,
      selectedDevice: "iphone-16-pro",
      deviceOrientation: "portrait" as "portrait" | "landscape",
      devicePlatform: "ios" as "ios" | "android",
      deviceFrameStyle: "dark" as "light" | "dark",
      customDeviceWidth: 390,
      customDeviceHeight: 844,
      layoutMode: "code" as "preview" | "code",
      codeVisible: false,
    };

    set(baseState);

    const fetchWithRetry = async (retries = 0): Promise<{ path: string; content: string }[] | null> => {
      const result = await fetchFilesFromServer(id);
      if ((!result || result.length === 0) && framework && framework !== "web" && retries < 3) {
        await new Promise((r) => setTimeout(r, 500 * (retries + 1)));
        return fetchWithRetry(retries + 1);
      }
      return result;
    };

    fetchWithRetry().then((serverFiles) => {
      if (!serverFiles || serverFiles.length === 0) return;
      // If a build session is still active for this project, the SSE replay
      // path will re-apply every code_applied event and reconstruct file
      // contents authoritatively. Overwriting from the server here would
      // race against the (debounced) syncFilesToServer + the in-flight build
      // tools, and could briefly flash stale content before the replay
      // catches up. Skip it; the build's mid-write DB upserts and the SSE
      // replay together cover refresh-during-build.
      let buildInFlight = false;
      try {
        buildInFlight = !!localStorage.getItem(`cascade-build-session-${id}`);
      } catch {}
      if (buildInFlight) return;

      const fileTree = rebuildFileTree(serverFiles);
      const currentState = get();
      if (currentState.projectId !== id) return;

      const allPaths = serverFiles.map((f) => f.path);
      const validOpenFiles = baseState.openFiles.filter((f: string) => allPaths.includes(f));
      const entryFile = getMainEntryFile(framework);
      const fallbackFile = allPaths.find((p) => p === entryFile) || allPaths.find((p) => p.endsWith(".html")) || allPaths[0] || entryFile;
      const openFiles = validOpenFiles.length > 0 ? validOpenFiles : [fallbackFile];
      const activeFile = openFiles.includes(baseState.activeFile || "") ? baseState.activeFile : openFiles[0];

      const updated = {
        ...currentState,
        files: fileTree,
        openFiles,
        activeFile,
        previewFile: allPaths.includes(baseState.previewFile) ? baseState.previewFile : fallbackFile,
        previewRefreshKey: Date.now(),
      };
      set(updated);
      persistState(updated);
    }).catch(() => {});
  },

  saveProject: () => {
    persistState(get());
  },

  setPendingPrompt: (prompt: string, mode?: ChatMode) => {
    set({ pendingPrompt: prompt, pendingPromptMode: mode ?? null });
    const state = get();
    debouncedPersist(state);
  },

  clearPendingPrompt: () => {
    set({ pendingPrompt: null, pendingPromptMode: null });
    const state = get();
    debouncedPersist(state);
  },

  setStreamingSnapshot: (snapshot: StreamingSnapshot | null) => {
    set({ streamingSnapshot: snapshot });
    const state = get();
    persistState(state);
  },

  createCheckpoint: (label, options) => {
    const state = get();
    if (!state.projectId) return;

    const currentFlat = flattenToFlatFiles(state.files);
    const checkpointId = crypto.randomUUID();
    const now = Date.now();
    const newCheckpoint: Checkpoint = {
      id: checkpointId,
      label,
      timestamp: now,
      snapshot: currentFlat,
    };

    const oldCheckpoints = [...state.checkpoints];

    if (oldCheckpoints.length > 0) {
      const prevLast = oldCheckpoints[oldCheckpoints.length - 1];
      if (prevLast.snapshot) {
        const reverseDiff = computeReverseDiff(prevLast.snapshot, currentFlat);
        oldCheckpoints[oldCheckpoints.length - 1] = {
          ...prevLast,
          diff: reverseDiff,
          snapshot: undefined,
        };
      }
    }

    const updatedCheckpoints = [...oldCheckpoints, newCheckpoint];

    let nextForPersist: IDEState | null = null;
    set((prev) => {
      const seq = prev._nextSeq;
      const checkpointMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "checkpoint",
        content: label,
        timestamp: now,
        seq,
        checkpointId,
      };
      const nextManagerMessages = options?.includeManagerThread
        ? [...prev.managerMessages, {
            id: crypto.randomUUID(),
            role: "checkpoint" as const,
            content: label,
            timestamp: now,
            seq: seq + 1,
            checkpointId,
          } satisfies ManagerMessage]
        : prev.managerMessages;
      const next = {
        ...prev,
        _nextSeq: options?.includeManagerThread ? seq + 2 : seq + 1,
        checkpoints: updatedCheckpoints,
        chatMessages: [...prev.chatMessages, checkpointMessage],
        managerMessages: nextManagerMessages,
      };
      nextForPersist = next;
      return next;
    });
    if (nextForPersist) debouncedPersist(nextForPersist);
    persistCheckpoints(state.projectId, updatedCheckpoints);
  },

  restoreCheckpoint: (id) => {
    const state = get();
    if (!state.projectId) return;

    const restoredFlat = reconstructCheckpointFiles(state.checkpoints, id);
    if (!restoredFlat) return;

    const restoredTree = rebuildFileTree(restoredFlat);
    const allPaths = restoredFlat.map((f) => f.path);
    const htmlFile = allPaths.find((p) => p.endsWith(".html")) || allPaths[0] || "/project/index.html";
    const validOpenFiles = state.openFiles.filter((f) => allPaths.includes(f));
    if (validOpenFiles.length === 0 && allPaths.length > 0) {
      validOpenFiles.push(htmlFile);
    }

    const next = {
      ...state,
      files: restoredTree,
      openFiles: validOpenFiles,
      activeFile: validOpenFiles[0] || null,
      previewFile: htmlFile,
      previewRefreshKey: Date.now(),
    };

    set(next);
    debouncedPersist(next);
    if (state.projectId) {
      syncFilesToServer(state.projectId, restoredTree);
    }
  },

  setActiveFile: (path) =>
    set((state) => {
      const next = {
        ...state,
        activeFile: path,
        previewOverrideHtml: null,
        openFiles: state.openFiles.includes(path)
          ? state.openFiles
          : [...state.openFiles, path],
      };
      debouncedPersist(next);
      return next;
    }),

  openFile: (path) =>
    set((state) => {
      const next = {
        ...state,
        activeFile: path,
        openFiles: state.openFiles.includes(path)
          ? state.openFiles
          : [...state.openFiles, path],
      };
      debouncedPersist(next);
      return next;
    }),

  closeFile: (path) =>
    set((state) => {
      const newOpenFiles = state.openFiles.filter((f) => f !== path);
      const next = {
        ...state,
        openFiles: newOpenFiles,
        activeFile:
          state.activeFile === path
            ? newOpenFiles[newOpenFiles.length - 1] || null
            : state.activeFile,
      };
      debouncedPersist(next);
      return next;
    }),

  updateFileContent: (path, content) =>
    set((state) => {
      const next = {
        ...state,
        files: updateFileInTree(state.files, path, content),
      };
      debouncedPersist(next);
      if (state.projectId) {
        syncFilesToServer(state.projectId, next.files);
      }
      return next;
    }),

  addChatMessage: (message) =>
    set((state) => {
      const seq = state._nextSeq;
      const next = {
        ...state,
        _nextSeq: seq + 1,
        chatMessages: [
          ...state.chatMessages,
          {
            ...message,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            seq,
          },
        ],
      };
      debouncedPersist(next);
      return next;
    }),

  updateLastAssistantMessage: (content) =>
    set((state) => {
      const msgs = [...state.chatMessages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], content };
          break;
        }
      }
      const next = { ...state, chatMessages: msgs };
      debouncedPersist(next);
      return next;
    }),

  setAiResponding: (v) => set({ isAiResponding: v }),

  addConsoleEntry: (entry) =>
    set((state) => ({
      consoleEntries: [
        ...state.consoleEntries,
        {
          ...entry,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        },
      ],
    })),

  clearConsole: () => set({ consoleEntries: [] }),

  setActiveTool: (tool) =>
    set((state) => ({
      activeTool: state.activeTool === tool ? null : tool,
      isSidebarOpen: tool === "files" ? state.activeTool !== "files" : false,
      isChatOpen: tool === "chat" ? state.activeTool !== "chat" : false,
    })),

  toggleSidebar: () =>
    set((state) => ({
      isSidebarOpen: !state.isSidebarOpen,
      activeTool: !state.isSidebarOpen ? "files" : state.activeTool === "files" ? null : state.activeTool,
    })),
  toggleChat: () =>
    set((state) => ({
      isChatOpen: !state.isChatOpen,
      activeTool: !state.isChatOpen ? "chat" : state.activeTool === "chat" ? null : state.activeTool,
    })),
  toggleConsole: () => set((state) => ({ isConsoleOpen: !state.isConsoleOpen })),

  addFile: (parentPath, name, type) =>
    set((state) => {
      const next = {
        ...state,
        files: addFileToTree(state.files, parentPath, name, type),
      };
      debouncedPersist(next);
      if (state.projectId) {
        syncFilesToServer(state.projectId, next.files);
      }
      return next;
    }),

  renameFile: (oldPath, newName) =>
    set((state) => {
      const newFiles = renameFileInTree(state.files, oldPath, newName);
      const parentPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
      const newPath = `${parentPath}/${newName}`;
      const newOpenFiles = state.openFiles.map((f) => {
        if (f === oldPath) return newPath;
        if (f.startsWith(oldPath + "/")) return newPath + f.substring(oldPath.length);
        return f;
      });
      let newActiveFile = state.activeFile;
      if (newActiveFile === oldPath) {
        newActiveFile = newPath;
      } else if (newActiveFile && newActiveFile.startsWith(oldPath + "/")) {
        newActiveFile = newPath + newActiveFile.substring(oldPath.length);
      }
      const next = {
        ...state,
        files: newFiles,
        openFiles: newOpenFiles,
        activeFile: newActiveFile,
      };
      debouncedPersist(next);
      if (state.projectId) {
        syncFilesToServer(state.projectId, next.files);
      }
      return next;
    }),

  deleteFile: (path) =>
    set((state) => {
      const newFiles = deleteFileFromTree(state.files, path);
      const newOpenFiles = state.openFiles.filter(
        (f) => f !== path && !f.startsWith(path + "/")
      );
      const activeGone =
        state.activeFile === path ||
        (state.activeFile && state.activeFile.startsWith(path + "/"));
      const newActiveFile = activeGone
        ? newOpenFiles[newOpenFiles.length - 1] || null
        : state.activeFile;
      const next = {
        ...state,
        files: newFiles,
        openFiles: newOpenFiles,
        activeFile: newActiveFile,
      };
      debouncedPersist(next);
      if (state.projectId) {
        syncFilesToServer(state.projectId, next.files);
        if (path) {
          fetch(`/api/projects/${state.projectId}/files`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path }),
          }).catch(() => {});
        }
      }
      return next;
    }),

  setPreviewFile: (path) =>
    set((state) => {
      const next = { ...state, previewFile: path, previewRefreshKey: Date.now() };
      debouncedPersist(next);
      return next;
    }),

  setPreviewOverrideHtml: (html) => set({ previewOverrideHtml: html }),

  refreshPreview: () => set((state) => ({ previewRefreshKey: state.previewRefreshKey + 1 })),

  setChatMode: (mode) =>
    set((state) => {
      const next = { ...state, chatMode: mode };
      debouncedPersist(next);
      return next;
    }),

  setReviewEnabled: (v) =>
    set((state) => {
      const next = { ...state, reviewEnabled: v };
      debouncedPersist(next);
      return next;
    }),

  setManagerPlan: (plan) => set({ managerPlan: plan }),

  addManagerMessage: (message) =>
    set((state) => {
      const seq = state._nextSeq;
      const next = {
        ...state,
        _nextSeq: seq + 1,
        managerMessages: [
          ...state.managerMessages,
          {
            ...message,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            seq,
          },
        ],
      };
      debouncedPersist(next);
      return next;
    }),

  updateTaskStatus: (subTaskId, status) =>
    set((state) => ({
      taskStatuses: { ...state.taskStatuses, [subTaskId]: status },
    })),

  setTaskFailureReason: (subTaskId, reason) =>
    set((state) => ({
      taskFailureReasons: { ...state.taskFailureReasons, [subTaskId]: reason },
    })),

  setExecutingTaskIndex: (index) => set({ executingTaskIndex: index }),

  setManagerResponding: (v) => set({ isManagerResponding: v }),

  clearManagerPlan: () =>
    set({
      managerPlan: null,
      executingTaskIndex: null,
      taskStatuses: {},
      taskFailureReasons: {},
      verificationResults: {},
      pendingConfirmation: null,
      userConfirmationInput: "",
      reviewPhase: "idle",
      holisticReview: null,
      fixCycle: 0,
      completionData: null,
    }),

  updateVerificationResult: (subTaskId, result) =>
    set((state) => ({
      verificationResults: { ...state.verificationResults, [subTaskId]: result },
    })),

  setPendingConfirmation: (confirmation) =>
    set({ pendingConfirmation: confirmation }),

  setUserConfirmationInput: (input) =>
    set({ userConfirmationInput: input }),

  setReviewPhase: (phase) =>
    set({ reviewPhase: phase }),

  setHolisticReview: (review) =>
    set({ holisticReview: review }),

  setFixCycle: (cycle) =>
    set({ fixCycle: cycle }),

  setCompletionData: (data: { changedFiles: string[]; summary: string } | null) =>
    set({ completionData: data }),

  updateManagerMessageThinking: (index, thinking) =>
    set((state) => {
      const msgs = [...state.managerMessages];
      const target = msgs[index];
      if (!target || target.role !== "assistant") return state;
      msgs[index] = { ...target, thinking };
      return { ...state, managerMessages: msgs };
    }),
}));

function updateFileInTree(
  files: FileNode[],
  path: string,
  content: string
): FileNode[] {
  return files.map((file) => {
    if (file.path === path) {
      return { ...file, content };
    }
    if (file.children) {
      return { ...file, children: updateFileInTree(file.children, path, content) };
    }
    return file;
  });
}

function ensureDirectoryExists(
  files: FileNode[],
  dirPath: string
): FileNode[] {
  const segments = dirPath.split("/").filter(Boolean);
  let current = files;
  let builtPath = "";

  for (const segment of segments) {
    builtPath = builtPath ? `${builtPath}/${segment}` : `/${segment}`;
    const found = current.find(
      (f) => f.path === builtPath && f.type === "folder"
    );
    if (!found) {
      const newFolder: FileNode = {
        name: segment,
        path: builtPath,
        type: "folder",
        children: [],
      };
      current.push(newFolder);
      current = newFolder.children!;
    } else {
      current = found.children || [];
    }
  }

  return files;
}

function addFileToTree(
  files: FileNode[],
  parentPath: string,
  name: string,
  type: "file" | "folder"
): FileNode[] {
  const cloned = structuredClone(files);
  ensureDirectoryExists(cloned, parentPath);

  function insertInto(nodes: FileNode[]): FileNode[] {
    return nodes.map((file) => {
      if (file.path === parentPath && file.type === "folder") {
        const already = (file.children || []).some(
          (c) => c.name === name && c.type === type
        );
        if (already) return file;
        const newNode: FileNode = {
          name,
          path: `${parentPath}/${name}`,
          type,
          ...(type === "folder" ? { children: [] } : { content: "" }),
        };
        return {
          ...file,
          children: [...(file.children || []), newNode],
        };
      }
      if (file.children) {
        return { ...file, children: insertInto(file.children) };
      }
      return file;
    });
  }

  return insertInto(cloned);
}

function renameFileInTree(
  files: FileNode[],
  oldPath: string,
  newName: string
): FileNode[] {
  return files.map((file) => {
    if (file.path === oldPath) {
      const parentPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
      const newPath = `${parentPath}/${newName}`;
      const renamed = {
        ...file,
        name: newName,
        path: newPath,
      };
      if (renamed.children) {
        renamed.children = updateChildPaths(renamed.children, oldPath, newPath);
      }
      return renamed;
    }
    if (file.children) {
      return {
        ...file,
        children: renameFileInTree(file.children, oldPath, newName),
      };
    }
    return file;
  });
}

function updateChildPaths(
  children: FileNode[],
  oldParentPath: string,
  newParentPath: string
): FileNode[] {
  return children.map((child) => {
    const updatedPath = newParentPath + child.path.substring(oldParentPath.length);
    const updated = { ...child, path: updatedPath };
    if (updated.children) {
      updated.children = updateChildPaths(updated.children, oldParentPath, newParentPath);
    }
    return updated;
  });
}

function deleteFileFromTree(files: FileNode[], path: string): FileNode[] {
  return files
    .filter((file) => file.path !== path)
    .map((file) => {
      if (file.children) {
        return {
          ...file,
          children: deleteFileFromTree(file.children, path),
        };
      }
      return file;
    });
}

export function findFileContent(
  files: FileNode[],
  path: string
): string | undefined {
  for (const file of files) {
    if (file.path === path) return file.content;
    if (file.children) {
      const found = findFileContent(file.children, path);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function getFileLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    html: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    md: "markdown",
    py: "python",
    pyw: "python",
    java: "java",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    hxx: "cpp",
    cs: "csharp",
    go: "go",
    rs: "rust",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    kts: "kotlin",
    r: "r",
    lua: "lua",
    pl: "perl",
    pm: "perl",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    sql: "sql",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    svg: "xml",
    dart: "dart",
    scala: "scala",
    ex: "plaintext",
    exs: "plaintext",
    vue: "html",
    svelte: "html",
    toml: "plaintext",
    ini: "ini",
    cfg: "ini",
    dockerfile: "dockerfile",
    graphql: "graphql",
    gql: "graphql",
    proto: "protobuf",
    txt: "plaintext",
  };
  const baseName = path.split("/").pop()?.toLowerCase() || "";
  if (baseName === "dockerfile") return "dockerfile";
  if (baseName === "makefile") return "plaintext";
  return langMap[ext || ""] || "plaintext";
}

export function flattenFiles(files: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const file of files) {
    if (file.type === "file") {
      result.push(file);
    }
    if (file.children) {
      result.push(...flattenFiles(file.children));
    }
  }
  return result;
}
