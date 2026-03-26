import type { ProjectFile } from "@shared/schema";

export type Framework = "web" | "rn-expo" | "flutter" | "swiftui" | "kotlin";
export type Language = "html" | "typescript" | "dart" | "swift" | "kotlin";
export type TargetPlatform = "ios" | "android" | "both";

export function detectFramework(files: ProjectFile[]): Framework {
  const filePaths = new Set(files.map((f) => f.path.toLowerCase()));

  // Check for React Native / Expo
  if (
    filePaths.has("/project/app.json") &&
    filePaths.has("/project/app.tsx")
  ) {
    return "rn-expo";
  }

  // Check for Flutter
  if (
    filePaths.has("/project/pubspec.yaml") &&
    filePaths.has("/project/lib/main.dart")
  ) {
    return "flutter";
  }

  // Check for SwiftUI
  if (
    filePaths.has("/project/myapp.swift") ||
    filePaths.has("/project/contentview.swift")
  ) {
    return "swiftui";
  }

  // Check for Kotlin / Jetpack Compose
  if (
    filePaths.has("/project/build.gradle.kts") &&
    (filePaths.has("/project/src/main/kotlin/mainactivity.kt") ||
      filePaths.has("/project/src/main/kotlin/mainactivity.kt"))
  ) {
    return "kotlin";
  }

  // Default to web
  return "web";
}

export function getLanguageForFramework(framework: Framework): Language {
  switch (framework) {
    case "rn-expo":
      return "typescript";
    case "flutter":
      return "dart";
    case "swiftui":
      return "swift";
    case "kotlin":
      return "kotlin";
    case "web":
    default:
      return "html";
  }
}

export function getTargetPlatformForFramework(
  framework: Framework
): TargetPlatform {
  switch (framework) {
    case "swiftui":
      return "ios";
    case "kotlin":
      return "android";
    case "rn-expo":
    case "flutter":
      return "both";
    case "web":
    default:
      return "both";
  }
}
