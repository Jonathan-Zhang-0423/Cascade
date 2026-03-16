import { create } from "zustand";

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
  checkpointId?: string;
  hidden?: boolean;
}

export interface ConsoleEntry {
  id: string;
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: number;
}

export type ToolPanel = "files" | "chat" | null;
export type ChatMode = "build" | "manager";

export interface ManagerSubTask {
  step: number;
  sub_task_id?: string;
  title: string;
  description: string;
  acceptance_criteria?: string;
}

export interface ManagerPlan {
  summary: string;
  steps: ManagerSubTask[];
  needs_input: string[];
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

export type ReviewPhase = "idle" | "building" | "reviewing" | "review_passed" | "review_failed" | "fixing";

export type ActiveSpace = "workspace" | "learner";

export interface NotebookKeyConcept {
  term: string;
  explanation: string;
}

export interface NotebookFileBreakdown {
  file: string;
  what_it_does: string;
  key_concepts: NotebookKeyConcept[];
  connections: string[];
}

export interface NotebookMindMapChild {
  label: string;
  explanation: string;
}

export interface NotebookMindMapBranch {
  label: string;
  file: string;
  description?: string;
  children: NotebookMindMapChild[];
}

export interface NotebookMindMap {
  central_node: string;
  branches: NotebookMindMapBranch[];
}

export interface NotebookContent {
  project_summary: string;
  file_breakdowns: NotebookFileBreakdown[];
  mind_map: NotebookMindMap;
  learning_tips: string[];
  generatedAt?: number;
  sourceHash?: string;
  sourceFiles?: { path: string; content: string }[];
}

export interface ManagerMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  plan?: ManagerPlan;
  timestamp: number;
  source?: "communicator" | "manager_raw";
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
  theme: "vs-dark" | "vs-light" | "hc-black";
  previewFile: string;
  previewRefreshKey: number;
  pendingPrompt: string | null;
  checkpoints: Checkpoint[];

  chatMode: ChatMode;
  managerPlan: ManagerPlan | null;
  managerMessages: ManagerMessage[];
  executingTaskIndex: number | null;
  taskStatuses: Record<string, "pending" | "running" | "done" | "failed" | "needs-input" | "bug">;
  isManagerResponding: boolean;
  verificationResults: Record<string, VerificationResult>;
  pendingConfirmation: { stepKey: string; items: string[] } | null;
  userConfirmationInput: string;
  reviewPhase: ReviewPhase;
  holisticReview: HolisticReviewResult | null;
  fixCycle: number;

  activeSpace: ActiveSpace;
  notebookContent: NotebookContent | null;
  isNotebookLoading: boolean;
  isNotebookOptimizing: boolean;
  notebookError: string | null;

  loadProject: (id: string) => void;
  saveProject: () => void;
  clearPendingPrompt: () => void;
  setActiveFile: (path: string) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  addChatMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => void;
  updateLastAssistantMessage: (content: string) => void;
  addConsoleEntry: (entry: Omit<ConsoleEntry, "id" | "timestamp">) => void;
  clearConsole: () => void;
  setActiveTool: (tool: ToolPanel) => void;
  setAiResponding: (v: boolean) => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  toggleConsole: () => void;
  setTheme: (theme: "vs-dark" | "vs-light" | "hc-black") => void;
  addFile: (parentPath: string, name: string, type: "file" | "folder") => void;
  renameFile: (oldPath: string, newName: string) => void;
  deleteFile: (path: string) => void;
  setPreviewFile: (path: string) => void;
  refreshPreview: () => void;
  createCheckpoint: (label: string) => void;
  restoreCheckpoint: (id: string) => void;

  setChatMode: (mode: ChatMode) => void;
  setManagerPlan: (plan: ManagerPlan | null) => void;
  addManagerMessage: (message: Omit<ManagerMessage, "id" | "timestamp">) => void;
  updateTaskStatus: (subTaskId: string, status: "pending" | "running" | "done" | "failed" | "needs-input" | "bug") => void;
  setExecutingTaskIndex: (index: number | null) => void;
  setManagerResponding: (v: boolean) => void;
  clearManagerPlan: () => void;
  updateVerificationResult: (subTaskId: string, result: VerificationResult) => void;
  setPendingConfirmation: (confirmation: { stepKey: string; items: string[] } | null) => void;
  setUserConfirmationInput: (input: string) => void;
  setReviewPhase: (phase: ReviewPhase) => void;
  setHolisticReview: (review: HolisticReviewResult | null) => void;
  setFixCycle: (cycle: number) => void;

