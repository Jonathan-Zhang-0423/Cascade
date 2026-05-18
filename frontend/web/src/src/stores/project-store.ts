import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getMainEntryFile } from "@/lib/preview-adapters";

interface StoredFileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: StoredFileNode[];
  content?: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  createdAt: number;
  emoji?: string;
  framework?: string;
}

interface ProjectStoreState {
  projects: ProjectEntry[];
  serverSynced: boolean;
  _syncing: boolean;
  createProject: (name: string, initialPrompt?: string, emoji?: string, framework?: string) => Promise<string>;
  deleteProject: (id: string) => void;
  renameProject: (id: string, newName: string) => void;
  syncFromServer: () => Promise<void>;
}

export const BLANK_FILES = [
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
      {
        name: "cascade.md",
        path: "/project/cascade.md",
        type: "file" as const,
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

function getDefaultProjectState(initialPrompt?: string, framework?: string) {
  const entryFile = getMainEntryFile(framework);
  const isWeb = !framework || framework === "web";
  return {
    files: isWeb ? BLANK_FILES : [],
    openFiles: [entryFile],
    activeFile: entryFile,
    previewFile: entryFile,
    chatMessages: [
      {
        id: "welcome",
        role: "assistant" as const,
        content:
          "你好！我是你的 AI 编程助手。告诉我你想构建什么，我会帮你分析需求、编写代码并实现功能。",
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
  if (localStorage.getItem("cascade-migrated")) return;

  const oldData = localStorage.getItem("cascade-ide-state");
  if (!oldData) {
    localStorage.setItem("cascade-migrated", "1");
    return;
  }

  try {
    const parsed = JSON.parse(oldData);
    const state = parsed.state;
    if (!state || !state.files) {
      localStorage.setItem("cascade-migrated", "1");
      localStorage.removeItem("cascade-ide-state");
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
      `cascade-project-${projectId}`,
      JSON.stringify(projectState)
    );

    const projectsData = localStorage.getItem("cascade-projects");
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
      "cascade-projects",
      JSON.stringify({ state: { projects }, version: 0 })
    );

    localStorage.removeItem("cascade-ide-state");
    localStorage.setItem("cascade-migrated", "1");
  } catch {
    localStorage.setItem("cascade-migrated", "1");
  }
}

async function syncProjectToServer(id: string, name: string, emoji?: string, framework?: string) {
  try {
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, emoji, framework }),
    });
  } catch {}
}

async function updateProjectOnServer(id: string, name: string) {
  try {
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch {}
}

async function deleteProjectOnServer(id: string) {
  try {
    await fetch(`/api/projects/${id}`, {
      method: "DELETE",
    });
  } catch {}
}

export const useProjectStore = create<ProjectStoreState>()(
  persist(
    (set, get) => ({
      projects: [],
      serverSynced: false,
      _syncing: false,

      createProject: async (name: string, initialPrompt?: string, emoji?: string, framework?: string) => {
        const id = generateId();
        const isWeb = !framework || framework === "web";
        const state = getDefaultProjectState(initialPrompt, framework);
        localStorage.setItem(
          `cascade-project-${id}`,
          JSON.stringify(state)
        );

        set((s) => ({
          projects: [
            ...s.projects,
            { id, name, createdAt: Date.now(), ...(emoji ? { emoji } : {}), ...(framework ? { framework } : {}) },
          ],
        }));

        await syncProjectToServer(id, name, emoji, framework);

        if (isWeb) {
          const flatFiles: { path: string; content: string }[] = [];
          type FileNode = { name: string; path: string; type: "file"; content?: string };
          type FolderNode = { name: string; path: string; type: "folder"; children: (FileNode | FolderNode)[] };
          function flattenNode(nodes: readonly (FileNode | FolderNode)[]) {
            for (const n of nodes) {
              if (n.type === "file") {
                flatFiles.push({ path: n.path, content: n.content || "" });
              }
              if (n.type === "folder" && n.children) {
                flattenNode(n.children);
              }
            }
          }
          flattenNode(BLANK_FILES);
          fetch(`/api/projects/${id}/files`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ files: flatFiles }),
          }).catch(() => {});
        }

        return id;
      },

      deleteProject: (id: string) => {
        localStorage.removeItem(`cascade-project-${id}`);
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
        }));
        deleteProjectOnServer(id);
      },

      renameProject: (id: string, newName: string) => {
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, name: newName } : p
          ),
        }));
        updateProjectOnServer(id, newName);
      },

      syncFromServer: async () => {
        if (get()._syncing) return;
        set({ _syncing: true });
        try {
          const resp = await fetch("/api/projects");
          if (!resp.ok) return;
          const data = await resp.json();
          const serverProjects: Array<{ id: string; name: string; emoji?: string | null; framework?: string | null; createdAt: string }> = data.projects || [];

          const converted: ProjectEntry[] = serverProjects.map((p) => ({
            id: p.id,
            name: p.name,
            createdAt: new Date(p.createdAt).getTime(),
            ...(p.emoji ? { emoji: p.emoji } : {}),
            ...(p.framework ? { framework: p.framework } : {}),
          }));

          const currentState = get();
          const serverIds = new Set(converted.map((p) => p.id));

          const merged = [
            ...converted,
            ...currentState.projects.filter((p) => !serverIds.has(p.id)),
          ];

          merged.sort((a, b) => a.createdAt - b.createdAt);

          set({ projects: merged, serverSynced: true });

          const localOnlyProjects = currentState.projects.filter((p) => !serverIds.has(p.id));
          for (const p of localOnlyProjects) {
            await syncProjectToServer(p.id, p.name, p.emoji, p.framework);

            const projectStateRaw = localStorage.getItem(`cascade-project-${p.id}`);
            if (projectStateRaw) {
              try {
                const projectState = JSON.parse(projectStateRaw) as { files?: StoredFileNode[]; state?: { files?: StoredFileNode[] } };
                const fileNodes: StoredFileNode[] = projectState?.files || projectState?.state?.files || [];
                const flatFiles: { path: string; content: string }[] = [];
                function flattenForSync(nodes: StoredFileNode[]) {
                  for (const n of nodes) {
                    if (n.type === "file" && n.path) {
                      flatFiles.push({ path: n.path, content: n.content || "" });
                    }
                    if (n.children) flattenForSync(n.children);
                  }
                }
                flattenForSync(fileNodes);
                if (flatFiles.length > 0) {
                  fetch(`/api/projects/${p.id}/files`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ files: flatFiles }),
                  }).catch(() => {});
                }
              } catch {}
            }
          }
        } catch {
          set({ serverSynced: true });
        } finally {
          set({ _syncing: false });
        }
      },
    }),
    {
      name: "cascade-projects",
    }
  )
);
