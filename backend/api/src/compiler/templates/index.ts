import type { Framework } from "../framework-detector";
import { generateWebTemplate } from "./web-template";
import { generateRNExpoTemplate } from "./rn-expo-template";
import { generateFlutterTemplate } from "./flutter-template";
import { generateSwiftUITemplate } from "./swiftui-template";
import { generateKotlinTemplate } from "./kotlin-template";
import { generateWeChatTemplate } from "./wechat-template";

export interface TemplateFile {
  path: string;
  content: string;
}

export function getTemplateFiles(framework: Framework): TemplateFile[] {
  switch (framework) {
    case "rn-expo":
      return generateRNExpoTemplate();
    case "flutter":
      return generateFlutterTemplate();
    case "swiftui":
      return generateSwiftUITemplate();
    case "kotlin":
      return generateKotlinTemplate();
    case "wechat":
      return generateWeChatTemplate();
    case "web":
    default:
      return generateWebTemplate();
  }
}
