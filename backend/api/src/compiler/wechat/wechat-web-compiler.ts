/**
 * WeChat Mini Program → Browser Compiler
 *
 * Transforms WeChat Mini Program source files into a browser-runnable React bundle:
 *  - WXML → React JSX (via server/wechat/wxml-to-jsx.ts)
 *  - WXSS → CSS (via server/wechat/wxss-to-css.ts)
 *  - Page JS wrapped in a module that exports Page config
 *  - app.js wrapped to call App()
 *  - esbuild bundles everything with React + wx-runtime + wx-polyfill
 *
 * Mirrors the structure of server/rn-web-compiler.ts.
 */

import { writeFile, mkdir, rm, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { build as esbuild } from "esbuild";

import { hashSources } from "../compiler-utils.js";
import { wxmlToJsx } from "./runtime/wxml-to-jsx.js";
import { transformWxss } from "./runtime/wxss-to-css.js";
import { generateAppBootstrap } from "./runtime/app-bootstrap.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VENDOR_PATH = join(import.meta.dirname, "../../../assets", "wx-vendor.js");
const BUILD_CACHE_MAX_AGE = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;
const MAX_CONCURRENT_COMPILES = 2;
const MAX_FILES_PER_REQUEST = 60;
const MAX_TOTAL_SOURCE_BYTES = 800_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WxCompilationResult {
  success: boolean;
  buildId: string;
  errors?: string[];
  /** Non-fatal issues — the build still succeeded, but the agent should know. */
  warnings?: string[];
}

interface AppJson {
  pages?: string[];
  window?: Record<string, string>;
  tabBar?: {
    color?: string;
    selectedColor?: string;
    backgroundColor?: string;
    list?: Array<{ pagePath: string; text: string; iconPath?: string; selectedIconPath?: string }>;
  };
}

// ---------------------------------------------------------------------------
// Cache + concurrency
// ---------------------------------------------------------------------------

const artifactCache = new Map<string, { buildId: string; dir: string; createdAt: number }>();
let activeCompiles = 0;
const inflightCompiles = new Map<string, Promise<WxCompilationResult>>();

setInterval(() => {
  const now = Date.now();
  for (const [hash, entry] of Array.from(artifactCache.entries())) {
    if (now - entry.createdAt > BUILD_CACHE_MAX_AGE) {
      rm(entry.dir, { recursive: true, force: true }).catch(() => {});
      artifactCache.delete(hash);
    }
  }
  // Evict oldest entries if over limit
  if (artifactCache.size > MAX_CACHE_ENTRIES) {
    const sorted = Array.from(artifactCache.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [k, v] of sorted.slice(0, artifactCache.size - MAX_CACHE_ENTRIES)) {
      rm(v.dir, { recursive: true, force: true }).catch(() => {});
      artifactCache.delete(k);
    }
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Vendor bundle (built once at startup)
// ---------------------------------------------------------------------------

let vendorBuildPromise: Promise<void> | null = null;

export async function ensureWxVendorBundle(): Promise<void> {
  if (existsSync(VENDOR_PATH)) return;
  if (vendorBuildPromise) return vendorBuildPromise;

  vendorBuildPromise = (async () => {
    await mkdir(join(import.meta.dirname, "../../../assets"), { recursive: true });
    console.log("[wx-web] Building vendor bundle (React + wx-runtime + wx-polyfill)...");
    const entryPath = join(import.meta.dirname, "runtime", "wx-runtime.tsx");
    await writeFile(entryPath, `
import React from "react";
import ReactDOM from "react-dom/client";
export { React, ReactDOM };
`);
    try {
      await esbuild({
        entryPoints: [entryPath],
        bundle: true,
        format: "iife",
        globalName: "__WX__",
        outfile: VENDOR_PATH,
        minify: true,
        define: { "process.env.NODE_ENV": '"production"' },
        loader: { ".tsx": "tsx", ".ts": "ts" },
        logLevel: "error",
      });
      console.log("[wx-web] Vendor bundle ready:", VENDOR_PATH);
    } finally {
      rm(entryPath, { force: true }).catch(() => {});
      vendorBuildPromise = null; // reset so a deleted file triggers a fresh build
    }
  })();

  return vendorBuildPromise;
}

// ---------------------------------------------------------------------------
// Page JS wrapper
// ---------------------------------------------------------------------------

function wrapPageJs(js: string, componentName: string): string {
  // The page JS calls Page({...}) at the top level.
  // We intercept Page() to capture the config and export it under a per-component name
  // so app-bootstrap.ts can import it alongside the JSX component.
  return `
let __capturedPage__ = null;
function Page(cfg) { __capturedPage__ = cfg; }
function Component(cfg) { __capturedPage__ = cfg; }

${js}

export function __pageFactory_${componentName}() { return __capturedPage__ ?? {}; }
`;
}

function wrapAppJs(js: string): string {
  return `
import { wx } from "./wx-polyfill";
let __capturedApp__ = null;
function App(cfg) { __capturedApp__ = cfg; if (typeof window !== "undefined") { (window).__wxApp__ = cfg; } }
function getApp() { return __capturedApp__ ?? {}; }

${js}

export default function __runApp__() {
  // app.js already ran at module evaluation time
}
`;
}

// ---------------------------------------------------------------------------
// HTML shell
// ---------------------------------------------------------------------------

function buildHtmlShell(bundleFilename: string, cssContent: string): string {
  const escapedCss = cssContent.replace(/<\/style>/gi, "<\\/style>");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#07c160">
<title>WeChat Mini Program Preview</title>
<style>
@keyframes wx-spin { to { transform: rotate(360deg); } }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: rgba(0, 0, 0, 0.1); }
html, body, #root {
  height: 100%;
  overflow: hidden;
  background: #f5f5f5;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", "Hiragino Sans GB", Helvetica, Arial, sans-serif;
  font-size: 14px;
  color: #1a1a1a;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
/* WeChat's characteristic long-press + selection suppression on non-text UI */
button, [role="button"], .wx-tap-area {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
/* Native-feel momentum scroll inside scroll containers */
.wx-scroll { -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
/* WeChat default button hover class — applied when no hover-class prop is set */
.button-hover { opacity: 0.7; }
</style>
<style id="__wx_styles__">${escapedCss}</style>
</head>
<body>
<div id="root"></div>
<script src="./${bundleFilename}"></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main compile function
// ---------------------------------------------------------------------------

export async function compileWeChatWeb(
  files: Array<{ path: string; content: string }>,
  projectId?: string,
): Promise<WxCompilationResult> {
  if (files.length > MAX_FILES_PER_REQUEST) {
    return { success: false, buildId: "", errors: [`Too many files (max ${MAX_FILES_PER_REQUEST})`] };
  }
  const totalBytes = files.reduce((s, f) => s + f.content.length, 0);
  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
    return { success: false, buildId: "", errors: [`Source too large (max ${MAX_TOTAL_SOURCE_BYTES / 1000}KB)`] };
  }

  // Include projectId in the hash so each project gets its own artifact dir
  // with its own __WX_PROJECT_ID__ baked in — even if source is identical.
  const hash = hashSources(files, projectId);

  // Return cached result if available
  const cached = artifactCache.get(hash);
  if (cached) return { success: true, buildId: cached.buildId };

  // Deduplicate concurrent compiles for the same hash
  const inflight = inflightCompiles.get(hash);
  if (inflight) return inflight;

  if (activeCompiles >= MAX_CONCURRENT_COMPILES) {
    return { success: false, buildId: "", errors: ["Server busy — too many concurrent compilations. Try again shortly."] };
  }

  const promise = _doCompile(hash, files, projectId);
  inflightCompiles.set(hash, promise);
  promise.finally(() => inflightCompiles.delete(hash));
  return promise;
}

async function _doCompile(
  hash: string,
  files: Array<{ path: string; content: string }>,
  projectId?: string,
): Promise<WxCompilationResult> {
  activeCompiles++;
  const buildId = hash;
  const buildDir = join(import.meta.dirname, "../../../../artifacts", "wx-" + buildId);

  try {
    await ensureWxVendorBundle();

    // Build file map
    const fileMap: Record<string, string> = {};
    for (const f of files) {
      const key = f.path.replace(/^\/project\//, "");
      fileMap[key] = f.content;
    }

    // Parse app.json
    let appJson: AppJson = {};
    try { appJson = JSON.parse(fileMap["app.json"] ?? "{}"); } catch {}
    const pages = appJson.pages ?? ["pages/index/index"];
    const windowConfig = appJson.window ?? {};
    const navBgColor = windowConfig.navigationBarBackgroundColor ?? "#07c160";
    const navTextStyle = windowConfig.navigationBarTextStyle ?? "white";
    const navTextColor = navTextStyle === "black" ? "#000" : "#fff";
    const navTitle = windowConfig.navigationBarTitleText ?? "Mini Program";

    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate pages exist
    for (const page of pages) {
      if (!fileMap[page + ".wxml"]) {
        errors.push(`Page "${page}" is missing ${page}.wxml`);
      }
    }
    if (errors.length > 0) {
      return { success: false, buildId: "", errors };
    }

    await mkdir(buildDir, { recursive: true });

    // Collect all CSS
    const cssChunks: string[] = [];

    // Global app.wxss
    if (fileMap["app.wxss"]) {
      cssChunks.push(transformWxss(fileMap["app.wxss"], { global: true }));
    }

    // Per-page files
    const pageComponents: Array<{ path: string; componentName: string }> = [];

    for (const pagePath of pages) {
      const safeComp = "WxPage_" + pagePath.replace(/[^a-zA-Z0-9]/g, "_");
      pageComponents.push({ path: pagePath, componentName: safeComp });

      // WXML → JSX
      const wxml = fileMap[pagePath + ".wxml"] ?? "<view><text>Empty page</text></view>";
      const { jsx, errors: wxmlErrors, warnings: wxmlWarnings } = wxmlToJsx(wxml, pagePath);
      if (wxmlErrors.length) errors.push(...wxmlErrors.map((e) => `[${pagePath}.wxml] ${e}`));
      if (wxmlWarnings.length) warnings.push(...wxmlWarnings.map((w) => `[${pagePath}.wxml] ${w}`));

      // WXSS → CSS
      const wxss = fileMap[pagePath + ".wxss"] ?? "";
      if (wxss) cssChunks.push(transformWxss(wxss, { pagePrefix: pagePath }));

      // Page JSON config
      let pageJsonConfig: Record<string, unknown> = {};
      try { pageJsonConfig = JSON.parse(fileMap[pagePath + ".json"] ?? "{}"); } catch {}

      // Page JS
      const pageJs = fileMap[pagePath + ".js"] ?? "Page({data:{}});";
      const wrappedJs = wrapPageJs(pageJs, safeComp);

      // Write page module: JSX component + page factory
      const pageModule = `
import React, { useState, useEffect, useRef } from "react";
import { View, Text, Image, Button, Input, Textarea, ScrollView, Swiper, SwiperItem, Navigator, Form, Label, Checkbox, CheckboxGroup, Radio, RadioGroup, Switch, Slider, Picker, Icon, Progress, Block, Canvas, RichText, Video, WebView, MovableView, MovableArea, CoverView, CoverImage, LivePlayerStub, AdStub } from "./wx-runtime";
import { wx } from "./wx-polyfill";

${wrappedJs}

${jsx}

export const __pageConfig_${safeComp} = ${JSON.stringify({ ...pageJsonConfig, navigationBarTitleText: (pageJsonConfig.navigationBarTitleText as string) ?? navTitle })};
export { ${safeComp} };
`;
      await writeFile(join(buildDir, safeComp + ".tsx"), pageModule);
    }

    // App bootstrap entry
    const appJsContent = fileMap["app.js"] ?? "App({});";
    const wrappedAppJs = wrapAppJs(appJsContent);
    await writeFile(join(buildDir, "app-module.js"), wrappedAppJs);

    const bootstrap = generateAppBootstrap({
      pages: pageComponents,
      entryPage: pages[0],
      navBgColor,
      navTextColor,
      navTitle,
      tabBar: appJson.tabBar ? {
        color: appJson.tabBar.color ?? "#999",
        selectedColor: appJson.tabBar.selectedColor ?? "#07c160",
        backgroundColor: appJson.tabBar.backgroundColor ?? "#fff",
        list: appJson.tabBar.list ?? [],
      } : undefined,
      appJsName: "app-module",
    });
    await writeFile(join(buildDir, "index.tsx"), bootstrap);

    // Copy runtime files into build dir so esbuild can resolve them
    const runtimeSrc = join(import.meta.dirname, "runtime");
    await writeFile(join(buildDir, "wx-runtime.tsx"), await readFile(join(runtimeSrc, "wx-runtime.tsx"), "utf8"));
    await writeFile(join(buildDir, "wx-polyfill.ts"), await readFile(join(runtimeSrc, "wx-polyfill.ts"), "utf8"));

    // Bundle with esbuild
    const bundleFilename = "bundle.js";
    try {
      await esbuild({
        entryPoints: [join(buildDir, "index.tsx")],
        bundle: true,
        format: "iife",
        outfile: join(buildDir, bundleFilename),
        minify: false,
        define: {
          "process.env.NODE_ENV": '"production"',
          "__WX_PROJECT_ID__": JSON.stringify(projectId ?? ""),
        },
        loader: { ".tsx": "tsx", ".ts": "ts", ".js": "js" },
        jsx: "automatic",
        jsxImportSource: "react",
        external: [],
        logLevel: "silent",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Clean up build dir on failure
      await rm(buildDir, { recursive: true, force: true }).catch(() => {});
      return { success: false, buildId: "", errors: [msg] };
    }

    // Write HTML shell
    const cssContent = cssChunks.join("\n");
    const html = buildHtmlShell(bundleFilename, cssContent);
    await writeFile(join(buildDir, "index.html"), html);

    artifactCache.set(hash, { buildId, dir: buildDir, createdAt: Date.now() });

    if (warnings.length > 0) {
      console.warn("[wx-web] Build succeeded with warnings:", warnings);
    }
    // `errors` now only collects truly blocking issues (parse failures, missing pages).
    // Non-fatal unsupported-feature notes are surfaced via `warnings`.
    if (errors.length > 0) {
      console.warn("[wx-web] Build completed with non-fatal errors:", errors);
    }

    return { success: true, buildId, warnings: warnings.length ? warnings : undefined };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await rm(buildDir, { recursive: true, force: true }).catch(() => {});
    return { success: false, buildId: "", errors: [msg] };
  } finally {
    activeCompiles--;
  }
}

// ---------------------------------------------------------------------------
// Artifact path resolver (used by the route handler)
// ---------------------------------------------------------------------------

export function getWxArtifactDir(buildId: string): string | null {
  const entry = artifactCache.get(buildId);
  return entry ? entry.dir : null;
}
