import { describe, it, expect } from "vitest";
import {
  getCompileCheck,
  buildEditorCompileCheckPrompt,
  buildVerifierCompileCheckPrompt,
} from "../compile-checks";

describe("AG-11 framework-specific compile checks", () => {
  describe("getCompileCheck", () => {
    it("returns tsc --noEmit for web projects", () => {
      const check = getCompileCheck("web");
      expect(check).not.toBeNull();
      expect(check!.command).toBe("tsc --noEmit");
    });

    it("returns tsc --noEmit for React Native / Expo", () => {
      const check = getCompileCheck("rn-expo");
      expect(check).not.toBeNull();
      expect(check!.command).toBe("tsc --noEmit");
    });

    it("returns flutter analyze for Flutter", () => {
      const check = getCompileCheck("flutter");
      expect(check).not.toBeNull();
      expect(check!.command).toBe("flutter analyze");
    });

    it("returns a gradle compileKotlin command for Kotlin", () => {
      const check = getCompileCheck("kotlin");
      expect(check).not.toBeNull();
      expect(check!.command).toContain("compileKotlin");
    });

    it("returns null for SwiftUI (no sandbox CLI check)", () => {
      expect(getCompileCheck("swiftui")).toBeNull();
    });
  });

  describe("buildEditorCompileCheckPrompt", () => {
    it("includes the command and request_review guidance for web", () => {
      const fragment = buildEditorCompileCheckPrompt("web");
      expect(fragment).toContain("tsc --noEmit");
      expect(fragment).toContain("request_review");
    });

    it("includes flutter analyze for Flutter", () => {
      const fragment = buildEditorCompileCheckPrompt("flutter");
      expect(fragment).toContain("flutter analyze");
    });

    it("returns empty string for SwiftUI (no check available)", () => {
      expect(buildEditorCompileCheckPrompt("swiftui")).toBe("");
    });
  });

  describe("buildVerifierCompileCheckPrompt", () => {
    it("tells the verifier to run the framework check and report_issue on failure", () => {
      const fragment = buildVerifierCompileCheckPrompt("rn-expo");
      expect(fragment).toContain("tsc --noEmit");
      expect(fragment).toContain("report_issue");
    });

    it("returns empty string for SwiftUI", () => {
      expect(buildVerifierCompileCheckPrompt("swiftui")).toBe("");
    });

    it("includes flutter analyze guidance for Flutter", () => {
      const fragment = buildVerifierCompileCheckPrompt("flutter");
      expect(fragment).toContain("flutter analyze");
      expect(fragment).toContain("report_issue");
    });
  });
});
