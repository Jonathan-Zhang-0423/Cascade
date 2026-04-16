---
name: Preview simulator strategy
description: Decided 2026-04-07 — which approach each framework uses for browser preview and why
type: project
---

Decided 2026-04-07 based on conversation with user.

**Why:** iOS App Store clause 2.5.2 forbids native compilation inside an app. The preview must be browser-based. User confirmed: always show the preview in the simulator — no code-view-only fallback.

| Framework | Preview approach | Status |
|-----------|-----------------|--------|
| Web | Direct iframe | ✅ Working |
| React Native | Babel → react-native-web → iframe | 🔴 Fix next |
| Flutter | DartPad embed (instant) + flutter build web when SDK installed | 🔴 Fix after RN |
| Kotlin | Kotlin/Wasm + Compose Multiplatform → Skia canvas | 🔴 Fix after Flutter |
| SwiftUI | SHELVED — code view only for now | ⏸ Shelved |

**SwiftUI rationale:** Apple SwiftUI is tied to UIKit/CoreGraphics — no browser rendering path. Tokamak (open-source SwiftUI-compatible renderer via SwiftWasm) is the only viable approach, but it's a significant undertaking. Shelved until RN/Flutter/Kotlin work.

**Kotlin rationale:** JetBrains Compose Multiplatform supports a WASM target that renders actual Compose UI via Skia on an HTML canvas. Requires `gradle wasmJsBrowserDistribution` with Kotlin 2.0+ and the compose-multiplatform Gradle plugin. Current codebase uses the wrong pipeline (wasm32-unknown-wasi → CLI WASM, no UI output).

**Flutter rationale:** DartPad (dartpad.dev) provides an instant embed for single-file Flutter/Dart. When the VPS has Flutter SDK installed, server-side `flutter build web` provides full multi-file support. Always show something in the simulator.

**AI code generation:** Always generate real production code. Preview handles compatibility best-effort. Do not generate preview-only code that won't work on a real device.

**How to apply:** When implementing any preview feature, always aim to render inside the DeviceSimulator frame. Never fall back to "code view only" — always show something live.
