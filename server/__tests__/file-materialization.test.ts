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

describe("write_file handler — disk mirror", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("mirrors written file content to sessionDir on disk", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "codestart-test-"));
    const session = makeSession({ sessionDir: tmpDir });
    const { handlers } = buildBuilderTools(session, []);

    await handlers.write_file({ path: "/project/index.ts", content: "const x = 1;" }, noopEmit);

    const abs = path.join(tmpDir, "project/index.ts");
    const diskContent = await readFile(abs, "utf-8");
    expect(diskContent).toBe("const x = 1;");
  });

  it("also updates session.files map", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "codestart-test-"));
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
  });

  it("creates nested directories for deep paths", async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "codestart-test-"));
    const session = makeSession({ sessionDir: tmpDir });
    const { handlers } = buildBuilderTools(session, []);

    await handlers.write_file({ path: "/project/src/components/Button.tsx", content: "export {};" }, noopEmit);

    const abs = path.join(tmpDir, "project/src/components/Button.tsx");
    const diskContent = await readFile(abs, "utf-8");
    expect(diskContent).toBe("export {};");
  });
});
