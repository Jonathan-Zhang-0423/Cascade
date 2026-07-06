import { create } from "zustand";
import { getMainEntryFile } from "@/lib/preview-adapters";
import { useLanguageStore } from "@/stores/language-store";
import { compactBuildResultForPersistence } from "@/components/ide/chat/action-log-normalize";

function getWelcomeMessage(): string {
  const lang = useLanguageStore.getState().lang;
  return lang === "en"
    ? "Hi! I'm your AI coding assistant. Tell me what you'd like to build, and I'll help you plan, code, and ship it."
    : "你好！我是你的 AI 编程助手。告诉我你想构建什么，我会帮你分析需求、编写代码并实现功能。";
}

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
  /** "direct": slim build UI. "media": AIGC poster/video task, not a code build. */
  mode?: "plan" | "direct" | "media";
  /** Only present when mode === "media" */
  media_task?: {
    type: "poster" | "video" | "both";
    prompt?: string;
    style?: string;
    duration?: number;
  };
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

export interface BuildResultData {
  actionLog: { type: string; label: string; detail: string; timestamp: number; filePath?: string; precedingNarration?: string; stepNum?: number }[];
  segments?: {
    id: string;
    narration: string;
    actions: { type: string; label: string; detail: string; timestamp: number; filePath?: string; stepNum?: number }[];
    isLive: boolean;
    stepLabel?: string;
  }[];
  completionData?: { changedFiles: string[]; userLang?: string; summary?: string };
  tokenUsage?: { input: number; output: number; total: number };
  nextStepSuggestion?: string;
  sessionId?: string;
  elapsedSec?: number;
  durationSec?: number;
  duration?: number;
}

type TaskStatus = "pending" | "running" | "done" | "failed" | "needs-input" | "bug";

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
  // Snapshot of taskStatuses captured when this plan's build finished.
  // Lets historical PlanCards render their final state instead of reverting
  // to all-pending once a newer plan takes over the live `taskStatuses`.
  frozenTaskStatuses?: Record<string, TaskStatus>;
  frozenTaskFailureReasons?: Record<string, string>;
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
  chatSessionId?: string;
  runType?: string;
  updatedAt: number;
  lastEventId?: number;
  actionLog?: BuildResultData["actionLog"];
  stepNarrations?: Record<number, string>;
  taskStatuses?: Record<string, TaskStatus>;
  currentStepNum?: number;
  ledger?: unknown;
  finalArtifact?: unknown;
}

// A persisted streaming snapshot older than this is treated as dead on reload —
// the server session has almost certainly ended, so its live "thinking" text
// must not be revived (it would show as frozen ghost content).
const STREAMING_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

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
  idePageMounted: boolean;
  theme: string;
  previewFile: string;
  previewRefreshKey: number;
  previewOverrideHtml: string | null;
  pendingPrompt: string | null;
  pendingPromptMode: ChatMode | null;
  checkpoints: Checkpoint[];

  // ── Multi-session ──────────────────────────────────────────────────────────
  currentSessionId: string;   // "main" = 主会话（默认），其余为 session id
  sessions: { id: string; name: string; createdAt: string }[];
  sessionsLoaded: boolean;
  lastBuildFileDiffs: Record<string, { old: string; new: string }>;
  setLastBuildFileDiff: (filePath: string, old: string, newContent: string) => void;
  clearLastBuildFileDiffs: () => void;

  layoutMode: "preview" | "code";
  setLayoutMode: (mode: "preview" | "code") => void;
  codeVisible: boolean;
  toggleCodeVisible: () => void;

  chatMode: ChatMode;
  managerPlan: ManagerPlan | null;
  managerMessages: ManagerMessage[];
  _nextSeq: number;
  streamingSnapshot: StreamingSnapshot | null;
  streamingSnapshots: Record<string, StreamingSnapshot>;
  executingTaskIndex: number | null;
  taskStatuses: Record<string, TaskStatus>;
  taskFailureReasons: Record<string, string>;
  isManagerResponding: boolean;
  /** Per-session responding state. Key = sessionId. True while that session's manager stream is active. */
  sessionManagerResponding: Record<string, boolean>;
  /** True once the async DB fetch for managerMessages/chatMessages has completed
   *  (or been skipped). Prevents sending stale cross-project messages to the LLM
   *  during the window between loadProject's synchronous set() and the async
   *  fetchMessagesFromServer resolve. */
  messagesReady: boolean;
  verificationResults: Record<string, VerificationResult>;
  pendingConfirmation: { stepKey: string; items: string[] } | null;
  userConfirmationInput: string;
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
  addChatMessage: (message: Omit<ChatMessage, "id" | "timestamp" | "seq"> & { id?: string }) => void;
  updateLastAssistantMessage: (content: string) => void;
  addConsoleEntry: (entry: Omit<ConsoleEntry, "id" | "timestamp">) => void;
  clearConsole: () => void;
  setActiveTool: (tool: ToolPanel) => void;
  setAiResponding: (v: boolean) => void;
  setIdePageMounted: (v: boolean) => void;
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
  historyTabRequest: number;
  requestHistoryTab: () => void;

  setChatMode: (mode: ChatMode) => void;
  setManagerPlan: (plan: ManagerPlan | null) => void;
  addManagerMessage: (message: Omit<ManagerMessage, "id" | "timestamp" | "seq"> & { id?: string }) => void;
  loadOlderMessages: (kind: "chat" | "manager", limit?: number) => Promise<number>;
  updateTaskStatus: (subTaskId: string, status: TaskStatus) => void;
  setTaskFailureReason: (subTaskId: string, reason: string) => void;
  setExecutingTaskIndex: (index: number | null) => void;
  setManagerResponding: (v: boolean, sessionId?: string) => void;
  clearManagerPlan: () => void;
  clearConversation: () => void;
  createSession: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  loadSessions: () => Promise<void>;
  updateVerificationResult: (subTaskId: string, result: VerificationResult) => void;
  setPendingConfirmation: (confirmation: { stepKey: string; items: string[] } | null) => void;
  setUserConfirmationInput: (input: string) => void;
  setFixCycle: (cycle: number) => void;
  setCompletionData: (data: { changedFiles: string[]; summary: string } | null) => void;

  // Plan preview panel（右内容区左侧并列显示）
  planPreviewOpen: boolean;
  planPreviewData: { summary?: string; overview?: string; steps: { title?: string; description?: string }[] } | null;
  setPlanPreview: (open: boolean, data?: { summary?: string; overview?: string; steps: { title?: string; description?: string }[] } | null) => void;

  updateManagerMessageThinking: (index: number, thinking: string) => void;
  freezeLatestPlanStatuses: (statuses?: Record<string, TaskStatus>, failureReasons?: Record<string, string>, planMessageId?: string | null) => void;

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