  setActiveSpace: (space: ActiveSpace) => void;
  setNotebookContent: (content: NotebookContent | null) => void;
  setNotebookLoading: (v: boolean) => void;
  setNotebookOptimizing: (v: boolean) => void;
  setNotebookError: (error: string | null) => void;
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
    const data = localStorage.getItem(`codestart-project-${projectId}`);
    if (data) return JSON.parse(data);
  } catch {}
  return null;
}

const MAX_PERSISTED_CHAT_MESSAGES = 200;
const MAX_PERSISTED_MANAGER_MESSAGES = 50;

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
    chatMode: state.chatMode,
    managerMessages: state.managerMessages.length > MAX_PERSISTED_MANAGER_MESSAGES
      ? state.managerMessages.slice(-MAX_PERSISTED_MANAGER_MESSAGES)
      : state.managerMessages,
    activeSpace: state.activeSpace,
    notebookContent: state.notebookContent,
  };
  localStorage.setItem(
    `codestart-project-${state.projectId}`,
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

function loadCheckpoints(projectId: string): Checkpoint[] {
  try {
    const data = localStorage.getItem(`codestart-checkpoints-${projectId}`);
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
      `codestart-checkpoints-${projectId}`,
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
  files: defaultFiles,
  activeFile: "/project/index.html",
  openFiles: ["/project/index.html"],
  chatMessages: [
    {
      id: "welcome",
      role: "assistant",
      content:
        "你好！我是你的 Vibe 编程助手。告诉我你想做什么，我来帮你实现！不需要任何编程经验——用中文描述你的想法就行！",
      timestamp: Date.now(),
    },
  ],
  consoleEntries: [],
  activeTool: "files" as ToolPanel,
  isConsoleOpen: true,
  isSidebarOpen: true,
  isChatOpen: false,
  isAiResponding: false,
  theme: "vs-dark",
  previewFile: "/project/index.html",
  previewRefreshKey: 0,
  pendingPrompt: null,
  checkpoints: [],

  chatMode: "build",
  managerPlan: null,
  managerMessages: [],
  executingTaskIndex: null,
  taskStatuses: {},
  isManagerResponding: false,
  verificationResults: {},
  pendingConfirmation: null,
  userConfirmationInput: "",
  reviewPhase: "idle",
  holisticReview: null,
  fixCycle: 0,

  activeSpace: "workspace",
  notebookContent: null,
  isNotebookLoading: false,
  isNotebookOptimizing: false,
  notebookError: null,

  loadProject: (id) => {
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
          "你好！我是你的 Vibe 编程助手。告诉我你想做什么，我来帮你实现！不需要任何编程经验——用中文描述你的想法就行！",
        timestamp: Date.now(),
      },
    ];

    if (saved) {
      set({
        projectId: id,
        files: saved.files || defaultFiles,
        openFiles: saved.openFiles || ["/project/index.html"],
        activeFile: saved.activeFile || "/project/index.html",
        previewFile: saved.previewFile || "/project/index.html",
        chatMessages: saved.chatMessages || defaultChat,
        theme: saved.theme || "vs-dark",
        pendingPrompt: saved.pendingPrompt || null,
        checkpoints: savedCheckpoints,
        consoleEntries: [],
        isAiResponding: false,
        previewRefreshKey: Date.now(),
        activeTool: "chat",
        isChatOpen: true,
        isSidebarOpen: false,
        chatMode: (saved.chatMode === "manager" ? "manager" : "build"),
        managerMessages: saved.managerMessages || [],
        managerPlan: (saved.managerMessages || []).slice().reverse().find((m: ManagerMessage) => m.plan)?.plan || null,
        executingTaskIndex: null,
        taskStatuses: {},
        isManagerResponding: false,
        verificationResults: {},
        pendingConfirmation: null,
        userConfirmationInput: "",
        reviewPhase: "idle",
        holisticReview: null,
        fixCycle: 0,
        activeSpace: saved.activeSpace || "workspace",
        notebookContent: saved.notebookContent || null,
        isNotebookLoading: false,
        isNotebookOptimizing: false,
        notebookError: null,
      });
    } else {
      set({
        projectId: id,
        files: defaultFiles,
        openFiles: ["/project/index.html"],
        activeFile: "/project/index.html",
        previewFile: "/project/index.html",
        chatMessages: defaultChat,
        theme: "vs-dark",
        pendingPrompt: null,
        checkpoints: [],
        consoleEntries: [],
        isAiResponding: false,
        previewRefreshKey: Date.now(),
        chatMode: "build",
        managerMessages: [],
        managerPlan: null,
        executingTaskIndex: null,
        taskStatuses: {},
        isManagerResponding: false,
        verificationResults: {},
        pendingConfirmation: null,
        userConfirmationInput: "",
        reviewPhase: "idle",
        holisticReview: null,
        fixCycle: 0,
        activeSpace: "workspace",
        notebookContent: null,
        isNotebookLoading: false,
        isNotebookOptimizing: false,
        notebookError: null,
      });
    }
  },

  saveProject: () => {
    persistState(get());
  },

  clearPendingPrompt: () => {
    set({ pendingPrompt: null });
    const state = get();
    debouncedPersist(state);
  },

  createCheckpoint: (label) => {
    const state = get();
    if (!state.projectId) return;

    const currentFlat = flattenToFlatFiles(state.files);
    const checkpointId = crypto.randomUUID();
    const newCheckpoint: Checkpoint = {
      id: checkpointId,
      label,
      timestamp: Date.now(),
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

    const checkpointMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "checkpoint",
      content: label,
      timestamp: Date.now(),
      checkpointId,
    };

    const next = {
      ...state,
      checkpoints: updatedCheckpoints,
      chatMessages: [...state.chatMessages, checkpointMessage],
    };

    set(next);
    debouncedPersist(next);
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
  },

  setActiveFile: (path) =>
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
      return next;
    }),

  addChatMessage: (message) =>
    set((state) => {
      const next = {
        ...state,
        chatMessages: [
          ...state.chatMessages,
          {
            ...message,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
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
  setTheme: (theme) =>
    set((state) => {
      const next = { ...state, theme };
      debouncedPersist(next);
      return next;
    }),

  addFile: (parentPath, name, type) =>
    set((state) => {
      const next = {
        ...state,
        files: addFileToTree(state.files, parentPath, name, type),
      };
      debouncedPersist(next);
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
      return next;
    }),

  setPreviewFile: (path) =>
    set((state) => {
      const next = { ...state, previewFile: path, previewRefreshKey: Date.now() };
      debouncedPersist(next);
      return next;
    }),

  refreshPreview: () => set((state) => ({ previewRefreshKey: state.previewRefreshKey + 1 })),

  setChatMode: (mode) =>
    set((state) => {
      const next = { ...state, chatMode: mode };
      debouncedPersist(next);
      return next;
    }),

  setManagerPlan: (plan) => set({ managerPlan: plan }),

  addManagerMessage: (message) =>
    set((state) => {
      const next = {
        ...state,
        managerMessages: [
          ...state.managerMessages,
          {
            ...message,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
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

  setExecutingTaskIndex: (index) => set({ executingTaskIndex: index }),

  setManagerResponding: (v) => set({ isManagerResponding: v }),

  clearManagerPlan: () =>
    set({
      managerPlan: null,
      executingTaskIndex: null,
      taskStatuses: {},
      verificationResults: {},
      pendingConfirmation: null,
      userConfirmationInput: "",
      reviewPhase: "idle",
      holisticReview: null,
      fixCycle: 0,
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

  setActiveSpace: (space) => {
    set({ activeSpace: space });
    const state = get();
    debouncedPersist(state);
  },

  setNotebookContent: (content) => {
    set({ notebookContent: content, notebookError: null });
    const state = get();
    debouncedPersist(state);
  },

  setNotebookLoading: (v) =>
    set({ isNotebookLoading: v }),

  setNotebookOptimizing: (v) =>
    set({ isNotebookOptimizing: v }),

  setNotebookError: (error) =>
    set({ notebookError: error, isNotebookLoading: false, isNotebookOptimizing: false }),
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
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    md: "markdown",
    py: "python",
  };
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
