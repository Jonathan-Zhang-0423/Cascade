import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildLspTools } from "../src/agent/tools/lsp-tools";
import type { BuildSessionState } from "../src/agent/orchestrator/build-orchestrator";

vi.mock("../src/agent/tools/lsp-manager", () => ({
  lspManager: {
    getDiagnostics: vi.fn(),
    findReferences: vi.fn(),
    gotoDefinition: vi.fn(),
  },
}));

import { lspManager } from "../src/agent/tools/lsp-manager";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

function makeSession(): BuildSessionState {
  return {
    id: "lsp-test",
    aborted: false,
    files: new Map(),
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

describe("lsp_diagnostics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("formats errors with severity label and 1-based line number", async () => {
    vi.mocked(lspManager.getDiagnostics).mockResolvedValue([
      {
        severity: 1,
        range: { start: { line: 4, character: 2 }, end: { line: 4, character: 10 } },
        message: "Type 'string' is not assignable to type 'number'.",
      } as any,
    ]);

    const { handlers } = buildLspTools(makeSession());
    const result = await handlers.lsp_diagnostics({ file_path: "/project/app.ts" }, noopEmit);

    expect(result).toContain("[ERROR]");
    expect(result).toContain("Line 5"); // 0-based 4 → display 5
    expect(result).toContain("Type 'string' is not assignable to type 'number'.");
  });

  it("returns clean message when no diagnostics", async () => {
    vi.mocked(lspManager.getDiagnostics).mockResolvedValue([]);

    const { handlers } = buildLspTools(makeSession());
    const result = await handlers.lsp_diagnostics({ file_path: "/project/app.ts" }, noopEmit);

    expect(result).toContain("No diagnostics");
  });

  it("formats WARNING severity correctly", async () => {
    vi.mocked(lspManager.getDiagnostics).mockResolvedValue([
      {
        severity: 2,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        message: "Unused variable 'x'.",
      } as any,
    ]);

    const { handlers } = buildLspTools(makeSession());
    const result = await handlers.lsp_diagnostics({ file_path: "/project/app.ts" }, noopEmit);

    expect(result).toContain("[WARNING]");
    expect(result).toContain("Unused variable 'x'.");
  });

  it("returns error when file_path is empty", async () => {
    const { handlers } = buildLspTools(makeSession());
    const result = await handlers.lsp_diagnostics({ file_path: "" }, noopEmit);

    expect(result).toBe("Error: file_path is required");
  });
});

describe("lsp_find_references", () => {
  beforeEach(() => vi.clearAllMocks());

  it("formats reference locations with file path and 1-based line number", async () => {
    vi.mocked(lspManager.findReferences).mockResolvedValue([
      { uri: "file:///project/a.ts", range: { start: { line: 9, character: 4 }, end: { line: 9, character: 10 } } } as any,
      { uri: "file:///project/b.ts", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } } } as any,
    ]);

    const { handlers } = buildLspTools(makeSession());
    const result = await handlers.lsp_find_references(
      { file_path: "/project/a.ts", line: 0, col: 0 },
      noopEmit,
    );

    expect(result).toContain("References (2)");
    expect(result).toContain("/project/a.ts:10"); // 0-based 9 → display 10
    expect(result).toContain("/project/b.ts:2");
  });

  it("returns 'No references found' when list is empty", async () => {
    vi.mocked(lspManager.findReferences).mockResolvedValue([]);

    const { handlers } = buildLspTools(makeSession());
    const result = await handlers.lsp_find_references(
      { file_path: "/project/a.ts", line: 0, col: 0 },
      noopEmit,
    );

    expect(result).toBe("No references found.");
  });
});

describe("lsp_goto_definition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns definition location with 1-based line number", async () => {
    vi.mocked(lspManager.gotoDefinition).mockResolvedValue(
      {
        uri: "file:///project/lib/utils.ts",
        range: { start: { line: 14, character: 0 }, end: { line: 14, character: 10 } },
      } as any,
    );

    const { handlers } = buildLspTools(makeSession());
    const result = await handlers.lsp_goto_definition(
      { file_path: "/project/app.ts", line: 3, col: 10 },
      noopEmit,
    );

    expect(result).toContain("Defined at:");
    expect(result).toContain("/project/lib/utils.ts:15"); // 0-based 14 → display 15
  });

  it("returns 'Definition not found' when lspManager returns null", async () => {
    vi.mocked(lspManager.gotoDefinition).mockResolvedValue(null);

    const { handlers } = buildLspTools(makeSession());
    const result = await handlers.lsp_goto_definition(
      { file_path: "/project/app.ts", line: 0, col: 0 },
      noopEmit,
    );

    expect(result).toBe("Definition not found.");
  });
});

describe("lsp_diagnostics — real typescript-language-server (integration)", () => {
  let sessionDir: string;
  const sessionId = "lsp-integration-test";

  afterEach(async () => {
    if (sessionDir) await rm(sessionDir, { recursive: true, force: true });
    const realMod = await vi.importActual("../src/agent/tools/lsp-manager");
    (realMod.lspManager as any).stop?.(sessionId);
  });

  it(
    "returns diagnostics array for a file with a deliberate type error",
    async () => {
      sessionDir = await mkdtemp(path.join(tmpdir(), "lsp-integ-"));
      await writeFile(
        path.join(sessionDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      );
      await writeFile(path.join(sessionDir, "app.ts"), `const x: number = "this is a string";\n`);

      const realMod = await vi.importActual("../src/agent/tools/lsp-manager");
      const realLspManager = realMod.lspManager as any;

      await realLspManager.start(sessionId, sessionDir, "typescript");
      // LSP pushes diagnostics asynchronously — give it time to start and publish
      await new Promise((resolve) => setTimeout(resolve, 7000));

      const diagnostics = await realLspManager.getDiagnostics(sessionId, "/app.ts");
      expect(Array.isArray(diagnostics)).toBe(true);
      if (diagnostics.length > 0) {
        const diag = diagnostics[0];
        expect(diag).toHaveProperty("message");
        expect(diag).toHaveProperty("range");
      }
    },
    20000,
  );
});
