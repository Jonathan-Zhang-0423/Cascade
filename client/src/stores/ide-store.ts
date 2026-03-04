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
  files: FileNode[];
  activeFile: string | null;
  openFiles: string[];
  chatMessages: ChatMessage[];
  consoleEntries: ConsoleEntry[];
  activeTool: ToolPanel;
  isConsoleOpen: boolean;
  isSidebarOpen: boolean;
  isChatOpen: boolean;
  theme: "vs-dark" | "vs-light" | "hc-black";

  setActiveFile: (path: string) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  addChatMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => void;
  addConsoleEntry: (entry: Omit<ConsoleEntry, "id" | "timestamp">) => void;
  clearConsole: () => void;
  setActiveTool: (tool: ToolPanel) => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  toggleConsole: () => void;
  setTheme: (theme: "vs-dark" | "vs-light" | "hc-black") => void;
  addFile: (parentPath: string, name: string, type: "file" | "folder") => void;
  renameFile: (oldPath: string, newName: string) => void;
  deleteFile: (path: string) => void;
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
  <title>My First App</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .container {
      text-align: center;
      color: white;
      padding: 2rem;
    }

    h1 {
      font-size: 3rem;
      margin-bottom: 1rem;
      text-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }

    p {
      font-size: 1.25rem;
      opacity: 0.9;
      margin-bottom: 2rem;
    }

    .btn {
      background: rgba(255,255,255,0.2);
      border: 2px solid rgba(255,255,255,0.4);
      color: white;
      padding: 12px 32px;
      font-size: 1rem;
      border-radius: 50px;
      cursor: pointer;
      transition: all 0.3s ease;
      backdrop-filter: blur(10px);
    }

    .btn:hover {
      background: rgba(255,255,255,0.3);
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(0,0,0,0.15);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Hello World!</h1>
    <p>Welcome to your first app built with CodeStart IDE</p>
    <button class="btn" onclick="alert('You clicked the button!')">
      Click Me
    </button>
  </div>

  <script>
    console.log("Hello from CodeStart IDE!");
    console.log("Your app is running successfully.");
    console.warn("This is a sample warning message.");
  </script>
</body>
</html>`,
      },
      {
        name: "style.css",
        path: "/project/style.css",
        type: "file",
        content: `/* Your styles go here */
body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 0;
}`,
      },
      {
        name: "app.js",
        path: "/project/app.js",
        type: "file",
        content: `// Your JavaScript code goes here
console.log("Hello from CodeStart IDE!");`,
      },
    ],
  },
];

export const useIDEStore = create<IDEState>((set) => ({
  files: defaultFiles,
  activeFile: "/project/index.html",
  openFiles: ["/project/index.html"],
  chatMessages: [
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hey there! I'm your Vibe Coding Agent. Tell me what you want to build, and I'll help you bring it to life. No coding experience needed -- just describe your idea in plain English!",
      timestamp: Date.now(),
    },
  ],
  consoleEntries: [],
  activeTool: "files" as ToolPanel,
  isConsoleOpen: true,
  isSidebarOpen: true,
  isChatOpen: false,
  theme: "vs-dark",

  setActiveFile: (path) =>
    set((state) => ({
      activeFile: path,
      openFiles: state.openFiles.includes(path)
        ? state.openFiles
        : [...state.openFiles, path],
    })),

  openFile: (path) =>
    set((state) => ({
      activeFile: path,
      openFiles: state.openFiles.includes(path)
        ? state.openFiles
        : [...state.openFiles, path],
    })),

  closeFile: (path) =>
    set((state) => {
      const newOpenFiles = state.openFiles.filter((f) => f !== path);
      return {
        openFiles: newOpenFiles,
        activeFile:
          state.activeFile === path
            ? newOpenFiles[newOpenFiles.length - 1] || null
            : state.activeFile,
      };
    }),

  updateFileContent: (path, content) =>
    set((state) => ({
      files: updateFileInTree(state.files, path, content),
    })),

  addChatMessage: (message) =>
    set((state) => ({
      chatMessages: [
        ...state.chatMessages,
        {
          ...message,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        },
      ],
    })),

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
  setTheme: (theme) => set({ theme }),

  addFile: (parentPath, name, type) =>
    set((state) => ({
      files: addFileToTree(state.files, parentPath, name, type),
    })),

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
      return {
        files: newFiles,
        openFiles: newOpenFiles,
        activeFile: newActiveFile,
      };
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
      return {
        files: newFiles,
        openFiles: newOpenFiles,
        activeFile: newActiveFile,
      };
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

function addFileToTree(
  files: FileNode[],
  parentPath: string,
  name: string,
  type: "file" | "folder"
): FileNode[] {
  return files.map((file) => {
    if (file.path === parentPath && file.type === "folder") {
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
      return {
        ...file,
        children: addFileToTree(file.children, parentPath, name, type),
      };
    }
    return file;
  });
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
