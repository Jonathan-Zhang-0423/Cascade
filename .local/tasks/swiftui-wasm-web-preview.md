# SwiftUI Web Preview via SwiftWasm Compilation

  ## What & Why
  Implement live web-based preview for SwiftUI projects by compiling user code to WebAssembly using SwiftWasm + JavaScriptKit. Currently, SwiftUI projects only show a static code viewer with syntax highlighting. This task replaces that with a real, interactive preview rendered in the browser via WebAssembly.

  The original product spec proposed Tokamak as the SwiftUI-to-Web bridge, but Tokamak has been archived and is no longer maintained (last release 3+ years ago). The recommended replacement is JavaScriptKit — an actively maintained library (v0.46.5+) that provides Swift-to-JavaScript/DOM interop via WASM. Since SwiftWasm is now first-class in Swift 6.1+ (officially upstreamed to swiftlang/swift), the compilation path is solid; the challenge is the rendering layer.

  **Approach**: Build a lightweight SwiftUI-subset-to-DOM renderer using JavaScriptKit. The renderer translates a core subset of SwiftUI views (Text, VStack, HStack, ZStack, Button, Image, List, NavigationStack, Spacer, Divider, modifiers like .padding, .foregroundColor, .background, .font, .frame) into HTML/CSS DOM elements. This gives users a genuine interactive preview of their SwiftUI code running as compiled Swift in the browser.

  ## Done looks like
  - When a user opens a SwiftUI project in the IDE, the preview panel shows a live, interactive rendering of their SwiftUI code running as compiled Swift/WASM in the browser
  - The preview updates when the user's code changes (with a compilation step happening transparently in the background)
  - Compilation errors are surfaced clearly in the preview panel, with a "Ask AI to fix" button that sends the errors to the AI agent for automatic debugging
  - The preview renders inside the existing DeviceSimulator frame with the iOS device chrome
  - The existing code-preview fallback remains available if compilation fails, alongside the "Ask AI to fix" action
  - Core SwiftUI views render correctly: Text, VStack, HStack, ZStack, Button, List, NavigationStack, Spacer, Divider, and common modifiers

  ## Out of scope
  - Full SwiftUI API coverage (only a practical subset for common UI patterns)
  - Advanced SwiftUI features: Canvas, Charts, MapKit, SpriteKit, Core Data bindings
  - Animations and transitions (static layout rendering only initially)
  - SwiftUI previews (#Preview macro) — we compile the full app entry point
  - Mobile native iOS client
  - Production deployment of the compilation service

  ## Tasks
  1. **Server-side SwiftWasm compilation endpoint** — Add a `POST /api/compile/swift-wasm` endpoint that accepts Swift source files, writes them into a SwiftWasm project template with JavaScriptKit, runs the Swift/Wasm compiler, and returns the compiled `.wasm` + `.js` artifacts. Include structured compilation error reporting.

  2. **SwiftWasm project template** — Create a minimal SwiftWasm project template in `server/compile-templates/swift-wasm/` with `Package.swift` (targeting `wasm32-unknown-wasi` or `wasm32-unknown-unknown`), JavaScriptKit dependency, and a placeholder `Main.swift` that gets replaced with user code. Include the SwiftUI-subset rendering library as part of the template.

  3. **SwiftUI-subset DOM renderer** — Build a Swift library (compiled to WASM alongside user code) that provides SwiftUI-like API types (`Text`, `VStack`, `HStack`, `ZStack`, `Button`, `List`, `Spacer`, `Divider`, `NavigationStack`, common modifiers) and renders them to HTML/CSS DOM elements via JavaScriptKit. The user writes standard SwiftUI syntax and the renderer translates the view tree to DOM nodes.

  4. **Preview adapter update** — Add a new preview mode `"swift-wasm"` to `preview-adapters.ts`. Update the SwiftUI framework mapping from `"code-preview"` to `"swift-wasm"`. The preview panel should render compiled Wasm output in an iframe via a served HTML page that loads the `.wasm` + bootstrap `.js`.

  5. **Wasm preview viewer integration** — Reuse or extend the `WasmPreview` component (built for Kotlin in Task #122) to also handle SwiftUI compilation. The component should: trigger compilation when files change (debounced), render compiled output in a sandboxed iframe, display compilation errors with "Ask AI to fix" button, and fall back to code-preview if compilation is unavailable.

  6. **Swift SDK installation** — Ensure the server environment has the Swift 6.1+ toolchain with SwiftWasm SDK installed and configured for WASM compilation. Add setup scripts or Nix packages as needed.

  ## Relevant files
  - `client/src/lib/preview-adapters.ts`
  - `client/src/components/ide/preview-panel.tsx`
  - `client/src/components/ide/code-preview.tsx`
  - `server/routes.ts`
  - `server/templates/swiftui-template.ts`
  - `server/framework-detector.ts`
  - `replit.md`
  