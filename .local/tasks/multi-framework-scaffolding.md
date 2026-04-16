# Multi-Framework Mobile Project Scaffolding

## What & Why

The current project system creates blank web projects (HTML/CSS/JS). For the mobile pivot, we need a scaffolding system that can create starter projects for multiple mobile frameworks: React Native (Expo), Flutter, SwiftUI (iOS-only), and Kotlin/Jetpack Compose (Android-only). Each framework should have proper project templates with correct directory structures, config files, and dependency manifests.

## Done looks like

- New project creation dialog offers framework selection (React Native/Expo, Flutter, SwiftUI, Kotlin/Compose)
- Each framework has a complete starter template:
  - **React Native/Expo**: App.tsx, app.json, package.json, navigation setup, babel.config.js
  - **Flutter**: main.dart, pubspec.yaml, lib/ structure, MaterialApp scaffold
  - **SwiftUI**: ContentView.swift, App.swift, Info.plist, Assets.xcassets structure
  - **Kotlin/Compose**: MainActivity.kt, build.gradle.kts, AndroidManifest.xml
- Templates include a simple "Hello World" screen with proper mobile patterns
- Language/framework detection works correctly for each template type
- Existing web project templates (HTML/CSS/JS) are preserved as an option
- Server-side project creation endpoint updated to accept framework parameter
- Skill detection (`skill-loader.ts`) recognizes each mobile framework

## Depends on

- Task #102 (Roadmap document)

## Out of scope

- AI prompt rewrites (separate task)
- Cloud build pipeline
- Device simulator preview

## Relevant files

- `client/src/components/ide/chat-panel.tsx` (project creation)
- `client/src/stores/ide-store.ts` (project state)
- `server/routes.ts` (project creation endpoint)
- `server/skill-loader.ts` (framework detection)
- `shared/schema.ts` (project schema)
