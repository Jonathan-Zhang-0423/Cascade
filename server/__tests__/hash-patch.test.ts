import { describe, it, expect } from "vitest";
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
  } as unknown as BuildSessionState;
}

const noopEmit = () => {};

describe("AG-16 hash_patch_file handler", () => {
  it("replaces a block when the hash matches", async () => {
    const src =
      "export const PI = 3.14;\n\n" +
      "function add(a: number, b: number): number {\n  return a + b;\n}\n\n" +
      "function sub(a: number, b: number): number {\n  return a - b;\n}\n";
    const files = new Map<string, string>([["/project/calc.ts", src]]);
    const session = makeSession({ files });
    const { handlers } = buildBuilderTools(session, []);

    const readOut = (await handlers.read_file({ path: "/project/calc.ts" }, noopEmit)) as string;
    const match = /\[([0-9a-f]{8})\]\s+function add/.exec(readOut);
    expect(match).not.toBeNull();
    const addHash = match![1];

    const res = (await handlers.hash_patch_file(
      { path: "/project/calc.ts", region_hash: addHash, new_content: "function add(a: number, b: number): number {\n  return a + b + 0;\n}" },
      noopEmit,
    )) as string;
    expect(res).toContain("File patched");
    expect(session.files.get("/project/calc.ts")).toContain("return a + b + 0;");
    expect(session.files.get("/project/calc.ts")).toContain("return a - b;");
  });

  it("returns an error listing available hashes when region_hash not found", async () => {
    const src = "function foo() { return 1; }\nfunction bar() { return 2; }\n";
    const files = new Map<string, string>([["/project/calc.ts", src]]);
    const session = makeSession({ files });
    const { handlers } = buildBuilderTools(session, []);
    const res = (await handlers.hash_patch_file(
      { path: "/project/calc.ts", region_hash: "deadbeef", new_content: "function foo() { return 99; }" },
      noopEmit,
    )) as string;
    expect(res).toContain("not found");
    expect(res).toMatch(/\[[0-9a-f]{8}\]/);
    expect(session.files.get("/project/calc.ts")).toContain("return 1;");
  });

  it("returns a clean error when the file has no extractable blocks", async () => {
    const files = new Map<string, string>([
      ["/project/empty.txt", "just some plain text\nwith nothing structural\n"],
    ]);
    const session = makeSession({ files });
    const { handlers } = buildBuilderTools(session, []);
    const res = (await handlers.hash_patch_file(
      { path: "/project/empty.txt", region_hash: "deadbeef", new_content: "replacement" },
      noopEmit,
    )) as string;
    expect(res).toContain("no blocks could be extracted");
  });

  it("returns an error when the file doesn't exist", async () => {
    const session = makeSession();
    const { handlers } = buildBuilderTools(session, []);
    const res = (await handlers.hash_patch_file(
      { path: "/project/missing.ts", region_hash: "deadbeef", new_content: "x" },
      noopEmit,
    )) as string;
    expect(res).toContain("file not found");
  });
});

describe("AG-16 read_file block index", () => {
  it("appends a block index to the response for parseable files", async () => {
    const files = new Map<string, string>([
      ["/project/a.ts", "function greet(name: string) {\n  return `hi`;\n}\n"],
    ]);
    const session = makeSession({ files });
    const { handlers } = buildBuilderTools(session, []);
    const res = (await handlers.read_file({ path: "/project/a.ts" }, noopEmit)) as string;
    expect(res).toContain("Block hashes");
    expect(res).toMatch(/\[[0-9a-f]{8}\]\s+function greet/);
  });

  it("does NOT append a block index when no blocks are extractable", async () => {
    const files = new Map<string, string>([
      ["/project/plain.txt", "hello world\n"],
    ]);
    const session = makeSession({ files });
    const { handlers } = buildBuilderTools(session, []);
    const res = (await handlers.read_file({ path: "/project/plain.txt" }, noopEmit)) as string;
    expect(res).not.toContain("Block hashes");
  });
});
