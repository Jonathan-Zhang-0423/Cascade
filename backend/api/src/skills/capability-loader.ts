import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { wordBoundaryMatch } from "./loader";

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

const CAPABILITIES_BASE_DIR = join(import.meta.dirname, "capabilities");

// Cap at 2 to bound prompt size — same rationale as MAX_SKILLS in loader.ts.
const MAX_CAPABILITIES = 2;

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
 * Pure keyword scorer — no LLM, no network. Phrases / Chinese terms (substring
 * match) score 3, single English words (word-boundary match) score 1, mirroring
 * the fallback scorer in loader.ts. Returns capability names in descending score
 * order, capped at MAX_CAPABILITIES.
 */
export async function detectCapabilitiesFromText(text: string): Promise<string[]> {
  const caps = await listCapabilities();
  const scores: Record<string, number> = {};

  for (const cap of caps) {
    let score = 0;
    for (const keyword of cap.keywords) {
      // A keyword is treated as a "phrase" (substring match) when it contains a
      // space or any non-ASCII char (e.g. Chinese) — word boundaries don't apply.
      const isPhrase = keyword.includes(" ") || /[^\x00-\x7f]/.test(keyword);
      if (isPhrase ? text.toLowerCase().includes(keyword.toLowerCase()) : wordBoundaryMatch(text, keyword)) {
        score += isPhrase ? 3 : 1;
      }
    }
    if (score > 0) scores[cap.name] = score;
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, MAX_CAPABILITIES);
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
