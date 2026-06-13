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

  it("returns an empty array when nothing matches", async () => {
    const result = await detectCapabilitiesFromText("xyzzy plugh quux frobnicate");
    expect(result).toEqual([]);
  });

  it("caps results at 2 even when many capabilities match", async () => {
    const result = await detectCapabilitiesFromText(
      "做一个游戏，界面要好看，状态管理要清晰，接口对接要稳，功能填充完整，并做完备性检查",
    );
    expect(result.length).toBeLessThanOrEqual(2);
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

  it("orders matches by descending score and caps at 2", async () => {
    const matches = await detectCapabilitiesDetailed(
      "做一个游戏，界面要好看，状态管理要清晰，接口对接要稳，功能填充完整，并做完备性检查",
    );
    expect(matches.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
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
