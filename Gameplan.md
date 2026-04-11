# CodeStart — Development Gameplan

## Project Overview
A **mobile-first AI coding platform** that lets complete beginners build production-ready iOS and Android apps through AI conversation. The AI generates real framework code; a browser-based device simulator shows a live preview inside a realistic phone frame — critical for iOS users since Apple clause 2.5.2 forbids compiling/running native apps inside an app.

**Current milestone:** Get the React Native browser preview simulator working end-to-end, then iterate to Flutter, Kotlin/Compose, and eventually SwiftUI.

**UI/UX milestone (added 2026-04-08, complete 2026-04-10):** Integrate competitive UI/UX patterns from leading coding agents (Bolt.new, Lovable, Replit Agent, v0): diff view, checkpoint history UI, preview-first layout, inline step progress polish, and hide-code toggle. All 5 subtasks shipped. Additional chat UI improvements also shipped: branded loader, multi-icon action strips, elapsed time indicators, agent narration language overhaul, and a critical message-disappearance bug fix.

**Agent stream & ordering milestone (2026-04-11, in progress):** Hoist `useManagerStream`/`useBuildStream` to App-root singleton (`AgentStreamProvider`) so SSE streams survive navigation. Also implementing monotonic `seq` counter for reliable cross-array message ordering (steps 7–10 still pending).

---

## Actual Tech Stack (as built)
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + Radix UI (shadcn) |
| State | Zustand + localStorage persistence |
| Editor | @monaco-editor/react |
| Backend | Express 5 + TypeScript (tsx) |
| Database | PostgreSQL + Drizzle ORM |
| AI providers | Doubao (default), Kimi K2.5, MiniMax, GLM-4 |
| Routing | Wouter |
| Build | esbuild (vendor bundle) + Babel (RN transform) |
| Deploy | Self-hosted VPS |

---

## Preview Simulator Strategy (decided 2026-04-07)

| Framework | Language | Preview Approach | Status |
|-----------|----------|-----------------|--------|
| Web | HTML/CSS/JS | Direct iframe | ✅ Working |
| React Native | TypeScript | Babel → react-native-web → iframe | 🟡 Partially working — core apps render; edge cases remain |
| Flutter | Dart | DartPad embed + flutter build web (when SDK installed) | 🔴 Broken |
| Kotlin | Kotlin | Kotlin/Wasm + Compose Multiplatform → Skia canvas | 🔴 Broken (wrong pipeline) |
| SwiftUI | Swift | SHELVED — code view only for now | ⏸ Shelved |

**Key constraint:** iOS App Store clause 2.5.2 forbids compiling and running native app code inside an app. Browser-based simulator is the compliant alternative.

---

## Current Architecture

```
client/src/
  stores/
    ide-store.ts               - All IDE state: files, chat, devices, preview, sessions
    project-store.ts           - Project CRUD, dashboard state
  components/ide/
    navbar.tsx                  - Header: project name, framework badge, space toggle
    tools-dock.tsx              - Vertical icon dock
    file-tree.tsx               - File explorer with CRUD
    code-editor.tsx             - Monaco + tab management
    chat-panel.tsx              - AI chat coordinator
    chat/hooks/
      useManagerStream.ts       - Plan mode (Manager agent) SSE stream handler
      useBuildStream.ts         - Build mode (Editor agent) SSE stream handler
    preview-panel.tsx           - Preview coordinator + device controls + QR
    device-simulator.tsx        - Phone/tablet frame chrome (iOS/Android)
    rn-web-preview.tsx          - React Native → Babel → iframe
    flutter-web-preview.tsx     - Flutter → flutter build web → iframe
    wasm-preview.tsx            - WASM preview (Swift/Kotlin — shelved/broken)
    code-preview.tsx            - Syntax-highlighted code fallback
  lib/
    preview-adapters.ts         - Framework → preview mode mapping
    device-specs.ts             - Device presets (iPhone, Android, custom)
    i18n.ts                     - EN/ZH language toggle

server/
  routes.ts                     - All API endpoints (~2400 lines)
  rn-web-compiler.ts            - Babel transform + esbuild vendor bundle
  flutter-compiler.ts           - flutter build web spawner
  swift-wasm-compiler.ts        - SHELVED
  kotlin-wasm-compiler.ts       - BROKEN (needs Compose Multiplatform pipeline)
  templates/                    - Project scaffolds per framework
  skills/                       - AI skill files per framework
  preview-server.ts             - Live reload server (WebSocket + QR)

shared/
  schema.ts                     - Drizzle schema: users, projects, projectFiles
```

---

## Known Broken Items (ordered by priority)

### P0 — React Native Preview (largely fixed 2026-04-09/10)
- ✅ SafeAreaProvider now provides zero insets immediately (was blocking child render)
- ✅ codegenNativeComponent stub now returns React.forwardRef wrapping div (was returning null)
- ✅ CSSStyleDeclaration indexed setter suppressed via HTMLElement.prototype style Proxy
- ✅ PanGestureHandler, State, Directions added to gesture-handler stub
- ✅ Chat message ordering fixed (sort by seq, not timestamp)
- 🟡 Remaining: some complex multi-file RN apps with unusual package deps may still blank

### P1 — Flutter Preview
1. No Flutter SDK on server → 503 → falls back to code view (not DartPad)
2. DartPad fallback not implemented (should render single-file Dart instantly)
3. When Flutter SDK IS installed: pubspec handling needs improvement for multi-package projects

