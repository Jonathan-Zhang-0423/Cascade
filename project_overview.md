---
name: CodeStart project overview
description: What CodeStart is, the mobile pivot, tech stack, and current development status
type: project
---

CodeStart is a mobile-first AI coding platform. Users describe what they want in chat; the AI generates production-ready mobile app code. A browser-based device simulator shows the app inside a realistic iPhone/Android frame.

**Why browser simulator:** Apple App Store clause 2.5.2 forbids compiling and running native app code inside an app. The browser simulator is the compliant alternative for iOS users.

**Supported frameworks:**
- React Native (TypeScript) — primary, most beginner-friendly
- Flutter (Dart)
- Kotlin / Jetpack Compose (Android-only)
- SwiftUI (iOS-only) — SHELVED until other frameworks work
- Web (HTML/CSS/JS) — preserved, working

**Tech stack (as actually built):**
- Frontend: React 18 + TypeScript + Vite, Zustand state, Tailwind + Radix UI
- Backend: Express 5 + TypeScript (tsx), PostgreSQL + Drizzle ORM
- Compiler: Babel (RN), flutter build web (Flutter), Kotlin/Wasm (planned for Kotlin)
- AI: Doubao (default), Kimi K2.5, MiniMax, GLM-4 — all OpenAI-compatible
- Deploy: Self-hosted VPS (full toolchain control)

**Current milestone:** Fix React Native browser preview end-to-end. Then Flutter, then Kotlin/Compose.

**Why:** All four non-web framework previews are currently broken. The device simulator UI chrome (DeviceSimulator component) is complete and working. The compilation pipelines beneath it are broken.

**How to apply:** When suggesting changes, understand that the simulator frame is done — the work is always in the compiler pipeline and the preview React components.
