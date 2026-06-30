import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { buildBuilderTools } from "../src/agent/tools/agent-tools";
import type { BuildSessionState } from "../src/agent/orchestrator/build-orchestrator";

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

  it("refuses an ambiguous patch when old_content appears multiple times (no silent first-match)", async () => {
    const session = makeSession();
    session.files.set("/project/app.ts", "foo\nfoo\nbar\n");
    const { handlers } = buildBuilderTools(session, []);

    const result = (await handlers.patch_file(
      { path: "/project/app.ts", old_content: "foo", new_content: "baz" },
      noopEmit,
    )) as string;

    expect(result).toContain("Error:");
    expect(result).toContain("ambiguous");
    expect(result).toContain("2 times");
    // File must be unchanged — no silent first-occurrence patch.
    expect(session.files.get("/project/app.ts")).toBe("foo\nfoo\nbar\n");
  });

  it("patches a once-unique match even if a similar substring appears elsewhere", async () => {
    const session = makeSession();
    session.files.set("/project/app.ts", "foo\nfoobar\n");
    const { handlers } = buildBuilderTools(session, []);

    // "foo\n" occurs once verbatim (the "foo" inside "foobar" has no newline).
    const result = (await handlers.patch_file(
      { path: "/project/app.ts", old_content: "foo\n", new_content: "baz\n" },
      noopEmit,
    )) as string;

    expect(result).toContain("File patched successfully");
    expect(session.files.get("/project/app.ts")).toBe("baz\nfoobar\n");
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

describe("delete_file handler", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("removes the file from session.files and reports success", async () => {
    const session = makeSession();
    session.files.set("/project/dead.ts", "obsolete");
    session.files.set("/project/keep.ts", "alive");
    const { handlers } = buildBuilderTools(session, []);

    const result = (await handlers.delete_file({ path: "/project/dead.ts" }, noopEmit)) as string;

    expect(result).toContain("File deleted");
    expect(session.files.has("/project/dead.ts")).toBe(false);
    expect(session.files.has("/project/keep.ts")).toBe(true);
  });

  it("emits a file_deleted event so the client can update the preview/tree", async () => {
    const session = makeSession();
    session.files.set("/project/dead.ts", "x");
    const { handlers } = buildBuilderTools(session, []);
    const events: Array<Record<string, unknown>> = [];

    await handlers.delete_file({ path: "/project/dead.ts" }, (e) => events.push(e));

    expect(events.some((e) => e.type === "file_deleted" && e.filePath === "/project/dead.ts")).toBe(true);
  });

  it("removes the disk mirror when sessionDir is set", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "cascade-delete-test-"));
    const session = makeSession({ sessionDir: tmpDir });
    session.files.set("/project/app.ts", "data");
    const { handlers } = buildBuilderTools(session, []);
    // Create the mirror first via write_file.
    await handlers.write_file({ path: "/project/app.ts", content: "data" }, noopEmit);

    await handlers.delete_file({ path: "/project/app.ts" }, noopEmit);

    const abs = path.join(tmpDir, "project/app.ts");
    await expect(readFile(abs, "utf-8")).rejects.toThrow();
  });

  it("returns an error when the file does not exist", async () => {
    const session = makeSession();
    const { handlers } = buildBuilderTools(session, []);

    const result = (await handlers.delete_file({ path: "/project/missing.ts" }, noopEmit)) as string;

    expect(result).toContain("Error:");
    expect(result).toContain("file not found");
  });

  it("returns an error when path is missing", async () => {
    const session = makeSession();
    const { handlers } = buildBuilderTools(session, []);

    const result = (await handlers.delete_file({}, noopEmit)) as string;
    expect(result).toContain("Error:");
  });
});
