---
name: Known broken preview items with root causes
description: Exact root causes for broken RN, Flutter, Kotlin previews — what to fix and where
type: project
---

Last updated: 2026-04-11

## P0 — React Native ✅ LARGELY FIXED (2026-04-09/10)

Files: `server/rn-web-compiler.ts`, `server/stubs/codegenNativeComponent.js`, `server/rn-vendor-entry.js`

**Fixed:**
- ✅ `SafeAreaProvider` overridden in `makeRequire` — provides `_zeroInsets` immediately instead of waiting for native `onInsetsChange` that never fires in browser
- ✅ `codegenNativeComponent` stub now returns `React.forwardRef` wrapping a `<div>` instead of `null` — was crashing `SafeAreaProvider`'s internal `Xh` component
- ✅ `CSSStyleDeclaration` indexed setter blocked by Chrome — suppressed via `HTMLElement.prototype` style getter returning a Proxy that drops numeric-index writes
- ✅ `PanGestureHandler`, `State`, `Directions` added to gesture-handler stub (2048 game required these)
- ✅ `escapeScript` function added to prevent `</script>` in code from breaking HTML artifact
- ✅ `React.createElement` wrapper catches null component types with useful error + stack
- ✅ `rn-vendor.js` deleted and rebuilt after `codegenNativeComponent` stub change
- ✅ `react-native-web/` subpath import handling added

**Remaining:**
- 🟡 Some complex apps with unusual package deps may still show blank screen — unknown packages return Proxy stubs that silently swallow calls
- 🟡 AI-generated code that uses `global` (Node.js global) will error — a `window.global = window` polyfill could be added to `consoleInterceptor` in `preview-panel.tsx` as optional hardening

## P1 — Flutter (fix after RN)

Files: `server/flutter-compiler.ts`, `client/src/components/ide/flutter-web-preview.tsx`

1. **Flutter SDK not installed on server** — The compiler checks `isFlutterAvailable()` on startup; returns `false` → server returns 503 → client falls back to code view only. Need to either install Flutter SDK on VPS or implement DartPad embed fallback.

2. **No DartPad fallback implemented** — `flutter-web-preview.tsx` on 503 shows code preview. Should instead embed `https://dartpad.dev/embed-flutter.html?...` with the `main.dart` contents for instant preview.

3. **pubspec.yaml handling for multi-package projects** — When AI generates `pubspec.yaml` with non-standard packages, `flutter pub get` may fail. Needs better error extraction and retry.

## P2 — Kotlin (fix after Flutter)

Files: `server/kotlin-wasm-compiler.ts`, `server/compile-templates/kotlin-wasm/`

1. **Wrong compilation pipeline** — Current pipeline uses `gradle build` targeting `wasm32-unknown-wasi`. This produces CLI WASM with no browser rendering. Compose UI cannot render this way.

2. **Correct approach** — Use `gradle wasmJsBrowserDistribution` with Kotlin 2.0+ and the `compose-multiplatform` Gradle plugin. Output is a JS + WASM bundle that renders Compose UI via Skia on an HTML `<canvas>`. Requires updating the Gradle template, the build command, and artifact extraction logic.

3. **Toolchain requirements** — Kotlin 2.0+, JDK 17+, Gradle 8.5+, compose-multiplatform plugin.

## P3 — SwiftUI (SHELVED)

Apple SwiftUI cannot render in browser. Tied to UIKit/CoreGraphics. Tokamak is the only viable path (SwiftWasm + open-source SwiftUI renderer). Shelved until P0/P1/P2 resolved.
