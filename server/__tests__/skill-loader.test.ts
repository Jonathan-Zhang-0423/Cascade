import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub withFallback so no real HTTP requests happen.
vi.mock("../kimi-client", () => ({
  withFallback: vi.fn(),
}));

import { detectSkillFromText, listSkills } from "../skill-loader";
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

  it("returns the LLM's valid skill pick when JSON is well-formed", async () => {
    mockLLMResponse(JSON.stringify({ skill: "react" }));
    const result = await detectSkillFromText("I want to build a thing", ["doubao"]);
    expect(result).toBe("react");
  });

  it("falls through to keyword scoring when LLM returns null", async () => {
    mockLLMResponse(JSON.stringify({ skill: null }));
    // "Express REST API" has strong keywords → keyword scorer picks node-express
    const result = await detectSkillFromText("Express REST API backend", ["doubao"]);
    expect(result).toBe("node-express");
  });

  it("falls through when LLM returns a skill name not in the registered list", async () => {
    mockLLMResponse(JSON.stringify({ skill: "not-a-real-skill" }));
    const result = await detectSkillFromText("build me a React app", ["doubao"]);
    expect(result).toBe("react"); // keyword fallback detects it
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
    mockLLMResponse(JSON.stringify({ skill: null }));
    const result = await detectSkillFromText("asdfjkl qwerty", ["doubao"]);
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