const defaultFilesHash = flattenFilesForHash(defaultFiles);

export function isDefaultProjectFileSet(files: FileNode[]): boolean {
  return flattenFilesForHash(files) === defaultFilesHash;
}

export function getUnsafeFullFileSyncReason(
  files: FileNode[],
  options: { allowDestructiveOverwrite?: boolean } = {},
): "empty" | "starter-template" | null {
  if (options.allowDestructiveOverwrite) return null;
  if (flattenToFlatFiles(files).length === 0) return "empty";
  if (isDefaultProjectFileSet(files)) return "starter-template";
  return null;
}

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
  const MAX_SNAPSHOT_TEXT = 4000;
  const truncateSnapshot = (snap: IDEState["streamingSnapshot"]) => {
    if (!snap) return null;
    const tt = (snap as { thinkingText?: string }).thinkingText;
    const nt = (snap as { narrationText?: string }).narrationText;
    const compactedActionLog = Array.isArray(snap.actionLog)
      ? snap.actionLog.map((entry) => compactBuildResultForPersistence({ actionLog: [entry] }).actionLog?.[0] ?? entry)
      : snap.actionLog;
    return {
      ...snap,
      actionLog: compactedActionLog,
      ...(typeof tt === "string" && tt.length > MAX_SNAPSHOT_TEXT
        ? { thinkingText: tt.slice(-MAX_SNAPSHOT_TEXT) }
        : {}),
      ...(typeof nt === "string" && nt.length > MAX_SNAPSHOT_TEXT
        ? { narrationText: nt.slice(-MAX_SNAPSHOT_TEXT) }
        : {}),
    };
  };
  // chatMessages, managerMessages, files are now persisted server-side (DB).
  // localStorage only holds lightweight UI/session state.
  const compactSnapshots = Object.fromEntries(
    Object.entries(state.streamingSnapshots || {})
      .sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 8)
      .map(([key, snap]) => [key, truncateSnapshot(snap as any)]),
  );
  const toSave = {
    openFiles: state.openFiles,
    activeFile: state.activeFile,
    previewFile: state.previewFile,
    theme: state.theme,
    pendingPrompt: state.pendingPrompt,
    pendingPromptMode: state.pendingPromptMode,
    chatMode: state.chatMode,
    _nextSeq: state._nextSeq,
    streamingSnapshot: truncateSnapshot(state.streamingSnapshot),
    streamingSnapshots: compactSnapshots,
    managerPlan: state.managerPlan,
    taskStatuses: state.taskStatuses,
    taskFailureReasons: state.taskFailureReasons,
    selectedDevice: state.selectedDevice,
    deviceOrientation: state.deviceOrientation,
    devicePlatform: state.devicePlatform,
    deviceFrameStyle: state.deviceFrameStyle,
    customDeviceWidth: state.customDeviceWidth,
    customDeviceHeight: state.customDeviceHeight,
    layoutMode: state.layoutMode,
    codeVisible: state.codeVisible,
    currentSessionId: state.currentSessionId,
  };
  const key = `cascade-project-${state.projectId}`;
  const isQuotaErr = (e: unknown) =>
    e instanceof DOMException &&
    (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014);
  try {
    localStorage.setItem(key, JSON.stringify(toSave));
    return;
  } catch (err) {
    if (!isQuotaErr(err)) {
      console.warn("[persistState] failed:", err);
      return;
    }
  }
  // Quota fallback: drop streamingSnapshot(s) (often the largest remaining accumulator)
  try {
    localStorage.setItem(key, JSON.stringify({ ...toSave, streamingSnapshot: null, streamingSnapshots: {} }));
    console.warn("[persistState] dropped streamingSnapshot to fit quota");
  } catch (err) {
    console.warn("[persistState] still over quota, skipping save:", err);
  }
}

