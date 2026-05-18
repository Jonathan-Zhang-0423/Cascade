import { describe, it, expect } from "vitest";
import { extractBlocks, applyBlockReplacement, formatBlockIndex } from "../block-hash";

describe("AG-16 extractBlocks (TS via ast-grep)", () => {
  it("finds top-level function, class, and const export in a TS file", async () => {
    const src = `export const DEFAULT_TIMEOUT = 5000;

function handleLogin(user: string): boolean {
  return true;
}

export class AuthService {
  login() {
    return null;
  }
}
`;
    const blocks = await extractBlocks("/project/app.ts", src);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain("function");
    expect(kinds).toContain("class");
    // The const export maps to "export" kind (export_statement) in ast-grep
    expect(kinds.some((k) => k === "export" || k === "variable")).toBe(true);
  });

  it("produces stable hashes across runs for the same content", async () => {
    const src = `function foo() { return 1; }\nfunction bar() { return 2; }\n`;
    const a = await extractBlocks("/project/a.ts", src);
    const b = await extractBlocks("/project/a.ts", src);
    expect(a.map((x) => x.hash)).toEqual(b.map((x) => x.hash));
  });

  it("deduplicates hashes when two blocks have identical text", async () => {
    const src = `function same() { return 1; }\nfunction same() { return 1; }\n`;
    const blocks = await extractBlocks("/project/dup.ts", src);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const hashes = blocks.map((b) => b.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("ignores trailing whitespace differences when computing hashes", async () => {
    const a = `function foo() {\n  return 1;\n}\n`;
    const b = `function foo() {   \n  return 1;\n}\n`;
    const [blockA] = await extractBlocks("/project/a.ts", a);
    const [blockB] = await extractBlocks("/project/b.ts", b);
    expect(blockA.hash).toBe(blockB.hash);
  });
});

describe("AG-16 extractBlocks (regex fallback)", () => {
  it("finds python top-level defs and classes", async () => {
    const src = `def greet(name):
    return f"Hello, {name}"

class Calculator:
    def add(self, a, b):
        return a + b
`;
    const blocks = await extractBlocks("/project/app.py", src);
    expect(blocks.length).toBe(2);
    expect(blocks[0].kind).toBe("function");
    expect(blocks[0].name).toBe("greet");
    expect(blocks[1].kind).toBe("class");
    expect(blocks[1].name).toBe("Calculator");
  });

  it("returns empty array for unparseable content", async () => {
    const blocks = await extractBlocks("/project/empty.txt", "just some random text\nwith nothing structural\n");
    expect(blocks).toEqual([]);
  });
});

describe("AG-16 applyBlockReplacement", () => {
  it("splices replacement into the block's line range", async () => {
    const src = `const HEADER = 1;\n\nfunction foo() {\n  return 1;\n}\n\nconst FOOTER = 3;\n`;
    const blocks = await extractBlocks("/project/a.ts", src);
    const foo = blocks.find((b) => b.name === "foo");
    expect(foo).toBeDefined();
    const patched = applyBlockReplacement(src, foo!, `function foo() {\n  return 42;\n}`);
    expect(patched).toContain("return 42");
    expect(patched).toContain("const HEADER = 1;");
    expect(patched).toContain("const FOOTER = 3;");
  });
});

describe("AG-16 formatBlockIndex", () => {
  it("formats blocks into a compact listing", async () => {
    const src = `function greet() {\n  return "hi";\n}\n`;
    const blocks = await extractBlocks("/project/g.ts", src);
    const out = formatBlockIndex(blocks);
    expect(out).toContain("Block hashes");
    expect(out).toMatch(/\[[0-9a-f]{8}\] function greet/);
  });

  it("returns empty string when there are no blocks", () => {
    expect(formatBlockIndex([])).toBe("");
  });
});
