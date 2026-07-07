import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { createHash } from "crypto";
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

function versionHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

describe("write_file handler — disk mirror", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("mirrors written file content to sessionDir on disk", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "cascade-test-"));
    const session = makeSession({ sessionDir: tmpDir });
    const { handlers } = buildBuilderTools(session, []);

    await handlers.write_file({ path: "/project/index.ts", content: "const x = 1;" }, noopEmit);

    const abs = path.join(tmpDir, "project/index.ts");
    const diskContent = await readFile(abs, "utf-8");
    expect(diskContent).toBe("const x = 1;");
  });

  it("also updates session.files map", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "cascade-test-"));
    const session = makeSession({ sessionDir: tmpDir });
    const { handlers } = buildBuilderTools(session, []);

    await handlers.write_file({ path: "/project/app.ts", content: "export default {};" }, noopEmit);

    expect(session.files.get("/project/app.ts")).toBe("export default {};");
  });

  it("skips disk mirror when sessionDir is undefined", async () => {
    const session = makeSession({ sessionDir: undefined });
    const { handlers } = buildBuilderTools(session, []);

    await expect(
      handlers.write_file({ path: "/project/app.ts", content: "hello" }, noopEmit)
    ).resolves.toContain("File written successfully");
    // In-memory map is still updated even without a sessionDir
    expect(session.files.get("/project/app.ts")).toBe("hello");
  });

  it("creates nested directories for deep paths", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "cascade-test-"));
    const session = makeSession({ sessionDir: tmpDir });
    const { handlers } = buildBuilderTools(session, []);

    await handlers.write_file({ path: "/project/src/components/Button.tsx", content: "export {};" }, noopEmit);

    const abs = path.join(tmpDir, "project/src/components/Button.tsx");
    const diskContent = await readFile(abs, "utf-8");
    expect(diskContent).toBe("export {};");
  });

  it("refuses to overwrite an existing file before reading the current version", async () => {
    const session = makeSession({
      files: new Map([["/project/app.ts", "export const value = 1;"]]),
    });
    const { handlers } = buildBuilderTools(session, []);

    const result = (await handlers.write_file(
      { path: "/project/app.ts", content: "export const value = 2;" },
      noopEmit,
    )) as string;

    expect(result).toContain("refusing full overwrite");
    expect(session.files.get("/project/app.ts")).toBe("export const value = 1;");
  });

  it("allows an existing-file full rewrite after read_file establishes the current hash", async () => {
    const original = "export const value = 1;";
    const session = makeSession({
      files: new Map([["/project/app.ts", original]]),
    });
    const { handlers } = buildBuilderTools(session, []);

    const readResult = (await handlers.read_file({ path: "/project/app.ts" }, noopEmit)) as string;
    expect(readResult).toContain(`File version hash: ${versionHash(original)}`);
    const result = (await handlers.write_file(
      { path: "/project/app.ts", content: "export const value = 2;" },
      noopEmit,
    )) as string;

    expect(result).toContain("File written successfully");
    expect(session.files.get("/project/app.ts")).toBe("export const value = 2;");
  });

  it("rejects stale expected_hash when overwriting an existing file", async () => {
    const session = makeSession({
      files: new Map([["/project/app.ts", "export const value = 1;"]]),
    });
    const { handlers } = buildBuilderTools(session, []);

    const result = (await handlers.write_file(
      { path: "/project/app.ts", content: "export const value = 2;", expected_hash: "deadbeef0000" },
      noopEmit,
    )) as string;

    expect(result).toContain("changed since the version");
    expect(session.files.get("/project/app.ts")).toBe("export const value = 1;");
  });
});
