import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub withFallback so no real HTTP requests happen.
vi.mock("../kimi-client", () => ({
  withFallback: vi.fn(),
}));

import { detectSkillFromText, detectSkillsFromText, loadSkills, listSkills } from "../skill-loader";
import { withFallback } from "../kimi-client";

function mockLLMResponse(content: string | null) {
  (withFallback as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
    choices: [{ message: { content } }],
  }));
}

function mockLLMError(err: Error) {
  (withFallback as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
    throw err;
  });
}

describe("AG-12 detectSkillFromText (LLM with keyword fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the LLM's valid primary pick when JSON is well-formed", async () => {
    mockLLMResponse(JSON.stringify({ primary: "react", secondary: null }));
    const result = await detectSkillFromText("I want to build a thing", ["doubao"]);
    expect(result).toBe("react");
  });

  it("falls through to keyword scoring when LLM returns null primary", async () => {
    mockLLMResponse(JSON.stringify({ primary: null, secondary: null }));
    const result = await detectSkillFromText("Express REST API backend", ["doubao"]);
    expect(result).toBe("node-express");
  });

  it("falls through when LLM returns a skill name not in the registered list", async () => {
    mockLLMResponse(JSON.stringify({ primary: "not-a-real-skill", secondary: null }));
    const result = await detectSkillFromText("build me a React app", ["doubao"]);
    expect(result).toBe("react");
  });

  it("falls through when the LLM call throws", async () => {
    mockLLMError(new Error("network down"));
    const result = await detectSkillFromText("build me a React app", ["doubao"]);
    expect(result).toBe("react");
  });

  it("falls through when LLM returns non-JSON", async () => {
    mockLLMResponse("I think it's probably react");
    const result = await detectSkillFromText("build me a React app", ["doubao"]);
    expect(result).toBe("react");
  });

  it("skips the LLM entirely when providerChain is omitted", async () => {
    const result = await detectSkillFromText("Flutter app with material widgets");
    expect(result).toBe("flutter");
    expect(withFallback).not.toHaveBeenCalled();
  });

  it("skips the LLM entirely when providerChain is empty", async () => {
    const result = await detectSkillFromText("Flutter app with material widgets", []);
    expect(result).toBe("flutter");
    expect(withFallback).not.toHaveBeenCalled();
  });

  it("returns null when no skill matches and LLM says null", async () => {
    mockLLMResponse(JSON.stringify({ primary: null, secondary: null }));
    const result = await detectSkillFromText("asdfjkl qwerty", ["doubao"]);
    expect(result).toBeNull();
  });
});

describe("AG-13 detectSkillsFromText (multi-skill)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns both primary and secondary when LLM picks two", async () => {
    mockLLMResponse(JSON.stringify({ primary: "react-native-expo", secondary: "node-express" }));
    const result = await detectSkillsFromText("RN Expo app with an Express backend", ["doubao"]);
    expect(result).toEqual(["react-native-expo", "node-express"]);
  });

  it("returns only primary when secondary is null", async () => {
    mockLLMResponse(JSON.stringify({ primary: "react", secondary: null }));
    const result = await detectSkillsFromText("React SPA", ["doubao"]);
    expect(result).toEqual(["react"]);
  });

  it("dedups when LLM returns the same skill twice", async () => {
    mockLLMResponse(JSON.stringify({ primary: "react", secondary: "react" }));
    const result = await detectSkillsFromText("React app", ["doubao"]);
    expect(result).toEqual(["react"]);
  });

  it("drops an unknown secondary but keeps a valid primary", async () => {
    mockLLMResponse(JSON.stringify({ primary: "react", secondary: "not-real" }));
    const result = await detectSkillsFromText("React app", ["doubao"]);
    expect(result).toEqual(["react"]);
  });

  it("falls through to keyword scoring when both fields are null", async () => {
    mockLLMResponse(JSON.stringify({ primary: null, secondary: null }));
    const result = await detectSkillsFromText("Express REST API", ["doubao"]);
    expect(result[0]).toBe("node-express");
  });

  it("uses keyword fallback (capped at 2) when no provider chain", async () => {
    const result = await detectSkillsFromText("Flutter app with material widgets");
    expect(result.length).toBeLessThanOrEqual(2);
    expect(result[0]).toBe("flutter");
    expect(withFallback).not.toHaveBeenCalled();
  });
});

describe("AG-13 loadSkills", () => {
  it("returns null for an empty name list", async () => {
    const result = await loadSkills([]);
    expect(result).toBeNull();
  });

  it("concatenates multiple skill contents with separator and headers", async () => {
    const result = await loadSkills(["react", "node-express"]);
    expect(result).not.toBeNull();
    expect(result).toContain("### Skill: react");
    expect(result).toContain("### Skill: node-express");
    expect(result).toContain("\n\n---\n\n");
  });

  it("returns null when none of the names resolve", async () => {
    const result = await loadSkills(["not-a-skill-xyz"]);
    expect(result).toBeNull();
  });
});

describe("AG-12 listSkills (unchanged contract)", () => {
  it("returns skill metadata with name and description", async () => {
    const skills = await listSkills();
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.description).toBe("string");
    }
  });
});
