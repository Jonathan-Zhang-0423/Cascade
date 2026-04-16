---
title: Kotlin/Compose Web Preview via Wasm Compilation
---
# Kotlin/Compose Web Preview via Wasm Compilation

  ## What & Why
  Implement live web-based preview for Kotlin/Jetpack Compose projects by compiling user code to WebAssembly using Compose Multiplatform + Kotlin/Wasm. Currently, Kotlin projects only show a static code viewer with syntax highlighting. This task replaces that with a real, interactive preview rendered natively in the browser via WebAssembly — matching the product spec's "Scheme 3: Native Code Compilation for Web" approach.

  This is the highest-priority web preview path because Compose Multiplatform for Web is in Beta (since Sep 2025) with strong ecosystem support and all modern browsers supporting WasmGC.

  Additionally, update `replit.md` with the full product specification and new architecture direction.

  ## Done looks like
  - When a user opens a Kotlin/Compose project in the IDE, the preview panel shows a live, interactive rendering of their Compose UI running in the browser via WebAssembly — not just static code
  - The preview updates when the user's code changes (with a compilation step happening transparently in the background)
  - Compilation errors are surfaced clearly in the preview panel, with a button/option to ask the AI to fix the errors automatically
  - The preview renders inside the existing DeviceSimulator frame with the Android device chrome
  - The existing code-preview fallback remains available if compilation fails, alongside the "Ask AI to fix" action
  - `replit.md` is updated with the full product specification covering: web client scheme (Kotlin/Wasm + SwiftWasm), mobile client scheme (Android dynamic compilation + iOS DSL parsing), research findings, and implementation phases

  ## Out of scope
  - SwiftUI/Swift web preview (separate task)
  - Mobile native clients (Android/iOS apps)
  - Hot module replacement (HMR) — full recompilation on each change is acceptable initially
  - Multi-file Compose projects with complex Gradle dependencies beyond the standard Compose Multiplatform libraries
  - Production deployment of the compilation service (dev/preview environment only for now)
  - Compiling indicator UI — compilation happens silently in the background

  ## Tasks
  1. **Product spec in replit.md** — Update `replit.md` with the full product technical specification covering: web client scheme (Kotlin/Wasm + SwiftWasm), mobile client scheme (Android dynamic compilation + iOS DSL parsing), research findings, implementation phases, and development priority.

  2. **Server-side Kotlin/Wasm compilation endpoint** — Add a `POST /api/compile/kotlin-wasm` endpoint that accepts Kotlin source files, writes them into a Compose Multiplatform project template, runs the Kotlin/Wasm compiler (via Gradle), and returns the compiled `.wasm` + `.js` artifacts. Include structured compilation error reporting in the response.

  3. **Compose Multiplatform project template** — Create a minimal Compose Multiplatform for Web template in `server/compile-templates/kotlin-wasm/` with `build.gradle.kts`, `settings.gradle.kts`, and a placeholder `Main.kt` that gets replaced with user code. The template should target `wasmJs { browser() }` and include Compose runtime + foundation + material3 dependencies.

  4. **Preview adapter update** — Add a new preview mode `"kotlin-wasm"` to `preview-adapters.ts`. Update the Kotlin framework mapping from `"code-preview"` to `"kotlin-wasm"`. The preview panel should render compiled Wasm output in an iframe via a served HTML page that loads the `.wasm` + `.js` artifacts.

  5. **Wasm preview viewer component** — Create a `WasmPreview` component that: triggers compilation when files change (debounced), renders the compiled output in a sandboxed iframe, displays compilation errors inline with a "Ask AI to fix" button that sends the errors to the chat/agent for automatic debugging, and falls back to code-preview if compilation is unavailable.

  6. **Compilation caching and artifact serving** — Add a route `GET /api/compile/artifacts/:buildId/*` that serves compiled Wasm artifacts. Cache compilation results keyed by a hash of the source files to avoid redundant recompilation.

  7. **Gradle/Kotlin SDK installation** — Ensure the server environment has Kotlin 2.1+ and Gradle installed and configured for Kotlin/Wasm compilation. Add setup scripts or Nix packages as needed.

  ## Relevant files
  - `client/src/lib/preview-adapters.ts`
  - `client/src/components/ide/preview-panel.tsx`
  - `client/src/components/ide/code-preview.tsx`
  - `server/routes.ts`
  - `server/templates/kotlin-template.ts`
  - `server/framework-detector.ts`
  - `replit.md`