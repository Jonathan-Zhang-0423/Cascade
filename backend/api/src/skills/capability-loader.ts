import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { wordBoundaryMatch } from "./loader";
import { srcDir } from "../infra/paths";

/**
 * Capability skills are an ADDITIVE track, orthogonal to the tech-stack skills
 * in loader.ts. Tech-stack detection (react/flutter/...) picks at most 2 skills
 * via an LLM classifier with the framework always taking the primary slot — so
 * capability skills (game design, frontend design, completeness checks, ...)
 * would never win a slot there. Instead they live in their own directory and are
 * matched by a lightweight, LLM-free keyword scorer, then appended to the same
 * skillContent after the tech-stack skills.
 */

export interface CapabilityMeta {
  name: string;
  description: string;
  keywords: string[];
}

const CAPABILITIES_BASE_DIR = srcDir("skills", "capabilities");

// Max capability skills injected per request. Bounded to keep the prompt from
// ballooning, but set to 4 (not 2) so a broad request — e.g. "a polished,
// responsive landing page with animations and good copy" — can combine several
// complementary capabilities (art-direction + animation-design + responsive-
// layout + copywriting-typography) instead of only the top one or two. Tunable
// via CAPABILITY_MAX.
const MAX_CAPABILITIES = Number(process.env.CAPABILITY_MAX) || 4;

