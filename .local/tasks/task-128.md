---
title: Fix Kotlin/Wasm Preview (Gradle SDK Missing)
---
# Fix Kotlin/Wasm Preview (Gradle SDK Missing)

## What & Why
The "安卓计算器" project preview shows raw source code and an error message "Compose Wasm compiler not available" because the Gradle SDK (`~/.gradle-sdk/gradle-8.10/`) was wiped during recent task merges. The Kotlin/Wasm compilation endpoint (`/api/compile/kotlin-wasm`) returns a 503 error with "Gradle SDK not found". Additionally, the `post-merge.sh` script does not include the Gradle setup step, so the SDK is never restored after merges.

## Done looks like
- The 安卓计算器 project preview renders the calculator app UI instead of raw source code
- `/api/compile/kotlin-wasm` returns compiled Wasm artifacts successfully
- The Gradle SDK persists across future task merges via the post-merge setup script
- Server startup shows a healthy Kotlin/Wasm compiler status instead of the "Gradle not found" warning

## Out of scope
- SwiftWasm `libncurses.so.6` dependency issue (separate problem, tracked separately)
- Changing the Gradle version or Kotlin/Wasm compiler logic
- Any frontend preview component changes

## Tasks
1. **Add Gradle setup to post-merge script** — Add a call to `scripts/setup-gradle.sh` in `scripts/post-merge.sh` so the Gradle SDK is restored automatically after any task merge, matching the existing pattern for SwiftWasm setup.

2. **Run the Gradle setup now** — Execute `bash scripts/setup-gradle.sh` to restore the missing Gradle SDK immediately, then restart the application to verify the compiler is available.

3. **Verify the fix** — Confirm that the server starts without the "Gradle not found" warning and that the `/api/compile/kotlin-wasm` endpoint accepts requests.

## Relevant files
- `scripts/post-merge.sh`
- `scripts/setup-gradle.sh`
- `server/kotlin-wasm-compiler.ts`