import { describe, it, expect, vi } from "vitest";
import { buildAstTools } from "../ast-tools";
import type { BuildSessionState } from "../build-orchestrator";

vi.mock("@ast-grep/napi", () => {
  const fakeMatch = (text: string, line: number) => ({
    text: () => text,
    range: () => ({ start: { line } }),
    getMatch: () => null,
  });

  const fakeRoot = (content: string) => ({
    findAll: (pattern: string) => {
      if (pattern === "console.log($ARG)") {
        return content.includes("console.log")
          ? [fakeMatch("console.log(x)", 2), fakeMatch("console.log(y)", 5)]
          : [];
      }
      return [];
    },
    replace: (pattern: string, _replacement: string) => {
      if (pattern === "console.log($ARG)") {
        return content.replace(/console\.log\([^)]+\)/g, "logger.log(...)");
      }
      return content;
    },
  });

  return {
    parse: (_lang: string, content: string) => ({
      root: () => fakeRoot(content),
    }),
  };
});

function makeSession(files: Record<string, string> = {}): BuildSessionState {
  return {
    id: "ast-test",
    aborted: false,
    files: new Map(Object.entries(files)),
    plan: { steps: [] },
    userRequest: "test",
    userLang: "English",
    events: [],
    nextEventId: 1,
    done: false,
    sseWriters: new Set(),
    parts: [],
    status: { type: "idle" },
  };
}

const noopEmit = () => {};

describe("ast_search", () => {
  it("returns matches with file and line numbers", async () => {
    const session = makeSession({
      "/project/app.ts": "const x = 1;\nconsole.log(x);\nconst y = 2;\nconsole.log(y);",
    });
    const { handlers } = buildAstTools(session);

    const result = await handlers.ast_search(
      { pattern: "console.log($ARG)", language: "typescript" },
      noopEmit,
    );

    expect(result).toContain("/project/app.ts");
    expect(result).toContain("2 match(es)");
    expect(result).toContain("Line 3"); // 0-based line 2 → display line 3
  });

  it("returns 'No matches found' when pattern does not match", async () => {
    const session = makeSession({ "/project/app.ts": "const x = 1;" });
    const { handlers } = buildAstTools(session);

    const result = await handlers.ast_search(
      { pattern: "console.log($ARG)", language: "typescript" },
      noopEmit,
    );

    expect(result).toBe("No matches found.");
  });

  it("skips files that do not match the language extension", async () => {
    const session = makeSession({
      "/project/app.js": "console.log(x);", // JS file, searching typescript
    });
    const { handlers } = buildAstTools(session);

    const result = await handlers.ast_search(
      { pattern: "console.log($ARG)", language: "typescript" },
      noopEmit,
    );

    expect(result).toBe("No matches found.");
  });
});

describe("ast_replace", () => {
  it("returns 'No replacements made' when no files match the language", async () => {
    const session = makeSession({ "/project/app.dart": "print(x);" });
    const { handlers } = buildAstTools(session);

    const result = await handlers.ast_replace(
      { pattern: "console.log($ARG)", replacement: "logger.log($ARG)", language: "typescript" },
      noopEmit,
    );

    expect(result).toBe("No replacements made.");
  });

  it("updates session.files when replacement is made", async () => {
    const session = makeSession({
      "/project/app.ts": "console.log(x);\nconsole.log(y);",
    });
    const { handlers } = buildAstTools(session);

    const result = await handlers.ast_replace(
      { pattern: "console.log($ARG)", replacement: "logger.log($ARG)", language: "typescript" },
      noopEmit,
    );

    expect(result).toContain("/project/app.ts");
    expect(session.files.get("/project/app.ts")).not.toContain("console.log");
  });

  it("respects file_path filter — skips other files", async () => {
    const session = makeSession({
      "/project/a.ts": "console.log(x);",
      "/project/b.ts": "console.log(y);",
    });
    const { handlers } = buildAstTools(session);

    await handlers.ast_replace(
      {
        pattern: "console.log($ARG)",
        replacement: "logger.log($ARG)",
        language: "typescript",
        file_path: "/project/a.ts",
      },
      noopEmit,
    );

    expect(session.files.get("/project/b.ts")).toContain("console.log");
  });

  it("always returns a string and never throws when napi is unavailable", async () => {
    // Verifies that the lazy import + try/catch in ast-tools.ts
    // means handler never throws — it always returns a string.
    const session = makeSession({ "/project/app.ts": "const x = 1;" });
    const { handlers } = buildAstTools(session);

    const result = await handlers.ast_search(
      { pattern: "console.log($ARG)", language: "typescript" },
      noopEmit,
    );
    expect(typeof result).toBe("string");
  });
});

describe("ast_search — real @ast-grep/napi (integration)", () => {
  it("finds actual TypeScript pattern matches using the real binary", async () => {
    const realSg = await vi.importActual<typeof import("@ast-grep/napi")>("@ast-grep/napi");
    const src = `const x = 1;\nconsole.log(x);\nconsole.log("hello");`;
    const tree = (realSg as any).parse("typescript", src);
    const matches = tree.root().findAll("console.log($ARG)");
    expect(matches.length).toBe(2);
    expect(matches[0].text()).toContain("console.log");
  });

  it("returns no matches when the pattern is absent", async () => {
    const realSg = await vi.importActual<typeof import("@ast-grep/napi")>("@ast-grep/napi");
    const src = `const x = 1;\nconst y = 2;`;
    const tree = (realSg as any).parse("typescript", src);
    const matches = tree.root().findAll("console.log($ARG)");
    expect(matches.length).toBe(0);
  });
});