// Bilingual keywords (English word-boundary matched, phrases/Chinese matched via
// substring). Phrase/Chinese matches score higher than single English words.
const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  "game-design": [
    "游戏", "小游戏", "关卡", "得分", "分数", "碰撞", "精灵", "玩家", "敌人",
    "game", "gameplay", "game loop", "2d game", "html5 game", "canvas game",
    "sprite", "collision", "score", "level", "player", "enemy", "snake game",
    "platformer", "shooter", "puzzle game", "arcade", "requestanimationframe",
  ],
  "frontend-design": [
    "界面设计", "视觉", "美化", "排版", "配色", "布局", "响应式", "好看", "ui设计", "样式",
    "frontend design", "ui design", "visual design", "layout", "responsive",
    "color scheme", "typography", "spacing", "design system", "polish ui",
    "look good", "styling", "css design", "theme", "accessibility", "a11y",
  ],
  "feature-completion": [
    "功能填充", "补全功能", "占位", "接上", "实现功能", "完善功能", "填充", "真实数据",
    "feature completion", "wire up", "placeholder", "stub", "implement feature",
    "fill in", "mock data", "todo", "make it work", "hook up", "real data",
    "form validation", "complete the feature", "finish feature",
  ],
  "completeness-check": [
    "完备性", "完整性", "自查", "检查", "核对", "查漏", "断链", "审查", "验收", "质检",
    "completeness", "audit", "self-check", "review", "checklist", "verify",
    "broken link", "dead button", "missing error", "qa", "sanity check",
    "double check", "make sure it works", "no console errors",
  ],
  "state-management": [
    "状态管理", "状态", "数据流", "store", "单一数据源", "不可变", "持久化",
    "state management", "state", "data flow", "single source of truth",
    "immutable", "reducer", "global state", "shared state", "normalize state",
    "derived state", "persist state", "zustand", "redux",
  ],
  "api-integration": [
    "接口", "对接", "请求", "调接口", "网络请求", "重试", "超时", "鉴权", "loading",
    "api integration", "fetch", "axios", "http request", "rest", "endpoint",
    "retry", "timeout", "abort", "loading state", "error state", "auth header",
    "optimistic update", "cancel request", "data fetching", "call the api",
  ],
  "art-direction": [
    "美术", "美术设计", "视觉风格", "视觉设计", "配色方案", "色板", "调色", "插画",
    "图标风格", "品牌", "暗色模式", "深色模式", "主题配色", "风格基调", "质感",
    "art direction", "color palette", "visual style", "visual identity", "mood board",
    "iconography", "illustration", "imagery", "dark mode", "color scheme",
    "brand identity", "design language", "aesthetic", "look and feel",
  ],
  "animation-design": [
    "动画", "动效", "过渡动画", "缓动", "微交互", "转场", "加载动画", "入场动画",
    "悬停效果", "滚动动效", "动画设计", "渐隐", "渐入", "弹性动画",
    "animation", "motion design", "transition", "easing", "keyframes",
    "microinteraction", "micro-interaction", "fade in", "slide in", "spring animation",
    "parallax", "scroll animation", "hover effect", "loading animation", "reduced motion",
  ],
  "copywriting-typography": [
    "文案", "排版", "字体", "字号", "行距", "行高", "标题层级", "措辞", "微文案",
    "可读性", "字阶", "正文排版", "文字排版", "界面文案", "空状态文案",
    "copywriting", "microcopy", "typography", "type scale", "line height",
    "readability", "tone of voice", "wording", "ui copy", "font pairing",
    "letter spacing", "text hierarchy", "empty state copy", "error message copy",
  ],
  "responsive-layout": [
    "响应式", "自适应", "响应式布局", "移动端适配", "断点", "栅格", "网格布局",
    "流式布局", "移动优先", "屏幕适配", "弹性布局", "安全区",
    "responsive", "responsive layout", "adaptive layout", "mobile first",
    "breakpoint", "fluid grid", "media query", "container query", "flexbox",
    "css grid", "viewport", "safe area", "mobile layout", "screen size",
  ],
  "data-visualization": [
    "数据可视化", "图表", "可视化", "柱状图", "折线图", "饼图", "散点图", "仪表盘",
    "图例", "坐标轴", "热力图", "趋势图", "数据图表",
    "data visualization", "data viz", "chart", "charting", "bar chart",
    "line chart", "pie chart", "scatter plot", "heatmap", "dashboard",
    "graph", "plot", "axis", "legend", "d3", "recharts", "chart.js", "echarts",
  ],
  "accessibility": [
    "无障碍", "可访问性", "无障碍设计", "键盘可达", "屏幕阅读器", "焦点管理",
    "对比度", "语义化", "辅助功能", "读屏", "可达性",
    "accessibility", "a11y", "screen reader", "keyboard navigation", "focus management",
    "aria", "wcag", "contrast ratio", "semantic html", "alt text",
    "accessible", "skip link", "focus visible", "color contrast",
  ],
  "performance-optimization": [
    "性能优化", "加载速度", "卡顿", "首屏", "懒加载", "代码分割", "打包体积",
    "渲染优化", "性能", "提速", "优化加载", "防抖", "节流",
    "performance", "performance optimization", "page speed", "load time", "lazy load",
    "code splitting", "bundle size", "core web vitals", "lcp", "debounce",
    "throttle", "virtualize", "render optimization", "optimize performance", "faster",
  ],
  "form-ux": [
    "表单", "表单设计", "表单校验", "输入校验", "表单体验", "错误提示", "校验",
    "输入框", "提交", "多步表单", "表单验证", "字段校验", "占位提示",
    "form", "form validation", "form ux", "input validation", "error message",
    "field validation", "submit button", "multi-step form", "form design",
    "inline error", "required field", "autocomplete", "double submit", "form field",
  ],
  "seo-metadata": [
    "seo", "搜索引擎优化", "元数据", "网页标题", "页面标题", "分享卡片", "站点地图",
    "结构化数据", "收录", "爬虫", "元标签", "社交分享预览",
    "search engine optimization", "meta tags", "meta description", "open graph",
    "og image", "twitter card", "structured data", "json-ld", "canonical",
    "sitemap", "robots.txt", "rich results", "link preview", "page title",
  ],
  "internationalization": [
    "国际化", "多语言", "本地化", "语言切换", "翻译", "多语种", "中英文切换",
    "右到左", "地区格式", "货币格式", "日期格式", "语言包",
    "internationalization", "i18n", "localization", "l10n", "multilingual",
    "translation", "locale", "rtl", "right to left", "language switch",
    "currency format", "date format", "pluralization", "intl",
  ],
  "navigation-ia": [
    "导航", "信息架构", "导航栏", "菜单", "侧边栏", "面包屑", "标签页", "路由",
    "页面结构", "导航设计", "底部导航", "抽屉菜单", "返回",
    "navigation", "information architecture", "nav bar", "navbar", "sidebar",
    "breadcrumb", "tab bar", "menu", "routing", "site structure",
    "drawer menu", "bottom nav", "active state", "wayfinding", "ia",
  ],
  "empty-error-states": [
    "空状态", "空白页", "加载态", "加载状态", "错误状态", "错误页", "骨架屏",
    "占位状态", "缺省页", "无数据", "重试", "404页面", "异常状态",
    "empty state", "loading state", "error state", "skeleton screen",
    "skeleton loader", "placeholder state", "no data", "no results",
    "retry", "404 page", "error boundary", "fallback ui", "first run",
  ],
  "webgl-3d": [
    "3d", "3d游戏", "三维", "webgl", "three.js", "threejs", "babylon",
    "3d网页游戏", "3d场景", "3d模型", "着色器", "渲染器", "粒子效果", "第一人称",
    "3d game", "webgl game", "three js", "babylon.js", "3d scene", "3d model",
    "gltf", "glb", "orbitcontrols", "shader", "webgl context", "render loop",
    "import map", "importmap", "first person", "3d graphics", "game engine",
  ],
};