### P2 — Kotlin Preview
1. Current Gradle pipeline targets `wasm32-unknown-wasi` — produces CLI WASM, not UI
2. Needs replacement: Kotlin/Wasm + Compose Multiplatform (`gradle wasmJsBrowserDistribution`)
3. Requires Kotlin 2.0+ and compose-multiplatform Gradle plugin

### P3 — SwiftUI Preview (SHELVED)
- Apple SwiftUI cannot render in browser (tied to UIKit/CoreGraphics)
- Tokamak (open-source SwiftUI-compatible renderer) is the only viable path
- Shelved until RN/Flutter/Kotlin are working

---

## Key Architectural Decisions

1. **Browser simulator over native emulator** — Required by iOS App Store clause 2.5.2; also avoids needing Xcode/Android Studio
2. **Server-side compilation** — Babel for RN (fast, ~500ms), flutter build web for Flutter (slow, 2-5min cold), Kotlin/Wasm for Compose
3. **Artifact cache** — All compilers cache by content hash; server restart loses cache but not DB files
4. **Dual AI modes** — Build mode (single-shot editor agent) and Plan mode (manager → multi-step executor → verifier)
5. **Multiple AI providers** — Doubao default; Kimi, MiniMax, GLM as alternatives; all OpenAI-compatible API
6. **localStorage + DB persistence** — Files saved to DB; chat/device/session state in localStorage per project
7. **Real production code generation** — AI generates real RN/Flutter/Kotlin code; preview handles compatibility best-effort
8. **DartPad as Flutter fallback** — When no Flutter SDK on server, embed DartPad iframe for instant single-file preview
9. **Preview-first UX** — Device simulator should be the dominant panel; code editor secondary. Inspired by Lovable's approach of hiding complexity for beginners.
10. **Checkpoint-based undo** — Every build completion creates a checkpoint; users must be able to browse and restore past checkpoints via UI.

---

## MP-14: COMPETITIVE UI/UX PATTERNS
============================================================
Status: COMPLETE ✅ (2026-04-10)
Priority: HIGH (user experience / retention)
Depends on: nothing (all backend logic already existed)
Informed by: Competitive analysis of Bolt.new, Lovable, Replit Agent, v0 (2026-04-08)

All 5 subtasks shipped. See Progress.txt Tasks #139–#148 for details.

### 14-A: Checkpoint History Panel ✅
  [x] CheckpointPanel.tsx — list in reverse order, label, timestamp, file count, restore with confirm
  [x] History icon added to tools-dock; panel opens as side panel
  [x] "Before build" checkpoint in handleExecutePlan + "Build complete" in useBuildStream

### 14-B: Diff View Tab ✅
  [x] diff npm package (diffLines)
  [x] InlineDiffView.tsx — unified diff, colored +/- lines, max-h scrollable
  [x] GitCompare icon on file_write ActionLogChip entries — click to expand inline diff
  [x] Old file content captured before applyCodeBlock; stored in lastBuildFileDiffs

### 14-C: Preview-First Layout Toggle ✅
  [x] layoutMode: "preview" | "code" in ide-store.ts (persisted)
  [x] Code/Monitor toggle buttons in navbar.tsx
  [x] Preview mode: editor 35% / simulator 65%; Code mode: 50/50

### 14-D: Inline Step Progress Polish ✅
  [x] Multi-icon strip on GroupedActionRow (up to 3 icons)
  [x] animate-in fade-in duration-200 on ActionLogLiveRow and ActionLogChip
  [x] requestAnimationFrame yield in useBuildStream.ts (thinking_token, narration_token)

### 14-E: Hide Code Toggle ✅
  [x] codeVisible: boolean in ide-store.ts (persisted)
  [x] EyeOff/Eye toggle in navbar.tsx
  [x] Editor column conditionally rendered; simulator fills full width when hidden

---

## MP-15: AGENT STREAM SURVIVAL & MESSAGE ORDERING
============================================================
Status: COMPLETE ✅ (2026-04-11)
Priority: HIGH (reliability / correctness)
Depends on: nothing

### 15-A: AgentStreamProvider — streams survive navigation ✅ (Task #150)
  [x] AgentStreamProvider.tsx — singleton context at App root
  [x] App.tsx — wrapped Router with AgentStreamProvider
  [x] chat-panel.tsx — consumes useAgentStream() instead of direct hook calls
  Goal: navigate to dashboard and back without aborting SSE streams

### 15-B: Monotonic seq for message ordering ✅ (Task #151)
  [x] seq: number on ChatMessage and ManagerMessage interfaces
  [x] _nextSeq in IDEState + initial state
  [x] addChatMessage / addManagerMessage assign seq
  [x] createCheckpoint uses consecutive seq values
  [x] ChatMessageList passes seq on inline checkpoint objects
  [x] Step 7 — loadProject migration: backfill seq on old persisted messages (timestamp order), compute finalNextSeq
  [x] Step 8 — saveBuildResult: plan message keeps its original seq (correct — position fixed at plan creation)
  [x] Step 9 — ChatMessageList sort by seq (a.msg.seq - b.msg.seq fallback a.order - b.order)
  [x] Step 10 — persist _nextSeq in localStorage
  [x] Fix seq:0 placeholders in useManagerStream.ts wrong-project localStorage fallback paths
