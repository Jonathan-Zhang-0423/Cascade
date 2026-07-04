// Precision tests for the AIGC media-intercept keyword layer.
// Locks down the regression where broad keywords misrouted normal build prompts
// to poster/video generation (and the prompt vanished). Ambiguous phrases must
// NOT trigger Level-1; build-intent prompts must be vetoed even if they contain
// a media word.

import { describe, expect, it } from "vitest";
import { keywordDetect, hasBuildIntent } from "./useMediaTrigger";

describe("keywordDetect — poster precision", () => {
  const posterCases = [
    "生成这个app的宣传海报",
    "生成海报",
    "宣传海报",
    "设计海报",
    "帮我设计一张海报",
    "做个海报",
    "create poster",
    "generate poster",
  ];
  for (const t of posterCases) {
    it(`detects poster: "${t}"`, () => {
      expect(keywordDetect(t)).toBe("poster");
    });
  }
});

describe("keywordDetect — video precision", () => {
  const videoCases = [
    "生成视频",
    "录制视频",
    "录视频",
    "分享视频",
    "generate video",
    "record video",
  ];
  for (const t of videoCases) {
    it(`detects video: "${t}"`, () => {
      expect(keywordDetect(t)).toBe("video");
    });
  }
});

describe("keywordDetect — ambiguous phrases must NOT trigger (regression guard)", () => {
  // These used to be hard keywords and caused false-positive interception.
  const noInterceptCases = [
    "做个视频",          // removed from VIDEO_KW_ZH
    "演示视频",          // removed
    "生成一段视频",      // removed
    "录个视频",          // removed
    "生成演示",          // removed (collides with 生成演示页面)
    "帮我画个流程图",    // 帮我画 removed
    "做张图",            // 做张图 removed
    "生成封面",          // removed
    "生成图片",          // removed
    "demo video",        // removed (ambiguous)
    "generate image",    // removed (ambiguous — "generate image upload")
  ];
  for (const t of noInterceptCases) {
    it(`does NOT intercept: "${t}"`, () => {
      expect(keywordDetect(t)).toBeNull();
    });
  }
});

describe("keywordDetect — build-intent veto", () => {
  // Even when a media word is present, a clear build request must fall through to normal send.
  const buildCases = [
    "做一个图片轮播组件",
    "生成演示页面",
    "做一个带海报的登录页",
    "写一个生成海报的功能",
    "实现视频上传组件",
    "开发一个宣传页",
    "做一个app",
    "做个应用",
    "修复生成图片的bug",
    "create app with video player",
  ];
  for (const t of buildCases) {
    it(`vetoes intercept for build intent: "${t}"`, () => {
      expect(keywordDetect(t)).toBeNull();
      expect(hasBuildIntent(t)).toBe(true);
    });
  }
});

describe("keywordDetect — pure build / normal prompts", () => {
  const normalCases = [
    "做一个待办应用",
    "帮我写一个登录页面",
    "实现一个表单验证功能",
    "add a dark mode toggle",
  ];
  for (const t of normalCases) {
    it(`does NOT intercept normal prompt: "${t}"`, () => {
      expect(keywordDetect(t)).toBeNull();
    });
  }
});
