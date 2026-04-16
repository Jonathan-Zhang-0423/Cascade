# Mobile Development Agent Prompts & Skills

## What & Why

The current AI agent prompts (Manager, Editor, Verifier, Mentor) are written for web development (HTML/CSS/JS). For the mobile pivot, we need new mobile-aware versions of these prompts that understand mobile app architecture, plus a mobile skills library covering each supported framework. Existing web prompts must be preserved.

## Done looks like

- New mobile-specific prompt variants:
  - **Manager**: Understands screens vs pages, navigation stacks, native APIs, platform differences, mobile UX patterns
  - **Editor**: Knows React Native components, Flutter widgets, SwiftUI views, Kotlin Compose composables, navigation patterns, state management, platform-specific code
  - **Verifier**: Checks for mobile-specific issues (safe area, accessibility labels, touch targets, keyboard avoidance, platform handling, permissions)
  - **Mentor**: Teaches mobile concepts (screens, gestures, app lifecycle, permissions, responsive mobile design)
- Prompt selection is dynamic based on the project's framework type
- Existing web prompts preserved (can still be used for web projects)
- New mobile skills in `server/skills/`:
  - `react-native-expo.md` - Expo patterns, navigation, native modules
  - `flutter.md` - Widget tree, state management, Material/Cupertino
  - `swiftui.md` - SwiftUI views, modifiers, data flow
  - `kotlin-compose.md` - Composables, state, Material Design 3
  - `mobile-common.md` - Cross-platform concepts (push notifications, deep links, storage, camera, location)
- Communicator Agent evaluation: assess whether to keep, refactor, or deprecate (based on user's question about its continued relevance)

## Depends on

- Task #103 (Multi-Framework Scaffolding — framework detection must work first)

## Relevant files

- `server/manager-prompt.ts`
- `server/editor-prompt.ts`
- `server/verifier-prompt.ts`
- `server/mentor-prompt.ts`
- `server/communicator-prompt.ts`
- `server/vibe-prompt.ts`
- `server/skill-loader.ts`
- `server/skills/`
