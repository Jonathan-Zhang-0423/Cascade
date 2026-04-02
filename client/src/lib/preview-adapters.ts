export type PreviewMode = "iframe-preview" | "expo-snack" | "dartpad" | "code-preview" | "kotlin-wasm" | "swift-wasm";

export type Framework = "web" | "rn-expo" | "flutter" | "swiftui" | "kotlin";

export function getPreviewMode(framework: Framework | string | undefined): PreviewMode {
  switch (framework) {
    case "rn-expo":
      return "expo-snack";
    case "flutter":
      return "dartpad";
    case "kotlin":
      return "kotlin-wasm";
    case "swiftui":
      return "swift-wasm";
    case "web":
    default:
      return "iframe-preview";
  }
}

export function getFrameworkLabel(framework: Framework | string | undefined): string {
  switch (framework) {
    case "rn-expo":
      return "React Native";
    case "flutter":
      return "Flutter";
    case "swiftui":
      return "SwiftUI";
    case "kotlin":
      return "Kotlin";
    case "web":
    default:
      return "Web";
  }
}

export function getFrameworkColor(framework: Framework | string | undefined): string {
  switch (framework) {
    case "rn-expo":
      return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
    case "flutter":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "swiftui":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "kotlin":
      return "bg-purple-500/15 text-purple-400 border-purple-500/30";
    case "web":
    default:
      return "bg-green-500/15 text-green-400 border-green-500/30";
  }
}

export function getMainEntryFile(framework: Framework | string | undefined): string {
  switch (framework) {
    case "rn-expo":
      return "/project/App.tsx";
    case "flutter":
      return "/project/lib/main.dart";
    case "swiftui":
      return "/project/ContentView.swift";
    case "kotlin":
      return "/project/src/main/kotlin/MainActivity.kt";
    case "web":
    default:
      return "/project/index.html";
  }
}

export function getLanguageId(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "swift":
      return "swift";
    case "kt":
      return "kotlin";
    case "dart":
      return "dart";
    case "tsx":
    case "ts":
      return "typescript";
    case "jsx":
    case "js":
      return "javascript";
    case "html":
      return "html";
    case "css":
      return "css";
    case "json":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "xml":
      return "xml";
    case "gradle":
    case "kts":
      return "kotlin";
    default:
      return "text";
  }
}

export interface ExpoSnackFile {
  type: "CODE";
  contents: string;
}

export function buildExpoSnackFiles(
  files: Array<{ path: string; content: string }>
): Record<string, ExpoSnackFile> {
  const snackFiles: Record<string, ExpoSnackFile> = {};
  for (const f of files) {
    const snackPath = f.path.replace(/^\/project\//, "");
    if (!snackPath) continue;
    snackFiles[snackPath] = { type: "CODE", contents: f.content };
  }
  return snackFiles;
}

export function buildExpoSnackUrl(
  files: Array<{ path: string; content: string }>,
  name?: string
): string {
  const snackFiles = buildExpoSnackFiles(files);
  const params = new URLSearchParams();
  params.set("platform", "web");
  params.set("name", name || "CodeStart Preview");
  params.set("theme", "dark");
  params.set("preview", "true");
  params.set("supportedPlatforms", "ios,android,web");
  params.set("files", JSON.stringify(snackFiles));
  return `https://snack.expo.dev/embedded?${params.toString()}`;
}

export function buildDartPadUrl(mainDartContent: string): string {
  const params = new URLSearchParams();
  params.set("theme", "dark");
  params.set("run", "true");
  params.set("split", "50");
  params.set("null_safety", "true");
  if (mainDartContent) {
    params.set("code", mainDartContent);
  }
  return `https://dartpad.dev/embed-flutter.html?${params.toString()}`;
}
