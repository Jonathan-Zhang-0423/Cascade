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
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ConsoleEntry {
  id: string;
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: number;
}

export type ToolPanel = "files" | "chat" | null;

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

function getPersistedState(projectId: string) {
  try {
    const data = localStorage.getItem(`codestart-project-${projectId}`);
    if (data) return JSON.parse(data);
  } catch {}
  return null;
}

function persistState(state: IDEState) {
  if (!state.projectId) return;
  const toSave = {
    files: state.files,
    openFiles: state.openFiles,
    activeFile: state.activeFile,
    previewFile: state.previewFile,
    chatMessages: state.chatMessages,
    theme: state.theme,
    pendingPrompt: state.pendingPrompt,
  };
  localStorage.setItem(
    `codestart-project-${state.projectId}`,
    JSON.stringify(toSave)
  );
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

  loadProject: (id) => {
    const current = get();
    if (current.projectId) {
      persistState(current);
    }

    const saved = getPersistedState(id);
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
        consoleEntries: [],
        isAiResponding: false,
        previewRefreshKey: Date.now(),
        activeTool: "chat",
        isChatOpen: true,
        isSidebarOpen: false,
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
        consoleEntries: [],
        isAiResponding: false,
        previewRefreshKey: Date.now(),
      });
    }
  },

  saveProject: () => {
    persistState(get());
  },

  clearPendingPrompt: () => {
    set({ pendingPrompt: null });
    const state = get();
    persistState(state);
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
      persistState(next);
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
      persistState(next);
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
      persistState(next);
      return next;
    }),

  updateFileContent: (path, content) =>
    set((state) => {
      const next = {
        ...state,
        files: updateFileInTree(state.files, path, content),
      };
      persistState(next);
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
      persistState(next);
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
      persistState(next);
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
      persistState(next);
      return next;
    }),

  addFile: (parentPath, name, type) =>
    set((state) => {
      const next = {
        ...state,
        files: addFileToTree(state.files, parentPath, name, type),
      };
      persistState(next);
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
      persistState(next);
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
      persistState(next);
      return next;
    }),

  setPreviewFile: (path) =>
    set((state) => {
      const next = { ...state, previewFile: path, previewRefreshKey: Date.now() };
      persistState(next);
      return next;
    }),

  refreshPreview: () => set((state) => ({ previewRefreshKey: state.previewRefreshKey + 1 })),
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
