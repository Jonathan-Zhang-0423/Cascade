# Mobile Development Agent Prompts & Skills

## What & Why
The existing AI agent prompts (Manager, Editor, Verifier, Mentor, Communicator) are written for web development (HTML/CSS/JS). For the mobile pivot, we need mobile-aware variants of these prompts that understand mobile app concepts (screens, navigation stacks, native APIs, platform differences, mobile UX patterns), plus a mobile skills library covering each supported framework. The framework detector and mobile scaffolding templates already exist — this task wires in the mobile-aware intelligence layer.

## Done looks like
- When a project uses a mobile framework (rn-expo, flutter, swiftui, kotlin), each agent prompt automatically includes mobile-specific guidance:
  - **Manager**: Understands screens vs pages, navigation stacks, native APIs, platform differences, and mobile UX patterns when planning mobile projects
  - **Editor**: Knows React Native components, Flutter widgets, SwiftUI views, Kotlin Compose composables, navigation patterns, state management, and platform-specific code
  - **Verifier**: Checks for mobile-specific issues (safe area insets, accessibility labels, touch target sizes, keyboard avoidance, platform handling, permissions)
  - **Mentor**: Teaches mobile concepts (screens, gestures, app lifecycle, permissions, responsive mobile design) using the same beginner-friendly style
  - **Communicator**: Narrates mobile build steps in beginner-friendly language (no change in format, just mobile-aware vocabulary)
- Prompt selection is dynamic — based on the project's detected framework type, mobile supplements are injected alongside the base prompt (preserve all existing web behavior)
- New mobile skills in `server/skills/`:
  - `react-native-expo/SKILL.md` — Expo project structure, navigation patterns, native modules, common APIs
  - `flutter/SKILL.md` — Widget tree, state management, Material/Cupertino patterns
  - `swiftui/SKILL.md` — SwiftUI views, modifiers, data flow
  - `kotlin-compose/SKILL.md` — Composables, state, Material Design 3
  - `mobile-common/SKILL.md` — Cross-framework concepts (push notifications, deep links, storage, camera, location)
- The skill-loader's `BUILTIN_KEYWORDS` map is extended with keywords for each new mobile skill so `detectSkillFromText` can match them
- Existing web prompts and skills are preserved and unchanged (web projects continue to work identically)

## Out of scope
- Changing the framework detector logic (already works)
- Changing the scaffolding templates (already exist)
- Adding a mobile device simulator/preview
- Communicator Agent deprecation — keep it as-is, just make it mobile-aware

## Tasks
1. Create the five mobile skill files under `server/skills/` (react-native-expo, flutter, swiftui, kotlin-compose, mobile-common), each with idiomatic project structure, patterns, common pitfalls, and file conventions — matching the style/depth of the existing `react/SKILL.md`
2. Extend `BUILTIN_KEYWORDS` in `skill-loader.ts` with keyword entries for each new mobile skill so text-based skill detection works for mobile prompts
3. Create a mobile prompt supplement module (e.g. `server/mobile-prompt-supplements.ts`) that exports framework-specific prompt additions for each agent role (Manager, Editor, Verifier, Mentor, Communicator). Each supplement should be a focused block of mobile-specific instructions that gets appended to the base prompt when a mobile framework is detected
4. Wire the supplements into the build orchestrator and routes: detect the project's framework, and when it's a mobile framework, inject the corresponding supplement into each agent's system prompt. For the build orchestrator, this means `buildEditorSystemPrompt` and `buildVerifierSystemPrompt` gain a framework parameter. For routes.ts, the Manager, Mentor, and Communicator prompt construction points need the same injection
5. Verify the skill-loader correctly discovers and returns all new mobile skills via `listSkills()`

## Relevant files
- `server/skill-loader.ts`
- `server/framework-detector.ts`
- `server/build-orchestrator.ts:1-12,48-90`
- `server/editor-prompt.ts`
- `server/verifier-prompt.ts`
- `server/manager-prompt.ts`
- `server/mentor-prompt.ts`
- `server/communicator-prompt.ts`
- `server/routes.ts:1-40,240-242,770-772,1306-1308,1540-1560`
- `server/skills/react/SKILL.md`
- `server/templates/index.ts`
