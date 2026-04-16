# SwiftWasm Toolchain Installation

## What & Why
The SwiftUI Web Preview feature (Task #123) was implemented with full compilation pipeline code, but the Swift/SwiftWasm toolchain is not installed in the Replit environment. Without it, the preview panel falls back to static code display with a "compiler not available" warning. This task installs and configures the SwiftWasm toolchain so that SwiftUI projects can compile to WebAssembly and render live previews in the browser — matching the Kotlin/Compose preview experience.

## Done looks like
- Opening a SwiftUI project (e.g. the "iOS计算器" calculator) shows a live rendered preview in the preview panel, not just static code
- The `POST /api/compile/swift-wasm` endpoint successfully compiles Swift source files to `.wasm` and returns a working `buildId`
- The preview iframe loads the compiled WebAssembly and renders the SwiftUI view hierarchy in the browser
- A setup script (`scripts/setup-swift-wasm.sh`) handles toolchain installation, similar to the existing `scripts/setup-gradle.sh` for Kotlin
- The toolchain persists across server restarts (installed to a stable path like `~/.swift-wasm-sdk/`)
- The `SWIFT_WASM_PATH` environment variable or default path is correctly configured so `isSwiftWasmAvailable()` returns true

## Out of scope
- Expanding the SwiftUIWeb DOM renderer to support more SwiftUI views (that's the existing `SwiftUIWeb` library from Task #123)
- Modifying the compilation pipeline logic in `swift-wasm-compiler.ts` (already implemented)
- Performance optimization of the Wasm output

## Tasks
1. **Research and select the correct SwiftWasm release** — Identify the right Swift toolchain version with Wasm support for Ubuntu 24.04 x86_64. The compiler must support `swift build --triple wasm32-unknown-wasi`. Consider using the official Swift 6.0+ releases with built-in Wasm support, or the SwiftWasm project releases if the official toolchain doesn't include Wasm target yet.

2. **Create the setup script** — Write `scripts/setup-swift-wasm.sh` that downloads, extracts, and installs the Swift/Wasm toolchain to a stable user-local path (e.g. `~/.swift-wasm-sdk/`). The script should be idempotent (skip if already installed), verify the installation works by running `swift --version`, and handle errors gracefully. Follow the same pattern as `scripts/setup-gradle.sh`.

3. **Configure the environment** — Update `SWIFT_WASM_PATH` default or set the environment variable so that `swift-wasm-compiler.ts` finds the installed toolchain. Ensure the `post-merge.sh` or workflow startup calls the setup script so the toolchain is present when the server starts.

4. **Verify end-to-end compilation** — Test that the full pipeline works: send Swift files to the compile endpoint, confirm it produces a valid `.wasm` artifact, and verify the preview iframe renders the compiled output.

## Relevant files
- `server/swift-wasm-compiler.ts`
- `server/compile-templates/swift-wasm/Package.swift`
- `scripts/setup-gradle.sh`
- `scripts/post-merge.sh`
- `server/routes.ts:2041-2086`