// ── Chat message → DB sync ─────────────────────────────────────────────
type PendingChatMsg = {
  clientId: string;
  kind: "chat" | "manager";
  role: string;
  content: string;
  thinking?: string | null;
  source?: string | null;
  seq: number;
  timestamp: number;
  metadata?: string | null;
  sessionId?: string | null;
};
const pendingMsgUploads = new Map<string, Map<string, PendingChatMsg>>();
let msgUploadTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingMsgUploads(keepalive = false) {
  msgUploadTimer = null;
  for (const [pid, byClientId] of pendingMsgUploads) {
    if (byClientId.size === 0) continue;
    const messages = Array.from(byClientId.values());
    byClientId.clear();
    const body = JSON.stringify({ messages });
    // keepalive=true 保证 pagehide/visibilitychange 时请求能在页面卸载后继续发出。
    // 普通调用也用 keepalive，浏览器对 keepalive fetch 有 64KB body 上限，
    // 消息批量一般远低于此，安全。
    fetch(`/api/projects/${pid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: keepalive || body.length < 60_000,
    }).catch(() => {});
  }
}

function queueMessageUpload(projectId: string, msg: PendingChatMsg, immediate = false) {
  let byClientId = pendingMsgUploads.get(projectId);
  if (!byClientId) {
    byClientId = new Map();
    pendingMsgUploads.set(projectId, byClientId);
  }
  // Latest write per clientId wins (covers updates to the same message).
  byClientId.set(msg.clientId, msg);
  if (immediate) {
    // Flush immediately (e.g. user message that must survive a rapid refresh).
    if (msgUploadTimer) clearTimeout(msgUploadTimer);
    flushPendingMsgUploads(true);
  } else {
    if (msgUploadTimer) clearTimeout(msgUploadTimer);
    msgUploadTimer = setTimeout(flushPendingMsgUploads, 32);
  }
}

async function fetchMessagesFromServer(
  projectId: string,
  kind: "chat" | "manager",
  before?: number,
  limit = 100,
  sessionId?: string,
): Promise<unknown[]> {
  try {
    const params = new URLSearchParams({ kind, limit: String(limit) });
    if (typeof before === "number") params.set("before", String(before));
    if (sessionId) params.set("sessionId", sessionId);
    const resp = await fetch(`/api/projects/${projectId}/messages?${params.toString()}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data?.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

function dbRowToChatMessage(row: any): ChatMessage {
  let metadata: any = null;
  if (typeof row.metadata === "string" && row.metadata) {
    try { metadata = JSON.parse(row.metadata); } catch {}
  }
  return {
    id: row.clientId,
    role: row.role,
    content: row.content ?? "",
    timestamp: Number(row.timestamp) || Date.now(),
    seq: row.seq,
    checkpointId: metadata?.checkpointId,
    hidden: metadata?.hidden,
  };
}

function dbRowToManagerMessage(row: any): ManagerMessage {
  let metadata: any = null;
  if (typeof row.metadata === "string" && row.metadata) {
    try { metadata = JSON.parse(row.metadata); } catch {}
  }
  let buildResult = metadata?.buildResult;
  if (buildResult && typeof buildResult === "object") {
    try {
      buildResult = compactBuildResultForPersistence(buildResult);
    } catch {
      buildResult = { actionLog: [], segments: [] };
    }
  }
  return {
    id: row.clientId,
    role: row.role,
    content: row.content ?? "",
    plan: metadata?.plan,
    timestamp: Number(row.timestamp) || Date.now(),
    seq: row.seq,
    source: row.source ?? metadata?.source,
    typing: metadata?.typing,
    hidden: metadata?.hidden,
    checkpointId: metadata?.checkpointId,
    thinking: row.thinking ?? undefined,
    preparingPlan: metadata?.preparingPlan,
    buildResult,
    errorCode: metadata?.errorCode,
    frozenTaskStatuses: metadata?.frozenTaskStatuses,
    frozenTaskFailureReasons: metadata?.frozenTaskFailureReasons,
  };
}

function chatMessageToDbInput(m: ChatMessage, projectId: string, sessionId?: string | null): PendingChatMsg {
  const metadata: Record<string, unknown> = {};
  if (m.checkpointId) metadata.checkpointId = m.checkpointId;
  if (m.hidden) metadata.hidden = m.hidden;
  return {
    clientId: m.id,
    kind: "chat",
    role: m.role,
    content: m.content ?? "",
    thinking: null,
    source: null,
    seq: m.seq,
    timestamp: m.timestamp,
    metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : null,
    sessionId: sessionId ?? null,
  };
}

function managerMessageToDbInput(m: ManagerMessage, projectId: string, sessionId?: string | null): PendingChatMsg {
  const metadata: Record<string, unknown> = {};
  if (m.plan) metadata.plan = m.plan;
  if (m.typing) metadata.typing = m.typing;
  if (m.hidden) metadata.hidden = m.hidden;
  if (m.checkpointId) metadata.checkpointId = m.checkpointId;
  if (m.preparingPlan) metadata.preparingPlan = m.preparingPlan;
  if (m.buildResult) metadata.buildResult = compactBuildResultForPersistence(m.buildResult as any);
  if (m.errorCode) metadata.errorCode = m.errorCode;
  if (m.frozenTaskStatuses) metadata.frozenTaskStatuses = m.frozenTaskStatuses;
  if (m.frozenTaskFailureReasons) metadata.frozenTaskFailureReasons = m.frozenTaskFailureReasons;
  return {
    clientId: m.id,
    kind: "manager",
    role: m.role,
    content: m.content ?? "",
    thinking: m.thinking ?? null,
    source: m.source ?? null,
    seq: m.seq,
    timestamp: m.timestamp,
    metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : null,
    sessionId: sessionId ?? null,
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
// Latest state handed to debouncedPersist but not yet written. Lets a lifecycle
// flush (tab hide/close) write the most recent snapshot synchronously instead of
// losing it inside the 500ms debounce window.
let pendingPersistState: IDEState | null = null;

function debouncedPersist(state: IDEState) {
  pendingPersistState = state;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistState(state);
    persistTimer = null;
    pendingPersistState = null;
  }, 500);
}

// Write any pending debounced state immediately. Called on tab hide/close so a
// just-added message's _nextSeq / managerPlan isn't lost if the tab closes
// within the debounce window.
function flushPersist() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  if (pendingPersistState) {
    persistState(pendingPersistState);
    pendingPersistState = null;
  }
}

if (typeof window !== "undefined") {
  // pagehide fires reliably on tab close and bfcache navigation; visibilitychange
  // covers mobile/background where pagehide may not. Both flush UI state AND
  // any pending message uploads so messages aren't lost on rapid refresh.
  const flushAll = () => { flushPersist(); flushPendingMsgUploads(true); };
  window.addEventListener("pagehide", flushAll);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
}

let serverSyncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingServerSync: {
  projectId: string;
  files: { path: string; content: string }[];
  allowDestructiveOverwrite: boolean;
} | null = null;
const singleFileSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

function singleFileSyncKey(projectId: string, path: string) {
  return `${projectId}\n${path}`;
}

function cancelSingleFileSync(projectId: string, path: string) {
  const key = singleFileSyncKey(projectId, path);
  const timer = singleFileSyncTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    singleFileSyncTimers.delete(key);
  }
}

function cancelAllSingleFileSyncs(projectId?: string) {
  for (const [key, timer] of singleFileSyncTimers) {
    if (!projectId || key.startsWith(`${projectId}\n`)) {
      clearTimeout(timer);
      singleFileSyncTimers.delete(key);
    }
  }
}

function syncFilesToServer(
  projectId: string,
  files: FileNode[],
  options: { allowDestructiveOverwrite?: boolean } = {},
) {
  cancelAllSingleFileSyncs(projectId);
  const flat = flattenToFlatFiles(files);

  const unsafeReason = getUnsafeFullFileSyncReason(files, options);
  if (unsafeReason) {
    console.warn(`[files-sync] skipped ${unsafeReason} full file sync`, { projectId });
    return;
  }

  if (serverSyncTimer) clearTimeout(serverSyncTimer);
  pendingServerSync = { projectId, files: flat, allowDestructiveOverwrite: options.allowDestructiveOverwrite === true };

  serverSyncTimer = setTimeout(() => {
    if (!pendingServerSync) return;
    const { projectId: pid, files: flatFiles, allowDestructiveOverwrite } = pendingServerSync;
    pendingServerSync = null;
    serverSyncTimer = null;

    fetch(`/api/projects/${pid}/files`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: flatFiles,
        ...(allowDestructiveOverwrite ? { allowDestructiveOverwrite: true } : {}),
      }),
    }).catch(() => {});
  }, 1000);
}

