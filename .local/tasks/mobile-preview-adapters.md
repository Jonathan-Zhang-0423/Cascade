# Mobile Framework Preview Adapters

## What & Why
The preview panel currently only supports web projects (HTML/CSS/JS rendered in an iframe). Mobile framework projects (SwiftUI, Flutter, Kotlin Compose, React Native/Expo) generate code correctly but cannot be previewed. This task adds a framework-aware preview routing system that selects the best preview strategy for each framework, enabling live in-browser preview where possible and a rich code preview + project export fallback for native-only frameworks.

## Done looks like
- When a **React Native (Expo)** project is open, the preview panel embeds an Expo Snack iframe that runs the project's code live in the browser.
- When a **Flutter** project is open, the preview panel embeds a DartPad iframe that runs the project's Dart code live in the browser.
- When a **SwiftUI** or **Kotlin Compose** project is open, the preview panel shows a polished code preview with syntax highlighting of the main entry file, and a "Download Project" button that exports the project as a .zip file for local development (Xcode / Android Studio).
- The device simulator frame still wraps all previews appropriately (iOS frame for SwiftUI, Android frame for Kotlin, etc.).
- The preview mode is automatically selected based on the project's `framework` field — no manual user configuration needed.
- Existing web project preview behavior is completely unchanged.

## Out of scope
- Running SwiftUI or Kotlin Compose UI natively in the browser (not possible without native toolchains).
- Cloud-based device simulators (e.g., Appetize.io, BrowserStack) — potential future enhancement.
- Compiling or type-checking mobile code on the server.
- Changes to the code generation / build orchestrator.

## Tasks
1. **Preview adapter architecture** — Create a framework-to-preview-strategy resolver that maps each framework (`web`, `rn-expo`, `flutter`, `swiftui`, `kotlin`) to its preview mode (`iframe-preview`, `expo-snack`, `dartpad`, `code-preview`). Wire it into the preview panel so it selects the right rendering strategy based on the current project's framework.

2. **Expo Snack adapter** — For React Native (Expo) projects, bundle the project files into an Expo Snack embed URL and render it in the device simulator's iframe. The adapter should map project files to Snack's file format and update when files change.

3. **DartPad adapter** — For Flutter projects, embed DartPad in an iframe with the project's Dart code loaded. Handle the DartPad embed URL format and pass the main.dart content. Update when files change.

4. **Code preview + export adapter** — For SwiftUI and Kotlin Compose projects, render a syntax-highlighted code viewer inside the preview panel showing the main entry file (ContentView.swift / MainActivity.kt) with file navigation tabs. Add a "Download Project" button that packages all project files into a downloadable .zip file.

5. **Server-side zip export endpoint** — Add a `/api/projects/:id/export` endpoint that bundles the project's files into a .zip archive and returns it for download.

6. **Preview panel integration** — Update the preview panel to use the adapter system, ensuring the device simulator frame, orientation controls, and QR code features work correctly with all preview modes. Show a framework badge/indicator so users know what preview mode is active.

## Relevant files
- `client/src/components/ide/preview-panel.tsx`
- `client/src/components/ide/device-simulator.tsx`
- `client/src/lib/device-specs.ts`
- `server/preview-server.ts`
- `server/routes.ts`
- `server/framework-detector.ts`
- `shared/schema.ts`
- `client/src/stores/ide-store.ts`