function extractDescription(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

async function discoverCapabilities(): Promise<CapabilityMeta[]> {
  let entries: string[];
  try {
    const dirents = await readdir(CAPABILITIES_BASE_DIR, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    console.warn("[CapabilityLoader] Could not scan capabilities directory:", CAPABILITIES_BASE_DIR);
    return [];
  }

  const caps: CapabilityMeta[] = [];
  for (const name of entries) {
    const skillPath = join(CAPABILITIES_BASE_DIR, name, "SKILL.md");
    try {
      const content = await readFile(skillPath, "utf-8");
      const description = extractDescription(content);
      const keywords = CAPABILITY_KEYWORDS[name] ?? [name.replace(/-/g, " ")];
      caps.push({ name, description, keywords });
    } catch {
      console.warn(`[CapabilityLoader] Skipping capability '${name}': SKILL.md not readable at ${skillPath}`);
    }
  }
  return caps;
}

let _cachedCapabilities: CapabilityMeta[] | null = null;

export async function listCapabilities(): Promise<CapabilityMeta[]> {
  if (!_cachedCapabilities) {
    _cachedCapabilities = await discoverCapabilities();
  }
  return _cachedCapabilities;
}

/**
 * Minimum score a capability must reach to be injected. A single stray English
 * word (score 1) is NOT enough — e.g. "review the layout" should not silently
 * pull in completeness-check. Require either one phrase/Chinese hit (score 3)
 * or several corroborating single words. Tunable via CAPABILITY_MIN_SCORE.
 */
const MIN_SCORE = Number(process.env.CAPABILITY_MIN_SCORE) || 3;

export interface CapabilityMatch {
  name: string;
  score: number;
  /** The keywords that actually matched, for logging/observability. */
  matched: string[];
}

/**
 * Pure keyword scorer — no LLM, no network. Phrases / Chinese terms (substring
 * match) score 3, single English words (word-boundary match) score 1, mirroring
 * the fallback scorer in loader.ts. Returns matches at or above MIN_SCORE in
 * descending score order, capped at MAX_CAPABILITIES, with the matched keywords
 * so callers can log exactly why a capability fired.
 */
export async function detectCapabilitiesDetailed(text: string): Promise<CapabilityMatch[]> {
  const caps = await listCapabilities();
  const matches: CapabilityMatch[] = [];

  for (const cap of caps) {
    let score = 0;
    const matched: string[] = [];
    for (const keyword of cap.keywords) {
      // A keyword is treated as a "phrase" (substring match) when it contains a
      // space or any non-ASCII char (e.g. Chinese) — word boundaries don't apply.
      const isPhrase = keyword.includes(" ") || /[^\x00-\x7f]/.test(keyword);
      if (isPhrase ? text.toLowerCase().includes(keyword.toLowerCase()) : wordBoundaryMatch(text, keyword)) {
        score += isPhrase ? 3 : 1;
        matched.push(keyword);
      }
    }
    if (score >= MIN_SCORE) matches.push({ name: cap.name, score, matched });
  }

  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CAPABILITIES);
}

/**
 * Convenience wrapper returning just the capability names, in descending score
 * order, capped at MAX_CAPABILITIES. Kept for call sites that don't need scores.
 */
export async function detectCapabilitiesFromText(text: string): Promise<string[]> {
  return (await detectCapabilitiesDetailed(text)).map((m) => m.name);
}

export async function loadCapability(name: string): Promise<string | null> {
  const caps = await listCapabilities();
  const meta = caps.find((c) => c.name === name);
  if (!meta) {
    console.warn(`[CapabilityLoader] Unknown capability requested: '${name}'`);
    return null;
  }
  const filePath = join(CAPABILITIES_BASE_DIR, name, "SKILL.md");
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    console.error(`[CapabilityLoader] Failed to load capability '${name}' from ${filePath}:`, err);
    return null;
  }
}

/**
 * Load multiple capability contents joined with clear separators, mirroring
 * loadSkills() in loader.ts (uses "### Capability:" headers).
 */
export async function loadCapabilities(names: string[]): Promise<string | null> {
  if (names.length === 0) return null;
  const parts: string[] = [];
  for (const name of names) {
    const content = await loadCapability(name);
    if (content) {
      parts.push(`### Capability: ${name}\n\n${content}`);
    }
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n---\n\n");
}
