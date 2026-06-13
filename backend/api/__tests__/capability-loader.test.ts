import { describe, it, expect, vi } from "vitest";

// capability-loader imports wordBoundaryMatch from loader.ts, which transitively
// imports the provider clients (they instantiate OpenAI at module load and need a
// key). Stub the provider module so importing the loader doesn't require credentials.
vi.mock("../src/agent/providers/kimi-client", () => ({
  withFallback: vi.fn(),
}));

import {
  listCapabilities,
  detectCapabilitiesFromText,
  detectCapabilitiesDetailed,
  loadCapability,
  loadCapabilities,
  loadCapabilitiesTiered,
  buildDigest,
} from "../src/skills/capability-loader";

const EXPECTED = [
  "game-design",
  "frontend-design",
  "feature-completion",
  "completeness-check",
  "state-management",
  "api-integration",
  "art-direction",
  "animation-design",
  "copywriting-typography",
  "responsive-layout",
  "data-visualization",
  "accessibility",
  "performance-optimization",
  "form-ux",
  "seo-metadata",
  "internationalization",
  "navigation-ia",
  "empty-error-states",
  "webgl-3d",
  "testing",
];

describe("capability-loader: discovery", () => {
  it("discovers all capability skills", async () => {
    const caps = await listCapabilities();
    const names = caps.map((c) => c.name).sort();
    expect(names).toEqual([...EXPECTED].sort());
  });

  it("extracts a non-empty description for each capability", async () => {
    const caps = await listCapabilities();
    for (const c of caps) {
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});

describe("capability-loader: detection", () => {
  it("detects game-design from a Chinese game request", async () => {
    const result = await detectCapabilitiesFromText("做一个有关卡和分数的游戏");
    expect(result).toContain("game-design");
  });

  it("detects game-design from an English game request", async () => {
    const result = await detectCapabilitiesFromText("build a snake game with score and levels");
    expect(result).toContain("game-design");
  });

  it("detects feature-completion when asked to wire up placeholders", async () => {
    const result = await detectCapabilitiesFromText("帮我把这些占位按钮接上真实功能");
    expect(result).toContain("feature-completion");
  });

  it("detects frontend-design from a styling request", async () => {
    const result = await detectCapabilitiesFromText("make the UI look good with a nice responsive layout");
    expect(result).toContain("frontend-design");
  });

  it("detects completeness-check from an audit request", async () => {
    const result = await detectCapabilitiesFromText("做一次完备性检查，确保没有断链和报错");
    expect(result).toContain("completeness-check");
  });

  it("detects art-direction from a visual-style request (zh + en)", async () => {
    expect(await detectCapabilitiesFromText("帮我定一套视觉风格和配色方案")).toContain("art-direction");
    expect(await detectCapabilitiesFromText("define the art direction and color palette")).toContain("art-direction");
  });

  it("detects animation-design from a motion request (zh + en)", async () => {
    expect(await detectCapabilitiesFromText("给按钮加一些动效和过渡动画")).toContain("animation-design");
    expect(await detectCapabilitiesFromText("add motion design with smooth transitions")).toContain("animation-design");
  });

  it("detects copywriting-typography from a copy/type request (zh + en)", async () => {
    expect(await detectCapabilitiesFromText("优化界面文案和排版")).toContain("copywriting-typography");
    expect(await detectCapabilitiesFromText("improve the ui copy and tone of voice")).toContain("copywriting-typography");
  });

  it("detects accessibility from an a11y request (zh + en)", async () => {
    expect(await detectCapabilitiesFromText("做一下无障碍和键盘可达")).toContain("accessibility");
    expect(await detectCapabilitiesFromText("improve screen reader and keyboard navigation")).toContain("accessibility");
  });

  it("detects seo-metadata from an SEO request (zh + en)", async () => {
    expect(await detectCapabilitiesFromText("优化一下搜索引擎优化和分享卡片")).toContain("seo-metadata");
    expect(await detectCapabilitiesFromText("add open graph meta tags and structured data")).toContain("seo-metadata");
  });

  it("detects internationalization from an i18n request (zh + en)", async () => {
    expect(await detectCapabilitiesFromText("支持多语言和语言切换")).toContain("internationalization");
    expect(await detectCapabilitiesFromText("add i18n and right to left support")).toContain("internationalization");
  });

  it("detects navigation-ia from a navigation request (zh + en)", async () => {
    expect(await detectCapabilitiesFromText("设计导航栏和面包屑")).toContain("navigation-ia");
    expect(await detectCapabilitiesFromText("design the information architecture and nav bar")).toContain("navigation-ia");
  });

  it("detects empty-error-states from a states request (zh + en)", async () => {
    expect(await detectCapabilitiesFromText("加上空状态和骨架屏")).toContain("empty-error-states");
    expect(await detectCapabilitiesFromText("add empty state and skeleton screen")).toContain("empty-error-states");
  });

  it("detects webgl-3d from a 3D game request (zh + en)", async () => {
    expect(await detectCapabilitiesFromText("做一个3D网页游戏")).toContain("webgl-3d");
    expect(await detectCapabilitiesFromText("build a three.js 3d game")).toContain("webgl-3d");
  });

  it("detects testing from a tests request (zh + en)", async () => {
    expect(await detectCapabilitiesFromText("帮我写单元测试")).toContain("testing");
    expect(await detectCapabilitiesFromText("add unit tests and test coverage")).toContain("testing");
  });

  it("returns an empty array when nothing matches", async () => {
    const result = await detectCapabilitiesFromText("xyzzy plugh quux frobnicate");
    expect(result).toEqual([]);
  });

  it("caps results at MAX_CAPABILITIES (6) even when many capabilities match", async () => {
    const result = await detectCapabilitiesFromText(
      "做一个游戏，界面要好看，状态管理要清晰，接口对接要稳，功能填充完整，并做完备性检查",
    );
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it("combines several complementary capabilities for a broad request", async () => {
    // A rich prompt pulls in several skills now (cap 6) — the multi-skill
    // collaboration the tiered allocation enables.
    const result = await detectCapabilitiesFromText(
      "做一个漂亮的响应式落地页：定一套视觉风格和配色方案，加入场动效和过渡动画，优化界面文案和排版",
    );
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it("returns a single skill for a narrow request (dynamic count, not a fixed cap)", async () => {
    const result = await detectCapabilitiesFromText("帮我做一次完备性检查");
    expect(result.length).toBe(1);
    expect(result[0]).toBe("completeness-check");
  });

  it("does NOT fire on a single stray English word below the score threshold", async () => {
    // "review" (1) and "score" (1) are single-word hits worth 1 each — below the
    // min score of 3 — so a casual sentence must not pull in a capability.
    const result = await detectCapabilitiesFromText("please review the score shown on screen");
    expect(result).not.toContain("completeness-check");
    expect(result).not.toContain("game-design");
  });

  it("fires on a single phrase/Chinese hit (score 3)", async () => {
    const result = await detectCapabilitiesFromText("帮我做一次完备性检查");
    expect(result).toContain("completeness-check");
  });
});

describe("capability-loader: detailed detection", () => {
  it("returns score and matched keywords for observability", async () => {
    const matches = await detectCapabilitiesDetailed("build a snake game with score and levels");
    const game = matches.find((m) => m.name === "game-design");
    expect(game).toBeTruthy();
    expect(game!.score).toBeGreaterThanOrEqual(3);
    expect(game!.matched.length).toBeGreaterThan(0);
  });

  it("orders matches by descending score and caps at MAX_CAPABILITIES (6)", async () => {
    const matches = await detectCapabilitiesDetailed(
      "做一个游戏，界面要好看，状态管理要清晰，接口对接要稳，功能填充完整，并做完备性检查",
    );
    expect(matches.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });

  it("assigns the top matches to the full tier and the rest to digest", async () => {
    const matches = await detectCapabilitiesDetailed(
      "做一个漂亮的响应式落地页：定一套视觉风格和配色方案，加入场动效和过渡动画，优化界面文案和排版",
    );
    const fulls = matches.filter((m) => m.tier === "full");
    const digests = matches.filter((m) => m.tier === "digest");
    expect(fulls.length).toBeGreaterThanOrEqual(1);
    expect(fulls.length).toBeLessThanOrEqual(2); // FULL_CAPABILITIES default
    expect(digests.length).toBeGreaterThanOrEqual(1); // broad prompt → supporting digests
    // Every full-tier score >= every digest-tier score (sorted, top get full).
    const minFull = Math.min(...fulls.map((m) => m.score));
    const maxDigest = Math.max(...digests.map((m) => m.score));
    expect(minFull).toBeGreaterThanOrEqual(maxDigest);
  });

  it("a single strong match is full tier, no digests", async () => {
    const matches = await detectCapabilitiesDetailed("帮我做一次完备性检查");
    expect(matches).toHaveLength(1);
    expect(matches[0].tier).toBe("full");
  });

  it("returns an empty array when below threshold", async () => {
    const matches = await detectCapabilitiesDetailed("please review the score");
    expect(matches).toEqual([]);
  });
});

describe("capability-loader: loading", () => {
  it("loads a single capability wrapped with a Capability header", async () => {
    const content = await loadCapability("game-design");
    expect(content).toBeTruthy();
    expect(content).toContain("Game Design Skill");
  });

  it("returns null for an unknown capability", async () => {
    const content = await loadCapability("not-a-real-capability");
    expect(content).toBeNull();
  });

  it("joins multiple capabilities with Capability section headers", async () => {
    const content = await loadCapabilities(["game-design", "frontend-design"]);
    expect(content).toContain("### Capability: game-design");
    expect(content).toContain("### Capability: frontend-design");
    expect(content).toContain("\n\n---\n\n");
  });

  it("returns null when given no names", async () => {
    const content = await loadCapabilities([]);
    expect(content).toBeNull();
  });
});

describe("capability-loader: digest + tiered loading (token-aware)", () => {
  it("buildDigest yields the description + a checklist, far shorter than the full doc", async () => {
    const full = await loadCapability("seo-metadata");
    expect(full).toBeTruthy();
    const digest = buildDigest("seo-metadata", full!);
    expect(digest).toContain("Checklist:");
    expect(digest).toMatch(/- \[ \]/); // at least one checklist item
    // A digest must be substantially smaller than the full document.
    expect(digest.length).toBeLessThan(full!.length / 2);
  });

  it("buildDigest falls back to a header outline when there is no checklist", () => {
    const content = "# Some Skill\n\nA one-line description.\n\n## Section A\nbody\n\n## Section B\nbody";
    const digest = buildDigest("x", content);
    expect(digest).toContain("A one-line description.");
    expect(digest).toContain("Covers:");
    expect(digest).toContain("- Section A");
    expect(digest).toContain("- Section B");
  });

  it("loadCapabilitiesTiered injects full docs for full tier and digests for digest tier", async () => {
    const content = await loadCapabilitiesTiered([
      { name: "game-design", score: 9, matched: [], tier: "full" },
      { name: "frontend-design", score: 3, matched: [], tier: "digest" },
    ]);
    expect(content).toContain("### Capability: game-design");
    expect(content).toContain("### Capability (digest): frontend-design");
    // The digest entry carries a checklist, not the full frontend-design body.
    expect(content).toContain("Checklist:");
  });

  it("end-to-end: a broad prompt produces a mix of full + digest blocks", async () => {
    const matches = await detectCapabilitiesDetailed(
      "做一个漂亮的响应式落地页：定一套视觉风格和配色方案，加入场动效和过渡动画，优化界面文案和排版",
    );
    const content = await loadCapabilitiesTiered(matches);
    expect(content).toBeTruthy();
    expect(content).toContain("### Capability:"); // at least one full
    expect(content).toContain("### Capability (digest):"); // at least one digest
  });

  it("loadCapabilitiesTiered returns null for no matches", async () => {
    expect(await loadCapabilitiesTiered([])).toBeNull();
  });
});

