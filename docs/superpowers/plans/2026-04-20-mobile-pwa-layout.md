# Mobile PWA Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cascade AI installable as a PWA on mobile phones with a two-panel Chat ↔ Preview experience, while leaving the desktop IDE layout completely unchanged.

**Architecture:** A `useIsMobile()` hook gates rendering in `IDEPage` — mobile renders a new `MobileIDE` component tree (swipe-driven Chat/Preview panels), desktop renders the existing layout as-is. Both share the same Zustand store with no new state fields. PWA manifest + service worker added via `vite-plugin-pwa`.

**Tech Stack:** React, Tailwind CSS, Zustand (existing), `vite-plugin-pwa` (new). Native touch events for swipe — no new gesture library.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `client/src/hooks/useIsMobile.ts` | Create | Returns `true` on ≤768px, updates on resize |
| `client/src/components/mobile/MobileIDE.tsx` | Create | Root shell: header, tab state, swipe gesture, panel mount |
| `client/src/components/mobile/MobileChatPanel.tsx` | Create | Full-height chat tab + floating Preview pill |
| `client/src/components/mobile/MobilePreviewPanel.tsx` | Create | Full-bleed iframe preview + "← Chat" strip |
| `client/src/pages/ide.tsx` | Modify | Gate on `useIsMobile()`, render `MobileIDE` on mobile |
| `client/index.html` | Modify | Add PWA meta tags, manifest link, update viewport |
| `vite.config.ts` | Modify | Add `vite-plugin-pwa` |
| `package.json` | Modify | Add `vite-plugin-pwa` dependency |
| `client/public/manifest.json` | Create | PWA manifest |
| `client/public/icons/icon-192.png` | Create | PWA icon (placeholder) |
| `client/public/icons/icon-512.png` | Create | PWA icon (placeholder) |

---

## Task 1: `useIsMobile` hook

**Files:**
- Create: `client/src/hooks/useIsMobile.ts`

- [ ] **Step 1: Create the hook**

```ts
// client/src/hooks/useIsMobile.ts
import { useState, useEffect } from "react";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setIsMobile(window.innerWidth <= 768);
    });
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);

  return isMobile;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run check 2>&1 | grep useIsMobile
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useIsMobile.ts
git commit -m "feat: useIsMobile hook"
```

---

## Task 2: PWA manifest and icons

**Files:**
- Create: `client/public/manifest.json`
- Create: `client/public/icons/icon-192.png` (placeholder)
- Create: `client/public/icons/icon-512.png` (placeholder)

- [ ] **Step 1: Create the manifest**

```json
{
  "name": "Cascade AI",
  "short_name": "Cascade",
  "description": "Build apps with AI through natural conversation",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#08080e",
  "theme_color": "#08080e",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

Save to `client/public/manifest.json`.

- [ ] **Step 2: Create placeholder icons**

Run this script to generate solid-color placeholder PNGs (requires Node, uses built-in canvas via `npm exec`):

```bash
mkdir -p client/public/icons
node -e "
const { createCanvas } = require('canvas');
const fs = require('fs');

function makePng(size, file) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#08080e';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#2563eb';
  ctx.font = \`bold \${size * 0.4}px sans-serif\`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', size/2, size/2);
  fs.writeFileSync(file, c.toBuffer('image/png'));
}
makePng(192, 'client/public/icons/icon-192.png');
makePng(512, 'client/public/icons/icon-512.png');
console.log('Icons created');
" 2>/dev/null || echo "canvas not available — copy PNG icons manually to client/public/icons/"
```

If the canvas package isn't available, copy any existing PNG from the project (e.g., `client/public/cascade-og-image.png`) and resize it:

```bash
# Fallback: copy existing image as placeholder
cp client/public/cascade-og-image.png client/public/icons/icon-192.png 2>/dev/null || \
  cp public/cascade-og-image.png client/public/icons/icon-192.png 2>/dev/null || \
  echo "Place a 192x192 PNG at client/public/icons/icon-192.png manually"
cp client/public/icons/icon-192.png client/public/icons/icon-512.png
```

- [ ] **Step 3: Commit**

```bash
git add client/public/manifest.json client/public/icons/
git commit -m "feat: PWA manifest and placeholder icons"
```

