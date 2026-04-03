# CodeStart — Mobile-First AI Development Platform

## Overview
CodeStart is a mobile-first development platform designed to enable complete beginners to build production-ready iOS and Android applications using AI coding agents. It supports multiple mobile frameworks (React Native/Expo, Flutter, SwiftUI, Kotlin/Jetpack Compose) and languages (TypeScript, Dart, Swift, Kotlin). Users interact with a "Vibe Coding Agent" through natural language and can preview apps in a device simulator. The platform supports isolated projects, each with its own files, chat history, and preview. The project is pivoting from a web IDE to a mobile-first focus, while maintaining support for existing web projects (HTML/CSS/JS).

## User Preferences
The user wants an AI assistant that:
- Demands clarity from the user.
- Confirms understanding before building.
- Avoids jargon in explanations and code comments.
- Follows an iterative development approach.
- Includes 1-3 emojis in approximately 90% of responses to maintain a warm and friendly tone.
- Provides beginner-friendly, no-jargon inline comments on every line of generated code, matching the user's language.

## System Architecture
The CodeStart IDE utilizes a modern web architecture with distinct frontend and backend components.

**Frontend**:
- Built with React, TypeScript, Tailwind CSS, and Shadcn UI, focusing on a responsive and visually appealing dark-themed interface with rounded elements and clean spacing.
- State management is handled by Zustand, with project data persisted locally.
- The code editor is powered by `@monaco-editor/react`.
- Features a unified theme system with 14 VS Code-style themes managed globally.
- The UI layout includes a tools dock, resizable panels, an editor, a preview pane, and a console.

**Backend**:
- An Express.js server manages API routes for AI interactions and agent communication.

**Core Features & Design Patterns**:
- **Multi-Project System**: Users can manage multiple isolated projects, each with its own state.
- **AI-Driven Development**: The Vibe Coding Agent facilitates app creation through natural language, using a streaming API for real-time code generation and application.
- **Incremental Code Auto-Apply**: AI-generated code blocks are automatically applied to files as they stream, updating the preview instantly.
- **Structured AI Output**: AI responses follow a 3-part format: Thinking, Code, and Changes Summary.
- **Checkpoint/Rollback System**: Automatic checkpoints are created after AI changes, allowing project state restoration using reverse diffs.
- **4-Agent System (Plan Mode)**:
    - **Manager Agent**: Handles conversational planning, brainstorming, and generates structured task plans or fix plans.
    - **Editor Agent**: Executes code tasks as part of the plan.
    - **Verifier Agent**: Conducts holistic project reviews, identifying bugs, missing features, or regressions.
    - **Communicator Agent**: Provides user-facing progress updates and narration in real-time, acting as the sole user interface for agent output.
    - This system orchestrates a Plan → Build → Review → Fix cycle, with user confirmation for subjective issues.
- **Performance Optimizations**: Includes non-blocking communication, optimized `max_tokens` usage for AI models, filtered conversation history, throttled streaming UI updates, and sending only relevant files to the Editor agent.
- **My Coding Notebook / Learner Space**:
    - **Mentor Agent**: Analyzes project files to generate structured learning content (project summary, file breakdowns, mind map, learning tips).
    - Features a toggle between "Workspace" and "Learner Space" with auto-generation of notebooks.
    - Supports two-tier incremental updates: auto-patching for minor changes and user-initiated optimization for deeper refinement.
- **LLM Output Monitor**: A non-modal floating panel displaying real-time, color-coded, source-labeled events from LLM interactions, with pub/sub event bus and batching.
- **Background Build Persistence**: Server-side builds continue independently of client connection, with reconnection support and event buffering. Manager-chat sessions now also have server-side tracking with session IDs, event buffering, and reconnection support. Build sessions are NOT killed on project exit — they continue server-side and the client reconnects on return. Done sessions are retained for 30 minutes.
- **Streaming State Persistence**: StreamingSnapshot is persisted to localStorage during active SSE streams (both manager-chat and build-session), enabling UI state restoration and session reconnection after page reload or HMR. Session IDs are saved before cleanup on unmount to enable reliable reconnection. All stream hooks use `isUnmountingRef` guards to prevent `finally` blocks from clearing persisted recovery state during component teardown.
- **DB-backed Plan & Build Result Persistence**: Completed plans are persisted to the `projects.last_plan` column on `plan_ready`, and build results to `projects.last_build_result` on `all_complete`. When a user returns to a project and the server session has expired, the client falls back to restoring the plan from DB via `GET /api/projects/:id/plan`. Build completion triggers file sync only if the user is still viewing the same project.
- **Chat Panel Modular Architecture**: The chat panel (`chat-panel.tsx`, ~960 lines) is a thin orchestrator that delegates to composable hooks and modules under `client/src/components/ide/chat/`:
    - `hooks/useSSEStream.ts`: Reusable SSE parsing (`parseSseStream`), heartbeat watchdog, and reconnect controller utilities
    - `hooks/useManagerStream.ts`: Manager chat SSE flow, plan preparation, communicator integration, and manager reconnection logic
    - `hooks/useBuildStream.ts`: Build session SSE flow, build phase tracking, action log accumulation, heartbeat watchdog, and build reconnection logic
    - `chat-types.ts`: Shared types (including `terminal_command` action type), constants, and i18n strings
    - `chat-utils.tsx`: Pure utility functions (language detection, code parsing, tokenization, markdown rendering)
    - `action-log.tsx`: Action log with grouped consecutive tool calls (count badges, collapsible expand), live/collapsed/chip views
    - `message-components.tsx`: Chat message bubbles with "Show more" truncation (~15 lines/600 chars), code blocks, checkpoint markers, completion cards
    - `plan-components.tsx`: Plan card, step items, review badges, manager message bubbles with narration truncation
    - `BuildPhaseIndicator.tsx`: Build phase pill/badge (Thinking/Working/Verifying/Fixing) with animated icons
    - `error-boundary.tsx`: React ErrorBoundary wrapping the chat panel to prevent white-screen crashes