function refreshPendingFullFileSync(projectId: string, files: FileNode[]) {
  if (pendingServerSync?.projectId === projectId) {
    const unsafeReason = getUnsafeFullFileSyncReason(files, {
      allowDestructiveOverwrite: pendingServerSync.allowDestructiveOverwrite,
    });
    if (unsafeReason) {
      console.warn(`[files-sync] kept pending full sync; refusing to replace it with ${unsafeReason} files`, { projectId });
      return;
    }
    pendingServerSync = {
      ...pendingServerSync,
      files: flattenToFlatFiles(files),
    };
  }
}

function syncSingleFileToServer(projectId: string, path: string, content: string, delayMs = 500) {
  cancelSingleFileSync(projectId, path);
  const key = singleFileSyncKey(projectId, path);
  const timer = setTimeout(() => {
    singleFileSyncTimers.delete(key);
    fetch(`/api/projects/${projectId}/files/single`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }).catch(() => {});
  }, delayMs);
  singleFileSyncTimers.set(key, timer);
}

function deleteSingleFileFromServer(projectId: string, path: string) {
  cancelSingleFileSync(projectId, path);
  fetch(`/api/projects/${projectId}/files`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  }).catch(() => {});
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
      content: getWelcomeMessage(),
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
  idePageMounted: false,
  theme: "vs-dark",
  previewFile: "/project/index.html",
  previewRefreshKey: 0,
  previewOverrideHtml: null,
  pendingPrompt: null,
  pendingPromptMode: null,
  checkpoints: [],
  historyTabRequest: 0,
  lastBuildFileDiffs: {},
  setLastBuildFileDiff: (filePath, old, newContent) =>
    set((s) => ({ lastBuildFileDiffs: { ...s.lastBuildFileDiffs, [filePath]: { old, new: newContent } } })),
  clearLastBuildFileDiffs: () => set({ lastBuildFileDiffs: {} }),
  planPreviewOpen: false,
  planPreviewData: null,
  setPlanPreview: (open, data) => set({ planPreviewOpen: open, planPreviewData: data ?? null }),

  // ── Multi-session initial state ────────────────────────────────────────────
  currentSessionId: "main",
  sessions: [],
  sessionsLoaded: false,

  layoutMode: "code",
  setLayoutMode: (mode) => { set({ layoutMode: mode }); debouncedPersist(get()); },
  codeVisible: false,
  toggleCodeVisible: () => { set((s) => ({ codeVisible: !s.codeVisible })); debouncedPersist(get()); },

  chatMode: "build",
  managerPlan: null,
  managerMessages: [],
  _nextSeq: 1,
  streamingSnapshot: null,
  streamingSnapshots: {},
  executingTaskIndex: null,
  taskStatuses: {},
  taskFailureReasons: {},
  isManagerResponding: false,
  sessionManagerResponding: {},
  messagesReady: true,
  verificationResults: {},
  pendingConfirmation: null,
  userConfirmationInput: "",
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
      const auth = localStorage.getItem("cascade-auth");
      const userId = auth ? JSON.parse(auth)?.userId : null;
      const key = userId ? `cascade-selected-provider-${userId}` : "cascade-selected-provider";
      const saved = localStorage.getItem(key);
      if (saved === "deepseek") return "deepseek-pro";
      if (saved === "doubao" || saved === "kimi" || saved === "minimax" || saved === "glm" || saved === "deepseek-pro" || saved === "deepseek-flash") return saved;
    } catch {}
    return "glm";
  })(),
  setSelectedProvider: (provider) => {
    try {
      const auth = localStorage.getItem("cascade-auth");
      const userId = auth ? JSON.parse(auth)?.userId : null;
      const key = userId ? `cascade-selected-provider-${userId}` : "cascade-selected-provider";
      localStorage.setItem(key, provider);
    } catch {}
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
        content: getWelcomeMessage(),
        seq: 1,
        timestamp: Date.now(),
      },
    ];

    const entryFile = getMainEntryFile(framework);

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
      files: [],
      openFiles: saved.openFiles || [entryFile],
      activeFile: saved.activeFile || entryFile,
      previewFile: saved.previewFile || entryFile,
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
      managerMessages: mgrMsgsWithSeq,
      _nextSeq: finalNextSeq,
      streamingSnapshot: (() => {
        // Expire stale snapshots: if the persisted stream is older than the
        // threshold, the server-side session is almost certainly gone, so
        // reviving its "thinking" text on reload would show frozen ghost
        // content. Drop it and let the DB-backed message history stand.
        const snap = saved.streamingSnapshot;
        if (!snap) return null;
        const age = Date.now() - (typeof snap.updatedAt === "number" ? snap.updatedAt : 0);
        return age <= STREAMING_SNAPSHOT_MAX_AGE_MS ? snap : null;
      })(),
      streamingSnapshots: (() => {
        const raw = saved.streamingSnapshots && typeof saved.streamingSnapshots === "object"
          ? saved.streamingSnapshots
          : {};
        const now = Date.now();
        return Object.fromEntries(Object.entries(raw).filter(([, value]) => {
          const snap = value as any;
          const age = now - (typeof snap?.updatedAt === "number" ? snap.updatedAt : 0);
          return snap && typeof snap.sessionId === "string" && age <= STREAMING_SNAPSHOT_MAX_AGE_MS;
        })) as Record<string, StreamingSnapshot>;
      })(),
      managerPlan: (saved.managerMessages || []).slice().reverse().find((m: ManagerMessage) => m.plan)?.plan || saved.managerPlan || null,
      executingTaskIndex: null,
      taskStatuses: saved.taskStatuses || (mgrMsgsWithSeq as ManagerMessage[]).slice().reverse().find((m) => m.plan && m.frozenTaskStatuses)?.frozenTaskStatuses || {},
      taskFailureReasons: saved.taskFailureReasons || (mgrMsgsWithSeq as ManagerMessage[]).slice().reverse().find((m) => m.plan && m.frozenTaskFailureReasons)?.frozenTaskFailureReasons || {},
      isManagerResponding: false,
      messagesReady: false,
      verificationResults: {},
      pendingConfirmation: null,
      userConfirmationInput: "",
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
      files: [],
      openFiles: [entryFile],
      activeFile: entryFile,
      previewFile: entryFile,
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
      managerMessages: [],
      _nextSeq: 2,
      streamingSnapshot: null,
      streamingSnapshots: {},
      managerPlan: null,
      executingTaskIndex: null,
      taskStatuses: {},
      taskFailureReasons: {},
      isManagerResponding: false,
      messagesReady: false,
      verificationResults: {},
      pendingConfirmation: null,
      userConfirmationInput: "",
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
    // 恢复上次所在的 session（持久化的 currentSessionId）
    const restoredSessionId: string = (saved?.currentSessionId && typeof saved.currentSessionId === "string")
      ? saved.currentSessionId
      : "main";
    // 如果需要恢复非主会话，立即更新 store（不等消息加载）
    if (restoredSessionId !== "main") {
      set({ currentSessionId: restoredSessionId });
    }

    // Migrate legacy localStorage messages → DB (one-time per project).
    // Older clients persisted full chatMessages / managerMessages arrays into
    // localStorage; the new client reads from /api/projects/:id/messages.
    // Detect leftovers and upload them so history is preserved, then strip
    // them from the saved blob on the next persist.
    if (saved && (Array.isArray(saved.chatMessages) || Array.isArray(saved.managerMessages))) {
      const legacy: PendingChatMsg[] = [];
      const seen = new Set<string>();
      for (const m of (saved.chatMessages as ChatMessage[] | undefined) || []) {
        if (!m?.id || seen.has(m.id)) continue;
        seen.add(m.id);
        legacy.push(chatMessageToDbInput(m, id));
      }
      for (const m of (saved.managerMessages as ManagerMessage[] | undefined) || []) {
        if (!m?.id || seen.has(m.id)) continue;
        seen.add(m.id);
        legacy.push(managerMessageToDbInput(m, id));
      }
      if (legacy.length > 0) {
        fetch(`/api/projects/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: legacy }),
        }).catch(() => {});
      }
    }

    // Pull latest persisted history from server and replace local arrays.
    // Use limit=100 per kind; older messages can be fetched on scroll-up.
    Promise.all([
      fetchMessagesFromServer(id, "chat", undefined, 100, restoredSessionId),
      fetchMessagesFromServer(id, "manager", undefined, 100, restoredSessionId),
    ]).then(([chatRows, mgrRows]) => {
      const cur = get();
      if (cur.projectId !== id) return; // user switched projects
      // 最优先检查：只要用户已切换到其他 session，立即 return
      if (cur.currentSessionId !== restoredSessionId) {
        set({ messagesReady: true });
        return;
      }
      const chat = chatRows.map(dbRowToChatMessage);
      const mgr = mgrRows.map(dbRowToManagerMessage);
      if (chat.length === 0 && mgr.length === 0) {
        const cur2 = get();
        if (cur2.projectId === id) set({ messagesReady: true });
        return;
      }
      const maxSeq = Math.max(
        cur._nextSeq,
        ...chat.map((m) => m.seq + 1),
        ...mgr.map((m) => m.seq + 1),
      );
      // Merge, do NOT replace. This fetch was started at loadProject time against
      // a DB snapshot taken THEN. On a freshly created project the user's first
      // prompt — and the in-flight manager stream's messages/plan — can land
      // AFTER the fetch started but BEFORE it resolves. Blindly replacing the
      // arrays would discard those live messages, so the prompt looks like it
      // "never happened" even though the backend keeps streaming. Union server
      // rows with any live message not in the server snapshot, keyed by id.
      const mergeById = <T extends { id: string; seq: number }>(serverMsgs: T[], liveMsgs: T[]): T[] => {
        const byId = new Map<string, T>();
        for (const m of serverMsgs) byId.set(m.id, m);
        for (const m of liveMsgs) if (!byId.has(m.id)) byId.set(m.id, m);
        return Array.from(byId.values()).sort((a, b) => a.seq - b.seq);
      };
      const mergedChat = chat.length > 0 ? mergeById(chat, cur.chatMessages) : cur.chatMessages;
      const mergedMgr = mgr.length > 0 ? mergeById(mgr, cur.managerMessages) : cur.managerMessages;
      // 再次检查：如果用户已切换到其他 session，不覆盖消息
      const cur3 = get();
      if (cur3.projectId !== id || cur3.currentSessionId !== restoredSessionId) {
        if (cur3.projectId === id) set({ messagesReady: true });
        return;
      }
      const lastPlanMsg = mergedMgr.slice().reverse().find((m) => m.plan);
      // Prefer a live plan if one exists (an in-flight stream may have just set
      // it); otherwise fall back to the newest plan from the merged history.
      const lastPlan = cur.managerPlan ?? lastPlanMsg?.plan;
      const restoredTaskStatuses = lastPlanMsg?.frozenTaskStatuses ?? cur.taskStatuses;
      const restoredTaskFailureReasons = lastPlanMsg?.frozenTaskFailureReasons ?? cur.taskFailureReasons;
      set({
        chatMessages: mergedChat,
        managerMessages: mergedMgr,
        _nextSeq: maxSeq,
        managerPlan: lastPlan,
        taskStatuses: restoredTaskStatuses,
        taskFailureReasons: restoredTaskFailureReasons,
        messagesReady: true,
      });
    }).catch(() => {
      // Even on failure, mark ready so the UI isn't permanently blocked.
      // The store already has whatever was in localStorage (possibly empty).
      const cur = get();
      if (cur.projectId === id) set({ messagesReady: true });
    });

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
    // Persist synchronously, NOT debounced: loadProject restores pendingPrompt
    // from localStorage, so if the write hasn't landed yet and the project
    // re-loads (remount / refresh / StrictMode), the stale prompt would be
    // restored and auto-sent again — producing duplicate messages and repeated
    // manager-chat calls. Cancel any pending debounced write, then write the
    // cleared state immediately to close that window.
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    pendingPersistState = null;
    persistState(get());
  },

  setStreamingSnapshot: (snapshot: StreamingSnapshot | null) => {
    set((state) => {
      if (!snapshot) return { streamingSnapshot: null };
      const chatSessionId = snapshot.chatSessionId || state.currentSessionId || "main";
      const key = `${snapshot.projectId}:${chatSessionId}:${snapshot.sessionId}`;
      const nextMap = { ...(state.streamingSnapshots || {}), [key]: { ...snapshot, chatSessionId } };
      return {
        streamingSnapshot: { ...snapshot, chatSessionId },
        streamingSnapshots: nextMap,
      };
    });
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
      syncFilesToServer(state.projectId, restoredTree, { allowDestructiveOverwrite: true });
    }
  },

  setActiveFile: (path) =>
    set((state) => {
      const next = {
        ...state,
        activeFile: path,
        previewOverrideHtml: null,
        layoutMode: "code" as const,
        codeVisible: true,
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
        previewOverrideHtml: null,
        layoutMode: "code" as const,
        codeVisible: true,
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
        refreshPendingFullFileSync(state.projectId, next.files);
        syncSingleFileToServer(state.projectId, path, content);
      }
      return next;
    }),

  addChatMessage: (message) =>
    set((state) => {
      const existingIndex = message.id ? state.chatMessages.findIndex((m) => m.id === message.id) : -1;
      if (existingIndex >= 0) {
        const msgs = [...state.chatMessages];
        msgs[existingIndex] = { ...msgs[existingIndex], ...message, id: msgs[existingIndex].id };
        const next = { ...state, chatMessages: msgs };
        debouncedPersist(next);
        if (state.projectId) queueMessageUpload(state.projectId, chatMessageToDbInput(msgs[existingIndex], state.projectId, state.currentSessionId));
        return next;
      }
      const seq = state._nextSeq;
      const newMsg: ChatMessage = {
        ...message,
        id: message.id || crypto.randomUUID(),
        timestamp: Date.now(),
        seq,
      };
      const next = {
        ...state,
        _nextSeq: seq + 1,
        chatMessages: [...state.chatMessages, newMsg],
      };
      debouncedPersist(next);
      if (state.projectId) queueMessageUpload(state.projectId, chatMessageToDbInput(newMsg, state.projectId, state.currentSessionId));
      return next;
    }),

  updateLastAssistantMessage: (content) =>
    set((state) => {
      const msgs = [...state.chatMessages];
      let updated: ChatMessage | null = null;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], content };
          updated = msgs[i];
          break;
        }
      }
      const next = { ...state, chatMessages: msgs };
      debouncedPersist(next);
      if (updated && state.projectId) queueMessageUpload(state.projectId, chatMessageToDbInput(updated, state.projectId, state.currentSessionId));
      return next;
    }),

  setAiResponding: (v) => set({ isAiResponding: v }),

  setIdePageMounted: (v: boolean) => set({ idePageMounted: v }),

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
      const normalizedParentPath = parentPath || "/project";
      const newPath = `${normalizedParentPath}/${name}`;
      const alreadyExists = !!findFileNode(state.files, newPath);
      const next = {
        ...state,
        files: addFileToTree(state.files, normalizedParentPath, name, type),
        activeFile: type === "file" ? newPath : state.activeFile,
        openFiles:
          type === "file" && !state.openFiles.includes(newPath)
            ? [...state.openFiles, newPath]
            : state.openFiles,
        layoutMode: type === "file" ? ("code" as const) : state.layoutMode,
        codeVisible: type === "file" ? true : state.codeVisible,
      };
      debouncedPersist(next);
      if (state.projectId && type === "file" && !alreadyExists) {
        refreshPendingFullFileSync(state.projectId, next.files);
        syncSingleFileToServer(state.projectId, newPath, "", 0);
      }
      return next;
    }),

  renameFile: (oldPath, newName) =>
    set((state) => {
      const renamedBefore = collectFlatFilesUnderPath(state.files, oldPath);
      const newFiles = renameFileInTree(state.files, oldPath, newName);
      const parentPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
      const newPath = `${parentPath}/${newName}`;
      const renamedAfter = collectFlatFilesUnderPath(newFiles, newPath);
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
      const projectId = state.projectId;
      if (projectId) {
        refreshPendingFullFileSync(projectId, next.files);
        renamedBefore.forEach((file) => deleteSingleFileFromServer(projectId, file.path));
        renamedAfter.forEach((file) => syncSingleFileToServer(projectId, file.path, file.content, 0));
      }
      return next;
    }),

  deleteFile: (path) =>
    set((state) => {
      const deletedFiles = collectFlatFilesUnderPath(state.files, path);
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
      const projectId = state.projectId;
      if (projectId) {
        refreshPendingFullFileSync(projectId, next.files);
        deletedFiles.forEach((file) => deleteSingleFileFromServer(projectId, file.path));
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

  requestHistoryTab: () => set((state) => ({ historyTabRequest: state.historyTabRequest + 1 })),

  setChatMode: (mode) =>
    set((state) => {
      const next = { ...state, chatMode: mode };
      debouncedPersist(next);
      return next;
    }),

  // Replacing the active plan must also reset the live per-step status map.
  // taskStatuses is keyed by global step number ("1".."N"), so without this a
  // new plan's steps 1..N inherit the previous plan's "done" marks and render
  // pre-checked. Historical PlanCards are unaffected — their statuses were
  // already snapshotted onto the message via freezeLatestPlanStatuses() on
  // all_complete, and ChatMessageList reads frozenTaskStatuses for non-latest
  // plans.
  setManagerPlan: (plan) =>
    set({
      managerPlan: plan,
      taskStatuses: {},
      taskFailureReasons: {},
      verificationResults: {},
      executingTaskIndex: null,
      fixCycle: 0,
      completionData: null,
      pendingConfirmation: null,
      userConfirmationInput: "",
    }),

  addManagerMessage: (message) =>
    set((state) => {
      const existingIndex = message.id ? state.managerMessages.findIndex((m) => m.id === message.id) : -1;
      if (existingIndex >= 0) {
        const msgs = [...state.managerMessages];
        msgs[existingIndex] = { ...msgs[existingIndex], ...message, id: msgs[existingIndex].id };
        const next = { ...state, managerMessages: msgs };
        debouncedPersist(next);
        if (state.projectId) queueMessageUpload(state.projectId, managerMessageToDbInput(msgs[existingIndex], state.projectId, state.currentSessionId));
        return next;
      }
      const seq = state._nextSeq;
      const newMsg: ManagerMessage = {
        ...message,
        id: message.id || crypto.randomUUID(),
        timestamp: Date.now(),
        seq,
      };
      const next = {
        ...state,
        _nextSeq: seq + 1,
        managerMessages: [...state.managerMessages, newMsg],
      };
      debouncedPersist(next);
      if (state.projectId) queueMessageUpload(
        state.projectId,
        managerMessageToDbInput(newMsg, state.projectId, state.currentSessionId),
        newMsg.role === "user", // immediate flush for user messages to survive rapid refresh
      );
      return next;
    }),

  loadOlderMessages: async (kind, limit = 50) => {
    const state = get();
    if (!state.projectId) return 0;
    const sessionId = state.currentSessionId;
    const arr = kind === "chat" ? state.chatMessages : state.managerMessages;
    const earliestSeq = arr.length > 0 ? arr[0].seq : undefined;
    const rows = await fetchMessagesFromServer(state.projectId, kind, earliestSeq, limit, sessionId);
    if (rows.length === 0) return 0;
    const cur = get();
    if (cur.projectId !== state.projectId || cur.currentSessionId !== sessionId) return 0;
    if (kind === "chat") {
      const newer = rows.map(dbRowToChatMessage);
      const existingIds = new Set(cur.chatMessages.map((m) => m.id));
      const dedup = newer.filter((m) => !existingIds.has(m.id));
      set({ chatMessages: [...dedup, ...cur.chatMessages] });
      return dedup.length;
    } else {
      const newer = rows.map(dbRowToManagerMessage);
      const existingIds = new Set(cur.managerMessages.map((m) => m.id));
      const dedup = newer.filter((m) => !existingIds.has(m.id));
      set({ managerMessages: [...dedup, ...cur.managerMessages] });
      return dedup.length;
    }
  },

  updateTaskStatus: (subTaskId, status) => {
    set((state) => ({
      taskStatuses: { ...state.taskStatuses, [subTaskId]: status },
    }));
    debouncedPersist(get());
  },

  setTaskFailureReason: (subTaskId, reason) => {
    set((state) => ({
      taskFailureReasons: { ...state.taskFailureReasons, [subTaskId]: reason },
    }));
    debouncedPersist(get());
  },

  setExecutingTaskIndex: (index) => set({ executingTaskIndex: index }),

  setManagerResponding: (v, sessionId) => set((state) => {
    const sid = sessionId ?? state.currentSessionId;
    return {
      isManagerResponding: sid === state.currentSessionId ? v : state.isManagerResponding,
      sessionManagerResponding: { ...state.sessionManagerResponding, [sid]: v },
    };
  }),

  clearManagerPlan: () =>
    set({
      managerPlan: null,
      executingTaskIndex: null,
      taskStatuses: {},
      taskFailureReasons: {},
      verificationResults: {},
      pendingConfirmation: null,
      userConfirmationInput: "",
      fixCycle: 0,
      completionData: null,
    }),

  clearConversation: () => {
    const welcome = {
      id: "welcome-" + Date.now(),
      role: "assistant" as const,
      content: getWelcomeMessage(),
      timestamp: Date.now(),
      seq: 0,
    };
    set({
      chatMessages: [welcome],
      managerMessages: [],
      _nextSeq: 1,
      managerPlan: null,
      executingTaskIndex: null,
      taskStatuses: {},
      taskFailureReasons: {},
      verificationResults: {},
      pendingConfirmation: null,
      userConfirmationInput: "",
      fixCycle: 0,
      completionData: null,
    });
    // Persist the _nextSeq reset immediately. A pending debounced write would
    // otherwise still hold the old (high) _nextSeq, and if the tab closed before
    // the next unrelated mutation flushed, reload would restore a stale counter
    // and risk seq collisions. Cancel the debounce, then write synchronously.
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    pendingPersistState = null;
    persistState(get());
  },

  // ── Session actions ────────────────────────────────────────────────────────
  loadSessions: async () => {
    const { projectId } = get();
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/sessions`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      set({ sessions: data.sessions ?? [], sessionsLoaded: true });
    } catch { /* non-fatal */ }
  },

  createSession: async () => {
    const state = get();
    if (!state.projectId) return;
    // 防重入：正在创建中则不重复执行
    if ((state as any)._creatingSession) return;
    set({ _creatingSession: true } as any);
    try {
      const res = await fetch(`/api/projects/${state.projectId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: "新会话" }),
      });
      if (!res.ok) {
        // 项目在 DB 里不存在（localStorage 缓存了已删除的 projectId），
        // 清除本地缓存并跳回项目列表，避免用户永久卡住。
        if (res.status === 500 || res.status === 404) {
          try { localStorage.removeItem(`cascade-project-${state.projectId}`); } catch {}
          window.location.href = "/app";
        }
        return;
      }
      const data = await res.json();
      const newSession = data.session;
      set((s) => ({ sessions: [newSession, ...s.sessions] }));
      await get().switchSession(newSession.id);
    } catch { /* non-fatal */ } finally {
      set({ _creatingSession: false } as any);
    }
  },

  switchSession: async (sessionId: string) => {
    const { projectId } = get();
    if (!projectId) return;
    const welcome = {
      id: "welcome-" + Date.now(),
      role: "assistant" as const,
      content: getWelcomeMessage(),
      timestamp: Date.now(),
      seq: 0,
    };
    set((state) => ({
      currentSessionId: sessionId,
      activeTool: "chat",
      chatMessages: [welcome],
      managerMessages: [],
      _nextSeq: 1,
      managerPlan: null,
      executingTaskIndex: null,
      taskStatuses: {},
      taskFailureReasons: {},
      verificationResults: {},
      pendingConfirmation: null,
      userConfirmationInput: "",
      fixCycle: 0,
      completionData: null,
      messagesReady: false,
      // 切换时从 per-session Map 同步全局 isManagerResponding，
      // 避免切到正在执行任务的 session 时 loading 状态丢失，
      // 也避免切走时把其他 session 的 loading 带过来
      isManagerResponding: state.sessionManagerResponding[sessionId] ?? false,
    }));
    // 重置目标 slot 的 live stream state，避免上一次 build 残留显示在本会话。
    // 仅当该 slot 没有正在进行的活跃流时才 reset（不打断进行中的 build）。
    // 动态 import 避免与 stream-registry 形成循环依赖。
    import("@/services/stream").then(({ streamRegistry }) => {
      const slot = streamRegistry.get(projectId, sessionId);
      if (!slot.build.isActive) slot.build.resetLive();
      if (!slot.manager.isActive) slot.manager.resetLive();
    }).catch(() => {});
    try {
      // sessionId 始终是字符串（主会话为 "main"），后端按 session_id 精确过滤
      const sid = sessionId || "main";
      const sidParam = `&sessionId=${encodeURIComponent(sid)}`;
      const [chatRes, mgrRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/messages?kind=chat&limit=100${sidParam}`, { credentials: "include" }),
        fetch(`/api/projects/${projectId}/messages?kind=manager&limit=100${sidParam}`, { credentials: "include" }),
      ]);
      const chatData = chatRes.ok ? await chatRes.json() : { messages: [] };
      const mgrData = mgrRes.ok ? await mgrRes.json() : { messages: [] };
      const loadedChat: ChatMessage[] = (chatData.messages ?? []).map(dbRowToChatMessage);
      const loadedMgr: ManagerMessage[] = (mgrData.messages ?? []).map(dbRowToManagerMessage);
      // seq 续接：从该 session 已有消息的 max seq + 1 开始，避免新消息撞号
      const maxSeq = Math.max(
        0,
        ...loadedChat.map((m: any) => m.seq ?? 0),
        ...loadedMgr.map((m: any) => m.seq ?? 0),
      );
      // 切换期间用户可能又切走了，写入前确认仍是当前 session
      if (get().currentSessionId !== sessionId) return;
      // 从最新的 plan 消息里恢复 plan card 状态，和 loadProject 保持一致
      const lastPlanMsg = loadedMgr.slice().reverse().find((m: ManagerMessage) => m.plan);
      const restoredPlan = lastPlanMsg?.plan ?? null;
      const restoredTaskStatuses = lastPlanMsg?.frozenTaskStatuses ?? {};
      const restoredTaskFailureReasons = lastPlanMsg?.frozenTaskFailureReasons ?? {};
      set({
        chatMessages: loadedChat.length > 0 ? loadedChat : [welcome],
        managerMessages: loadedMgr,
        _nextSeq: maxSeq + 1,
        messagesReady: true,
        managerPlan: restoredPlan,
        taskStatuses: restoredTaskStatuses,
        taskFailureReasons: restoredTaskFailureReasons,
      });
    } catch {
      set({ messagesReady: true });
    }
  },

  deleteSession: async (sessionId: string) => {
    const { projectId, currentSessionId } = get();
    if (!projectId) return;
    try {
      await fetch(`/api/projects/${projectId}/sessions/${sessionId}`, {
        method: "DELETE", credentials: "include",
      });
      set((s) => ({ sessions: s.sessions.filter((s2) => s2.id !== sessionId) }));
      if (currentSessionId === sessionId) await get().switchSession("main");
    } catch { /* non-fatal */ }
  },

  updateVerificationResult: (subTaskId, result) =>
    set((state) => ({
      verificationResults: { ...state.verificationResults, [subTaskId]: result },
    })),

  setPendingConfirmation: (confirmation) =>
    set({ pendingConfirmation: confirmation }),

  setUserConfirmationInput: (input) =>
    set({ userConfirmationInput: input }),

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
      const next = { ...state, managerMessages: msgs };
      if (state.projectId) queueMessageUpload(state.projectId, managerMessageToDbInput(msgs[index], state.projectId, state.currentSessionId));
      return next;
    }),

  freezeLatestPlanStatuses: (statuses, failureReasons, planMessageId) =>
    set((state) => {
      // Snapshot the current live taskStatuses onto the plan-bearing manager
      // message that launched this build. Direct builds have no plan target and
      // must not rewrite the previous plan's frozen completion state.
      if (planMessageId === null) return state;
      const msgs = [...state.managerMessages];
      let lastPlanIdx = -1;
      if (planMessageId) {
        lastPlanIdx = msgs.findIndex((msg) => msg.id === planMessageId && !!msg.plan);
      } else {
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].plan) { lastPlanIdx = i; break; }
        }
      }
      if (lastPlanIdx === -1) return state;
      const target = msgs[lastPlanIdx];
      msgs[lastPlanIdx] = {
        ...target,
        frozenTaskStatuses: { ...(statuses ?? state.taskStatuses) },
        frozenTaskFailureReasons: { ...(failureReasons ?? state.taskFailureReasons) },
      };
      const next = { ...state, managerMessages: msgs };
      debouncedPersist(next);
      if (state.projectId) queueMessageUpload(state.projectId, managerMessageToDbInput(msgs[lastPlanIdx], state.projectId, state.currentSessionId));
      return next;
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

function findFileNode(files: FileNode[], path: string): FileNode | undefined {
  for (const file of files) {
    if (file.path === path) return file;
    if (file.children) {
      const found = findFileNode(file.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

function flattenNodeToFlatFiles(node: FileNode): FlatFile[] {
  if (node.type === "file") {
    return [{ path: node.path, content: node.content || "" }];
  }
  return (node.children || []).flatMap((child) => flattenNodeToFlatFiles(child));
}

function collectFlatFilesUnderPath(files: FileNode[], path: string): FlatFile[] {
  const node = findFileNode(files, path);
  return node ? flattenNodeToFlatFiles(node) : [];
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
