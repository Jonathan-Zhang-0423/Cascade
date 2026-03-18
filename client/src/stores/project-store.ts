import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ProjectEntry {
  id: string;
  name: string;
  createdAt: number;
  emoji?: string;
}

interface ProjectStoreState {
  projects: ProjectEntry[];
  createProject: (name: string, initialPrompt?: string, emoji?: string) => string;
  deleteProject: (id: string) => void;
  renameProject: (id: string, newName: string) => void;
}

const BLANK_FILES = [
  {
    name: "project",
    path: "/project",
    type: "folder" as const,
    children: [
      {
        name: "index.html",
        path: "/project/index.html",
        type: "file" as const,
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
        type: "file" as const,
        content: "",
      },
      {
        name: "app.js",
        path: "/project/app.js",
        type: "file" as const,
        content: "",
      },
    ],
  },
];

function getDefaultProjectState(initialPrompt?: string) {
  return {
    files: BLANK_FILES,
    openFiles: ["/project/index.html"],
    activeFile: "/project/index.html",
    previewFile: "/project/index.html",
    chatMessages: [
      {
        id: "welcome",
        role: "assistant" as const,
        content:
          "你好！我是你的 Vibe 编程助手。告诉我你想做什么，我来帮你实现！不需要任何编程经验——用中文描述你的想法就行！",
        timestamp: Date.now(),
      },
    ],
    theme: "vs-dark",
    pendingPrompt: initialPrompt || null,
  };
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

export function migrateOldState() {
  if (localStorage.getItem("codestart-migrated")) return;

  const oldData = localStorage.getItem("codestart-ide-state");
  if (!oldData) {
    localStorage.setItem("codestart-migrated", "1");
    return;
  }

  try {
    const parsed = JSON.parse(oldData);
    const state = parsed.state;
    if (!state || !state.files) {
      localStorage.setItem("codestart-migrated", "1");
      localStorage.removeItem("codestart-ide-state");
      return;
    }

    const projectId = generateId();
    const projectState = {
      files: state.files,
      openFiles: state.openFiles || ["/project/index.html"],
      activeFile: state.activeFile || "/project/index.html",
      previewFile: state.previewFile || "/project/index.html",
      chatMessages: state.chatMessages || [],
      theme: state.theme || "vs-dark",
      pendingPrompt: null,
    };

    localStorage.setItem(
      `codestart-project-${projectId}`,
      JSON.stringify(projectState)
    );

    const projectsData = localStorage.getItem("codestart-projects");
    let projects: ProjectEntry[] = [];
    if (projectsData) {
      try {
        const p = JSON.parse(projectsData);
        projects = p.state?.projects || [];
      } catch {}
    }

    projects.push({
      id: projectId,
      name: "My Project",
      createdAt: Date.now(),
    });

    localStorage.setItem(
      "codestart-projects",
      JSON.stringify({ state: { projects }, version: 0 })
    );

    localStorage.removeItem("codestart-ide-state");
    localStorage.setItem("codestart-migrated", "1");
  } catch {
    localStorage.setItem("codestart-migrated", "1");
  }
}

export const useProjectStore = create<ProjectStoreState>()(
  persist(
    (set) => ({
      projects: [],

      createProject: (name: string, initialPrompt?: string, emoji?: string) => {
        const id = generateId();
        const state = getDefaultProjectState(initialPrompt);
        localStorage.setItem(
          `codestart-project-${id}`,
          JSON.stringify(state)
        );

        set((s) => ({
          projects: [
            ...s.projects,
            { id, name, createdAt: Date.now(), ...(emoji ? { emoji } : {}) },
          ],
        }));

        return id;
      },

      deleteProject: (id: string) => {
        localStorage.removeItem(`codestart-project-${id}`);
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
        }));
      },

      renameProject: (id: string, newName: string) => {
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, name: newName } : p
          ),
        }));
      },
    }),
    {
      name: "codestart-projects",
    }
  )
);