- **Framework-Aware Preview Adapters**: Provides specialized preview modes for different frameworks (iframe for Web, Expo Snack for React Native, DartPad for Flutter, Kotlin/Wasm live preview for Kotlin/Compose, static code preview with download for SwiftUI). Includes a zip export feature.
- **Native Code Compilation to Web (Scheme 3)**: Compiles native UI code to WebAssembly for real native browser preview. Kotlin/Compose uses Compose Multiplatform + Kotlin/Wasm (Beta, most viable path). SwiftUI uses SwiftWasm + JavaScriptKit (Tokamak is archived — JavaScriptKit is the active replacement).
- **Live HTML Preview**: Inlines local HTML, CSS, and JS, capturing console output.
- **QR Code Phone Preview**: A local preview server serves project files with live reload via WebSockets, accessible on mobile devices via a QR code. Sessions are token-scoped and auto-expire.
- **Command Palette**: Provides quick access to actions.

## External Dependencies
- **AI Providers**:
    - Doubao (ByteDance/Volcengine) using `doubao-seed-2-0-code-preview-260215` (default) and `doubao-seed-2-0-lite-260215` (Mentor Agent).
    - Kimi K2.5 (Moonshot AI) using `kimi-k2.5` (selectable via toggle).
- **Code Editor**: `@monaco-editor/react`.
- **State Management**: Zustand.
- **UI Components**: Shadcn UI.
- **Icons**: Lucide-react.
- **Resizable Panels**: `react-resizable-panels`.
- **Routing**: wouter.
- **API Client**: `openai` (used with Doubao's API endpoint).
- **Kotlin/Wasm Compilation**: Gradle 8.10, Kotlin 2.1+ (via Compose Multiplatform plugin), Compose for Web runtime.
- **SwiftUI/Wasm Compilation**: Swift 6.1 toolchain + SwiftWasm SDK for `wasm32-unknown-wasi`, JavaScriptKit 0.21.0. Setup via `scripts/setup-swift-wasm.sh`.

## Product Specification — Native Code Compilation to Web

### Strategy
The product follows "Scheme 3: Native Code Compilation for Web" — compiling native UI code (Kotlin/Compose, SwiftUI) to WebAssembly for real native browser preview, rather than using cloud simulators (Appetize.io) or DSL-to-HTML translation.

### Web Client Preview Paths
- **Web (HTML/CSS/JS)**: iframe-preview with inlined assets
- **React Native/Expo**: Expo Snack embed
- **Flutter/Dart**: DartPad embed
- **Kotlin/Compose**: Compile to WebAssembly via Compose Multiplatform + Kotlin/Wasm. Server-side Gradle build produces `.wasm` + `.js` artifacts rendered on HTML canvas in browser. All modern browsers support WasmGC. ~3x faster than JS interpretation.
- **SwiftUI**: (Phase 2) Compile to WebAssembly via SwiftWasm (first-class in Swift 6.1+) + JavaScriptKit for Swift↔DOM bridge. Tokamak is **ARCHIVED** — JavaScriptKit (v0.46.5+, active) is the replacement. Requires custom SwiftUI-subset-to-DOM translation layer.

### Mobile Client Scheme (Future)
- **Android**: Dynamic Kotlin compilation on-device using Kotlin Scripting API + Compose runtime. Hot-reload capable.
- **iOS**: DSL interpretation layer (not full compilation due to App Store JIT restrictions). Parse SwiftUI-like DSL and render via native UIKit/SwiftUI components.

### Research Findings (April 2026)
- Kotlin/Wasm: Compose Multiplatform for Web reached Beta (Sep 2025). Most viable path. Kotlin 2.1+ required for WasmGC target.
- SwiftWasm: Officially upstreamed to swiftlang/swift in Swift 6.1+. First-class WASI support.
- Tokamak (SwiftUI→Web): **ARCHIVED/DEAD** as of early 2025. Do not use.
- JavaScriptKit: Active (v0.46.5+), provides Swift↔JavaScript interop over WASM. Use for DOM manipulation from Swift.
- Appetize.io: Cloud simulator option evaluated but NOT chosen per spec (too expensive, latency, dependency on third party).

### Implementation Phases
1. **Phase 1 (Complete)**: Kotlin/Wasm compilation service + client runner. Server-side Gradle compilation, artifact caching, WasmPreview component with error display and "Ask AI to Fix" integration.
2. **Phase 2 (Complete)**: SwiftUI/WASM compilation + JavaScriptKit DOM bridge. SwiftUI-subset renderer (Text, VStack, HStack, ZStack, Button, List, NavigationStack, Spacer, Divider, ScrollView, common modifiers). Server-side Swift/SwiftWasm compilation, artifact caching, unified WasmPreview component supporting both Kotlin and Swift.
3. **Phase 3**: Mobile native clients (Android dynamic compilation, iOS DSL parsing).

### Kotlin/Wasm Compilation Architecture
- **Template**: `server/compile-templates/kotlin-wasm/` — Compose Multiplatform project targeting `wasmJs { browser() }` with Material3
- **Compiler**: `server/kotlin-wasm-compiler.ts` — accepts source files, injects into template, runs Gradle `wasmJsBrowserDistribution`, returns artifacts
- **Endpoints**: `POST /api/compile/kotlin-wasm` (compile), `GET /api/compile/artifacts/:buildId/*` (serve), `GET /api/compile/status` (availability)
- **Caching**: Source hash → build artifacts, 30-minute TTL, avoids recompilation for identical sources
- **Frontend**: `WasmPreview` component triggers compilation on file change (debounced 1.5s), renders in sandboxed iframe, shows errors with "Ask AI to Fix" button via `setPendingPrompt`
- **Fallback**: If compiler unavailable or compilation fails, falls back to CodePreview (syntax-highlighted code viewer with download)
- **Preview Mode**: `kotlin-wasm` in preview-adapters.ts, mapped from `kotlin` framework

### SwiftUI/Wasm Compilation Architecture
- **Template**: `server/compile-templates/swift-wasm/` — SwiftPM project with JavaScriptKit dependency and SwiftUI-subset DOM renderer library (`SwiftUIWeb`)
- **SwiftUI-subset Renderer**: `Sources/SwiftUIWeb/` — Provides SwiftUI-like API types (Text, VStack, HStack, ZStack, Button, Image, List, NavigationStack, ScrollView, Spacer, Divider, Group) with modifiers (.padding, .foregroundColor, .background, .font, .frame, .cornerRadius, .border, .opacity, .shadow, .navigationTitle, .bold, .italic, .lineLimit) that render to HTML/CSS DOM elements via JavaScriptKit
- **Compiler**: `server/swift-wasm-compiler.ts` — accepts Swift source files, transforms `import SwiftUI` to `import SwiftUIWeb`, strips iOS-specific imports, injects into template, runs Swift build targeting `wasm32-unknown-wasi`, returns `.wasm` + `.js` artifacts
- **Endpoints**: `POST /api/compile/swift-wasm` (compile), artifacts served via shared `GET /api/compile/artifacts/:buildId/*`, status at `GET /api/compile/status`
- **Caching**: Same pattern as Kotlin — source hash → build artifacts, 30-minute TTL, max 50 entries, max 2 concurrent compiles
- **Frontend**: Unified `WasmPreview` component handles both Kotlin and Swift — detects framework, uses correct endpoint and file extension (.kt/.swift), shows appropriate labels and accent colors
- **Fallback**: If Swift toolchain unavailable or compilation fails, falls back to CodePreview with "Ask AI to Fix" button
- **Preview Mode**: `swift-wasm` in preview-adapters.ts, mapped from `swiftui` framework
- **Requires**: Swift 6.1+ toolchain with SwiftWasm SDK installed at `SWIFT_WASM_PATH` env var (default `~/.swift-wasm-sdk/swift-6.1-RELEASE-ubuntu24.04/usr/bin/swift`). Run `bash scripts/setup-swift-wasm.sh` to install. SDK ID configurable via `SWIFT_WASM_SDK_ID` env var (default `wasm32-unknown-wasi`).