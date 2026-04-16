---
title: Multi-Framework Mobile Project Scaffolding (MP-2)
---

# Multi-Framework Mobile Project Scaffolding

## What & Why

Create a project scaffolding system that supports multiple mobile frameworks with proper templates, configs, and directory structures. This enables users to start developing with React Native, Flutter, SwiftUI, or Kotlin/Jetpack Compose with a single click.

## Done looks like

- Project creation dialog offers framework selection (React Native/Expo, Flutter, SwiftUI, Kotlin/Jetpack Compose, Web)
- Each framework template includes:
  - Correct file structure and boilerplate code
  - Configuration files (package.json, pubspec.yaml, build.gradle.kts, etc.)
  - Example screens/pages demonstrating framework patterns
  - Navigation setup (React Navigation, GoRouter, NavigationStack, etc.)
  - Platform-specific directories (android/, ios/)
- Projects store framework metadata in database
- Dashboard shows framework badge on project cards
- Framework is correctly detected from project files
- All templates compile/run without errors in the simulator
- Existing web project support preserved and unchanged

## Out of scope

- Implementing cloud build service integration (that's MP-4)
- Framework-specific AI prompts (that's MP-3)
- Asset generation or optimization

## Tasks

1. Update `shared/schema.ts`
   - Add `framework` field to projects table: "rn-expo" | "flutter" | "swiftui" | "kotlin" | "web"
   - Add `language` field: "typescript" | "dart" | "swift" | "kotlin" | "html"
   - Add `targetPlatform` field: "ios" | "android" | "both" (only for mobile frameworks)

2. Create template system in `server/templates/`
   - `rn-expo-template.ts` — React Native with Expo boilerplate
   - `flutter-template.ts` — Flutter boilerplate
   - `swiftui-template.ts` — SwiftUI boilerplate
   - `kotlin-template.ts` — Kotlin/Jetpack Compose boilerplate
   - `web-template.ts` — Web (HTML/CSS/JS) boilerplate (existing)
   - Template utility functions for generating file trees

3. Create framework detector in `server/framework-detector.ts`
   - Detect framework from project files
   - Infer framework from key files (package.json, pubspec.yaml, etc.)
   - Fall back to stored metadata

4. Update routes in `server/routes.ts`
   - POST /api/projects — accept `framework` and `language` parameters
   - Return scaffolded files based on framework selection
   - Store framework metadata with project

5. Update dashboard UI
   - Framework selector in project creation dialog
   - Platform badge on project cards (iOS, Android, both)
   - Language indicator
   - Visual icons for each framework

6. Update IDE store and state management
   - Track project framework throughout session
   - Pass framework to agent prompts

## Relevant files

- `shared/schema.ts` — database schema
- `server/routes.ts` — API routes
- `client/src/pages/dashboard.tsx` — project creation UI
- `Progress.txt` — MP-2 specification