---

## Task 3: `vite-plugin-pwa` integration

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Install the dependency**

```bash
npm install -D vite-plugin-pwa
```

- [ ] **Step 2: Update `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
```

- [ ] **Step 3: Update `client/index.html`**

Replace the existing `<head>` section content (keep the existing lines, add below the existing `<meta name="viewport">` line):

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, viewport-fit=cover" />
    <title>Cascade AI — Build Apps with AI</title>
    <meta name="description" content="A browser-based IDE with a built-in AI coding agent. Turn your ideas into working code through natural conversation." />
    <meta property="og:title" content="Cascade AI — Build Apps with AI" />
    <meta property="og:description" content="A browser-based IDE with a built-in AI coding agent. Turn your ideas into working code through natural conversation." />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="/cascade-og-image.png" />
    <!-- PWA -->
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#08080e" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Cascade" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <!-- existing font/favicon links below -->
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <!-- ... keep all existing font link tags ... -->
  </head>
```

Keep all existing `<link>` font tags intact — only add the PWA block and update `viewport-fit=cover` on the viewport meta tag.

- [ ] **Step 4: Verify build doesn't break**

```bash
npm run check
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts client/index.html package.json package-lock.json
git commit -m "feat: vite-plugin-pwa service worker"
```

---

## Task 4: `MobilePreviewPanel` component

Build the preview panel first so chat can reference it.

**Files:**
- Create: `client/src/components/mobile/MobilePreviewPanel.tsx`

The preview panel must embed the same preview iframe the desktop uses. Look at how `PreviewPanel` computes `previewUrl` — on mobile we skip all the device-frame chrome and just render the iframe full-bleed.

In `PreviewPanel`, the iframe `src` is computed as a data URL from the project files (for web projects) or via the RN/Flutter compiler endpoints. For mobile v1, we reuse the `PreviewPanel` component directly but override its container to fill the screen, OR we render a simpler iframe ourselves. The simplest correct approach: render `PreviewPanel` inside the mobile shell and hide its toolbar via CSS — but that's fragile. Instead, create a minimal wrapper that shows a message pointing users to the preview and a back button.

Actually, the cleanest approach for v1: render `PreviewPanel` inside a `div` that hides the toolbar row. `PreviewPanel` already has an iframe that fills its container. We just need to suppress the top toolbar.

- [ ] **Step 1: Create `MobilePreviewPanel`**

```tsx
// client/src/components/mobile/MobilePreviewPanel.tsx
import { RefreshCw } from "lucide-react";
import { useRef } from "react";
import { PreviewPanel } from "@/components/ide/preview-panel";

interface MobilePreviewPanelProps {
  onBack: () => void;
}

