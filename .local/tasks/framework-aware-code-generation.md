# Framework-Aware Code Generation

## What & Why
When a user creates a SwiftUI (or Flutter/Kotlin) project and asks the AI to build something (e.g. "build me a calculator"), the AI generates HTML/CSS/JS instead of Swift code. This is because neither the manager-chat nor build-session API calls include the project's framework — the server falls back to detecting the framework from files (empty for new projects → defaults to "web") or from keyword matching in the user's prompt (which often mismatches, e.g. "calculator" matches vanilla-js, not swiftui).

The fix must ensure the project's explicitly-chosen framework flows from client → server → AI prompt at every stage: planning, building, and verification.

## Done looks like
- Creating a SwiftUI project and asking "build me a calculator" produces Swift/SwiftUI code, not HTML/CSS/JS
- Same for Flutter → Dart, Kotlin → Kotlin, React Native → TypeScript/JSX
- The project's framework is the primary authority; text-based skill detection acts as a secondary fallback only when no explicit framework is available
- Existing web projects continue to work as before

## Out of scope
- Adding new framework templates or skills
- Changing the project creation UI
- Code preview/execution for native platforms

## Tasks
1. **Pass framework from client to both API endpoints** — In `chat-panel.tsx`, include the project's `framework` (from the IDE store / project record) in the request body for both `/api/manager-chat` and `/api/build-session` calls.

2. **Prioritize explicit framework on the server** — In `server/routes.ts` manager-chat handler and `server/build-orchestrator.ts`, use the explicitly-passed framework as the primary source; fall back to `detectFramework(files)` only when the request doesn't include one. Also look up the project record by `projectId` as an additional authoritative source when framework isn't in the request body.

3. **Use framework to force correct skill loading** — In `server/skill-loader.ts`, add a function (or extend `detectSkillFromText`) that maps a known framework to its canonical skill name (e.g. `swiftui` → `"swiftui"`, `flutter` → `"flutter"`). When an explicit framework is available, use its mapped skill directly instead of relying on keyword-based text detection.

4. **Verify end-to-end** — Confirm that creating a SwiftUI project and sending a generic prompt like "build me a calculator" results in Swift code being generated, with the correct skill and mobile supplements in the AI prompt.

## Relevant files
- `client/src/components/ide/chat-panel.tsx`
- `client/src/stores/ide-store.ts`
- `server/routes.ts`
- `server/build-orchestrator.ts`
- `server/skill-loader.ts`
- `server/framework-detector.ts`
- `server/mobile-prompt-supplements.ts`
- `shared/schema.ts`
