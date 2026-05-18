import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { buildBuilderTools } from "../agent-tools";
import type { BuildSessionState } from "../build-orchestrator";

function makeSession(overrides: Partial<BuildSessionState> = {}): BuildSessionState {
  return {
    id: "test-session",
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
    ...overrides,
  };
}

const noopEmit = () => {};

describe("patch_file handler", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("replaces matched section and updates session.files", async () => {
    const session = makeSession();
    session.files.set("/project/app.ts", "const x = 1;\nconst y = 2;\n");
    const { handlers } = buildBuilderTools(session, []);

    const result = await handlers.patch_file(
      { path: "/project/app.ts", old_content: "const x = 1;", new_content: "const x = 99;" },
      noopEmit,
    );

    expect(result).toContain("File patched successfully");
    expect(session.files.get("/project/app.ts")).toBe("const x = 99;\nconst y = 2;\n");
  });

  it("mirrors patched content to disk when sessionDir is set", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "cascade-patch-test-"));
    const session = makeSession({ sessionDir: tmpDir });
    session.files.set("/project/app.ts", "hello world");
    const { handlers } = buildBuilderTools(session, []);

    await handlers.patch_file(
      { path: "/project/app.ts", old_content: "hello", new_content: "goodbye" },
      noopEmit,
    );

    const abs = path.join(tmpDir, "project/app.ts");
    const diskContent = await readFile(abs, "utf-8");
    expect(diskContent).toBe("goodbye world");
  });

  it("replaces only the first occurrence when old_content appears multiple times", async () => {
    const session = makeSession();
    session.files.set("/project/app.ts", "foo\nfoo\nbar\n");
    const { handlers } = buildBuilderTools(session, []);

    await handlers.patch_file(
      { path: "/project/app.ts", old_content: "foo", new_content: "baz" },
      noopEmit,
    );

    expect(session.files.get("/project/app.ts")).toBe("baz\nfoo\nbar\n");
  });

  it("returns error when file does not exist", async () => {
    const session = makeSession();
    const { handlers } = buildBuilderTools(session, []);

    const result = await handlers.patch_file(
      { path: "/project/missing.ts", old_content: "x", new_content: "y" },
      noopEmit,
    );

    expect(result).toContain("Error:");
    expect(result).toContain("file not found");
    expect(result).toContain("write_file");
  });

  it("returns error when old_content is not found verbatim", async () => {
    const session = makeSession();
    session.files.set("/project/app.ts", "const x = 1;");
    const { handlers } = buildBuilderTools(session, []);

    const result = await handlers.patch_file(
      { path: "/project/app.ts", old_content: "const z = 999;", new_content: "const z = 0;" },
      noopEmit,
    );

    expect(result).toContain("Error:");
    expect(result).toContain("not found verbatim");
    // File must be unchanged
    expect(session.files.get("/project/app.ts")).toBe("const x = 1;");
  });

  it("returns error when required args are missing", async () => {
    const session = makeSession();
    const { handlers } = buildBuilderTools(session, []);

    const result = await handlers.patch_file({ path: "/project/app.ts" }, noopEmit);

    expect(result).toContain("Error:");
  });

  it("succeeds without disk write when sessionDir is undefined", async () => {
    const session = makeSession({ sessionDir: undefined });
    session.files.set("/project/app.ts", "original content");
    const { handlers } = buildBuilderTools(session, []);

    const result = await handlers.patch_file(
      { path: "/project/app.ts", old_content: "original", new_content: "updated" },
      noopEmit,
    );

    expect(result).toContain("File patched successfully");
    expect(session.files.get("/project/app.ts")).toBe("updated content");
  });

  it("return value includes replaced char counts", async () => {
    const session = makeSession();
    session.files.set("/project/app.ts", "abcdef");
    const { handlers } = buildBuilderTools(session, []);

    const result = (await handlers.patch_file(
      { path: "/project/app.ts", old_content: "abc", new_content: "xy" },
      noopEmit,
    )) as string;

    // "replaced 3 chars with 2 chars"
    expect(result).toMatch(/replaced \d+ chars with \d+ chars/);
  });
});