export function MobilePreviewPanel({ onBack }: MobilePreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col h-full w-full">
      {/* Preview fills remaining space; PreviewPanel renders its own iframe */}
      <div className="flex-1 min-h-0 overflow-hidden [&_.preview-toolbar]:hidden">
        <PreviewPanel />
      </div>

      {/* Back strip */}
      <div
        className="h-11 flex items-center justify-center border-t border-border/40 bg-[#0c0c14] shrink-0"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground flex items-center gap-1.5 px-4 py-2"
        >
          ← Back to Chat
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Check `PreviewPanel` for a toolbar class we can target**

Open `client/src/components/ide/preview-panel.tsx` and find the top toolbar `<div>`. Add a `preview-toolbar` className to it so our CSS selector `[&_.preview-toolbar]:hidden` works:

In `preview-panel.tsx`, find the toolbar div (around line 390-420, the div containing the RefreshCw button, device selector, etc.) and add `preview-toolbar` to its className. Example — look for:
```tsx
<div className="flex items-center gap-2 px-3 py-2 border-b ...">
```
And add `preview-toolbar` to it:
```tsx
<div className="preview-toolbar flex items-center gap-2 px-3 py-2 border-b ...">
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
npm run check 2>&1 | grep -E "MobilePreview|preview-panel"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/mobile/MobilePreviewPanel.tsx client/src/components/ide/preview-panel.tsx
git commit -m "feat: MobilePreviewPanel — full-bleed preview tab"
```

---

## Task 5: `MobileChatPanel` component

**Files:**
- Create: `client/src/components/mobile/MobileChatPanel.tsx`

The chat panel reuses `ChatPanel` (which already handles all message rendering, streaming, and input). We wrap it and add the floating "▶ Preview" pill.

The pill appears when all tasks in `taskStatuses` are `"done"` and none are `"failed"` or `"bug"`, AND there is at least one task (i.e., a build has completed). Read `taskStatuses` from the IDE store.

- [ ] **Step 1: Create `MobileChatPanel`**

```tsx
// client/src/components/mobile/MobileChatPanel.tsx
import { ChatPanel } from "@/components/ide/chat-panel";
import { ChatErrorBoundary } from "@/components/ide/chat/error-boundary";
import { useIDEStore } from "@/stores/ide-store";

interface MobileChatPanelProps {
  onShowPreview: () => void;
}

export function MobileChatPanel({ onShowPreview }: MobileChatPanelProps) {
  const taskStatuses = useIDEStore((s) => s.taskStatuses);

  const statuses = Object.values(taskStatuses);
  const buildComplete =
    statuses.length > 0 &&
    statuses.every((s) => s === "done") &&
    !statuses.some((s) => s === "failed" || s === "bug");

  return (
    <div className="relative flex flex-col h-full w-full">
      <ChatErrorBoundary>
        <ChatPanel />
      </ChatErrorBoundary>

      {buildComplete && (
        <button
          onClick={onShowPreview}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg flex items-center gap-2 transition-colors"
        >
          <span>▶</span>
          <span>Preview</span>
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npm run check 2>&1 | grep MobileChat
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/mobile/MobileChatPanel.tsx
git commit -m "feat: MobileChatPanel — chat tab with preview pill"
```

---

## Task 6: `MobileIDE` root shell

**Files:**
- Create: `client/src/components/mobile/MobileIDE.tsx`

This component owns: tab state (`"chat" | "preview"`), swipe gesture detection, the header with tab indicators, and mounts the active panel.

- [ ] **Step 1: Create `MobileIDE`**

```tsx
// client/src/components/mobile/MobileIDE.tsx
import { useState, useRef, useCallback } from "react";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { MobileChatPanel } from "./MobileChatPanel";
import { MobilePreviewPanel } from "./MobilePreviewPanel";
import { AgentStreamProvider } from "@/components/ide/AgentStreamProvider";

type Tab = "chat" | "preview";

interface MobileIDEProps {
  projectId: string;
}

export function MobileIDE({ projectId }: MobileIDEProps) {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const { projects } = useProjectStore();
  const project = projects.find((p) => p.id === projectId);

  // Swipe gesture
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;

    // Cancel if more vertical than horizontal (user is scrolling)
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (Math.abs(dx) < 40) return;

    if (dx < 0) setActiveTab("preview"); // left swipe → preview
    else setActiveTab("chat");            // right swipe → chat
  }, []);

  return (
    <AgentStreamProvider>
      <div
        className="h-screen w-screen flex flex-col bg-background overflow-hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Header */}
        <div className="shrink-0 bg-[#0c0c14] border-b border-border/40">
          {/* Row 1: back + project name + framework */}
          <div className="flex items-center gap-2 px-3 h-11">
            <a
              href="/"
              className="text-muted-foreground text-sm shrink-0"
            >
              ←
            </a>
            <span className="text-sm font-semibold text-foreground truncate flex-1">
              {project?.name ?? "Project"}
            </span>
            {project?.framework && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-950 text-blue-400 shrink-0">
                {project.framework}
              </span>
            )}
          </div>

          {/* Row 2: tab indicators */}
          <div className="flex px-4 gap-5 pb-0">
            {(["chat", "preview"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={[
                  "text-sm pb-2 capitalize transition-colors",
                  activeTab === tab
                    ? "text-blue-500 border-b-2 border-blue-500 font-semibold"
                    : "text-muted-foreground",
                ].join(" ")}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Panel area */}
        <div className="flex-1 min-h-0">
          {activeTab === "chat" ? (
            <MobileChatPanel onShowPreview={() => setActiveTab("preview")} />
          ) : (
            <MobilePreviewPanel onBack={() => setActiveTab("chat")} />
          )}
        </div>
      </div>
    </AgentStreamProvider>
  );
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npm run check 2>&1 | grep MobileIDE
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/mobile/MobileIDE.tsx
git commit -m "feat: MobileIDE shell — header, tabs, swipe gesture"
```

---

## Task 7: Wire `MobileIDE` into `IDEPage`

**Files:**
- Modify: `client/src/pages/ide.tsx`

- [ ] **Step 1: Update `ide.tsx`**

Add the `useIsMobile` import and `MobileIDE` import, then gate rendering:

```tsx
import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useIDEStore } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileIDE } from "@/components/mobile/MobileIDE";
import { Navbar } from "@/components/ide/navbar";
import { ToolsDock } from "@/components/ide/tools-dock";
import { FileTree } from "@/components/ide/file-tree";
import { CodeEditor } from "@/components/ide/code-editor";
import { ChatPanel } from "@/components/ide/chat-panel";
import { ChatErrorBoundary } from "@/components/ide/chat/error-boundary";
import { PreviewPanel } from "@/components/ide/preview-panel";
import { ConsolePanel } from "@/components/ide/console-panel";
import { CheckpointPanel } from "@/components/ide/CheckpointPanel";
import { SkillsPanel } from "@/components/ide/skills-panel";
import { SkillsModal } from "@/components/ide/skills-modal";
import type { Skill } from "@/components/ide/skill-types";
import { CommandPalette } from "@/components/ide/command-palette";
import { LLMMonitor } from "@/components/ide/llm-monitor";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useToast } from "@/hooks/use-toast";

export default function IDEPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const { activeTool, isConsoleOpen, toggleSidebar, toggleConsole, activeFile, loadProject, projectId, layoutMode, codeVisible } =
    useIDEStore();
  const userId = useIDEStore((s) => s.projectId ?? "");
  const { projects } = useProjectStore();
  const { toast } = useToast();
  const [skillsModal, setSkillsModal] = useState<{ skill: Skill | null; scope: "user" | "project" } | null>(null);
  const [skillsRefreshKey, setSkillsRefreshKey] = useState(0);

  const project = projects.find((p) => p.id === id);

  useEffect(() => {
    if (!project) {
      navigate("/", { replace: true });
      return;
    }
    if (projectId !== id) {
      loadProject(id!, project?.framework);
    }
    return () => {
      const current = useIDEStore.getState();
      if (current.projectId) {
        current.saveProject();
      }
    };
  }, [id, project, projectId, loadProject, navigate]);

  // Desktop-only keyboard shortcuts
  useEffect(() => {
    if (isMobile) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        toast({
          title: "File saved",
          description: activeFile ? activeFile.split("/").pop() : "All files saved",
          duration: 1500,
        });
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        toggleConsole();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeFile, toggleSidebar, toggleConsole, toast, isMobile]);

  if (!project || projectId !== id) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading project...</div>
      </div>
    );
  }

  // Mobile: render the new mobile shell
  if (isMobile) {
    return <MobileIDE projectId={id!} />;
  }

  // Desktop: unchanged layout below
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background" data-testid="ide-page">
      <Navbar projectName={project.name} />
      <CommandPalette />

      <div className="flex-1 min-h-0 flex">
        <ToolsDock />

        <div className="flex-1 min-w-0 p-1.5 bg-sidebar">
          <ResizablePanelGroup direction="horizontal" className="h-full gap-1.5">
            {activeTool && (
              <>
                <ResizablePanel
                  defaultSize={20}
                  minSize={15}
                  maxSize={40}
                  id="tool-panel"
                  order={1}
                  className="bg-background rounded-lg border border-border/60 overflow-hidden"
                >
                  {activeTool === "files" && <FileTree />}
                  {activeTool === "chat" && <ChatErrorBoundary><ChatPanel /></ChatErrorBoundary>}
                  {activeTool === "history" && <CheckpointPanel />}
                  {activeTool === "skills" && (
                    <SkillsPanel
                      onEdit={(skill, scope) => setSkillsModal({ skill, scope })}
                      refreshKey={skillsRefreshKey}
                    />
                  )}
                </ResizablePanel>
                <ResizableHandle className="w-[3px] bg-transparent hover:bg-primary/10 [transition:var(--transition-fast)]" />
              </>
            )}

            <ResizablePanel defaultSize={activeTool ? 80 : 100} minSize={30} id="workspace" order={2}>
              <ResizablePanelGroup direction="vertical" className="gap-1.5">
                <ResizablePanel defaultSize={isConsoleOpen ? 75 : 100} minSize={30} id="editor-preview-area" order={1}>
                  <ResizablePanelGroup direction="horizontal" className="gap-1.5">
                    {codeVisible && (
                      <>
                        <ResizablePanel
                          defaultSize={layoutMode === "preview" ? 35 : 50}
                          minSize={20}
                          id="editor-pane"
                          order={1}
                          className="bg-background rounded-lg border border-border/60 overflow-hidden [transition:var(--transition-slow)]"
                        >
                          <CodeEditor />
                        </ResizablePanel>
                        <ResizableHandle className="w-[3px] bg-transparent hover:bg-primary/10 [transition:var(--transition-fast)]" />
                      </>
                    )}
                    <ResizablePanel
                      defaultSize={codeVisible ? (layoutMode === "preview" ? 65 : 50) : 100}
                      minSize={20}
                      id="preview-pane"
                      order={2}
                      className="bg-background rounded-lg border border-border/60 overflow-hidden"
                    >
                      <PreviewPanel />
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </ResizablePanel>

                {isConsoleOpen && (
                  <>
                    <ResizableHandle className="h-[3px] bg-transparent hover:bg-primary/10 [transition:var(--transition-fast)]" />
                    <ResizablePanel
                      defaultSize={25}
                      minSize={10}
                      maxSize={60}
                      id="console-pane"
                      order={2}
                      className="bg-background rounded-lg border border-border/60 overflow-hidden"
                    >
                      <ConsolePanel />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
      <LLMMonitor />
      {skillsModal && (
        <SkillsModal
          skill={skillsModal.skill}
          scope={skillsModal.scope}
          userId={userId}
          onClose={() => setSkillsModal(null)}
          onSaved={() => { setSkillsModal(null); setSkillsRefreshKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/ide.tsx
git commit -m "feat: wire MobileIDE into IDEPage behind useIsMobile gate"
```

---

## Task 8: Manual smoke test

No automated tests exist in this project (see CLAUDE.md). Verification is manual.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test mobile layout**

Open Chrome DevTools → toggle device toolbar → select iPhone 14 (390px wide). Navigate to a project at `/project/:id`.

Expected:
- Mobile header shows back arrow, project name, framework tag
- Two tab indicators: "chat" (active, blue underline) and "preview"
- Chat panel fills the screen with message input pinned to bottom
- After a build completes with all tasks `done`, a "▶ Preview" floating pill appears centered above the input
- Tapping "preview" tab shows the preview iframe full-bleed
- A "← Back to Chat" strip at the bottom switches back
- Swiping left (≥40px horizontal) switches to preview; swiping right switches back to chat

- [ ] **Step 3: Test desktop layout is unchanged**

In the same browser, disable device toolbar (full desktop width). Navigate to the same project.

Expected:
- Navbar, dock, resizable panels all render exactly as before
- No visual regressions

- [ ] **Step 4: Test PWA installability**

In Chrome on a real phone (or Chrome DevTools → Application → Manifest), verify:
- Manifest is loaded: name "Cascade AI", theme color `#08080e`
- Icons resolve (no 404)
- "Add to Home Screen" prompt appears (or is installable via Application tab)

- [ ] **Step 5: Fix any issues found, then commit**

```bash
git add -p  # stage only changed files
git commit -m "fix: mobile smoke test corrections"
```

---

## Verification Checklist

- [ ] `npm run check` — 0 TypeScript errors
- [ ] Mobile layout renders on ≤768px viewport (Chrome DevTools device mode)
- [ ] Desktop layout completely unchanged on >768px
- [ ] Swipe left/right switches tabs without interfering with vertical scroll
- [ ] Floating pill visible only after all tasks are `done`
- [ ] Preview tab shows full-bleed iframe (no device frame chrome)
- [ ] "← Back to Chat" strip returns to chat tab
- [ ] PWA manifest loads with correct name, icons, theme color
- [ ] Service worker registers in browser Application tab
