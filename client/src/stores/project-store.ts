import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ProjectEntry {
  id: string;
  name: string;
  createdAt: number;
}

interface ProjectStoreState {
  projects: ProjectEntry[];
  createProject: (name: string) => string;
  deleteProject: (id: string) => void;
  renameProject: (id: string, newName: string) => void;
}

const DEFAULT_FILES = [
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
  <title>My First App</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>Hello World!</h1>
    <p>Welcome to your first app built with CodeStart IDE</p>
    <button class="btn" id="myButton">Click Me</button>
  </div>

  <script src="app.js"></script>
</body>
</html>`,
      },
      {
        name: "style.css",
        path: "/project/style.css",
        type: "file" as const,
        content: `* {
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
}`,
      },
      {
        name: "app.js",
        path: "/project/app.js",
        type: "file" as const,
        content: `console.log("Hello from CodeStart IDE!");
console.log("Your app is running successfully.");

document.getElementById("myButton").addEventListener("click", function() {
  alert("You clicked the button!");
});`,
      },
    ],
  },
];

function getDefaultProjectState() {
  return {
    files: DEFAULT_FILES,
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

      createProject: (name: string) => {
        const id = generateId();
        const state = getDefaultProjectState();
        localStorage.setItem(
          `codestart-project-${id}`,
          JSON.stringify(state)
        );

        set((s) => ({
          projects: [
            ...s.projects,
            { id, name, createdAt: Date.now() },
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
