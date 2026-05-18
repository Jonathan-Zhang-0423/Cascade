import { createHash } from "crypto";

export interface Block {
  hash: string;
  kind: string;
  name?: string;
  startLine: number;
  endLine: number;
  text: string;
}

const TS_TARGET_KINDS = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "abstract_class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "export_statement",
  "lexical_declaration",
  "variable_statement",
]);

function kindToLabel(kind: string, text = ""): string {
  if (kind === "export_statement") {
    if (/^export\s+(?:default\s+)?(?:async\s+)?function\b/.test(text)) return "function";
    if (/^export\s+(?:default\s+)?(?:abstract\s+)?class\b/.test(text)) return "class";
    if (/^export\s+interface\b/.test(text)) return "interface";
    if (/^export\s+type\b/.test(text)) return "type";
    if (/^export\s+enum\b/.test(text)) return "enum";
    if (/^export\s+(?:const|let|var)\b/.test(text)) return "variable";
    return "export";
  }
  if (kind.includes("function")) return "function";
  if (kind.includes("class")) return "class";
  if (kind === "interface_declaration") return "interface";
  if (kind === "type_alias_declaration") return "type";
  if (kind === "enum_declaration") return "enum";
  if (kind === "lexical_declaration" || kind === "variable_statement") return "variable";
  return "statement";
}

function normalizeText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}

function hashText(text: string, salt = ""): string {
  return createHash("sha256").update(salt + normalizeText(text)).digest("hex").slice(0, 8);
}

export async function extractBlocks(filePath: string, content: string): Promise<Block[]> {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
    const blocks = await extractTsBlocks(filePath, content, ext);
    if (blocks.length > 0) return blocks;
  }
  return extractRegexBlocks(content);
}

async function extractTsBlocks(filePath: string, content: string, ext: string): Promise<Block[]> {
  let sg: typeof import("@ast-grep/napi") | null = null;
  try {
    sg = await import("@ast-grep/napi");
  } catch {
    return [];
  }

  const lang = ext.endsWith("x") ? "Tsx" : (ext === "ts" ? "TypeScript" : "JavaScript");

  let root: any;
  try {
    const tree = (sg as any).parse(lang, content);
    root = tree.root();
  } catch {
    return [];
  }

  const results: Array<Omit<Block, "hash">> = [];
  const children: any[] =
    typeof root.children === "function" ? root.children() : (root as any).children ?? [];

  for (const node of children) {
    const kind = typeof node.kind === "function" ? node.kind() : node.kind;
    if (!TS_TARGET_KINDS.has(kind)) continue;
    const range = node.range();
    const text = node.text();
    results.push({
      kind: kindToLabel(kind, text),
      name: extractName(node, text),
      startLine: range.start.line + 1,
      endLine: range.end.line + 1,
      text,
    });
  }

  return assignHashes(results, filePath);
}

function extractName(node: any, text: string): string | undefined {
  try {
    const nameNode = typeof node.field === "function" ? node.field("name") : null;
    if (nameNode) {
      const n = typeof nameNode.text === "function" ? nameNode.text() : undefined;
      if (n) return n;
    }
  } catch {
    // ignore
  }
  const m = /\b(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(text);
  return m?.[1];
}

const REGEX_BLOCK_PATTERNS: Array<{ re: RegExp; kind: string }> = [
  { re: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { re: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/, kind: "type" },
  { re: /^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "enum" },
  { re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: "variable" },
  { re: /^def\s+([A-Za-z_][\w]*)/, kind: "function" },
  { re: /^class\s+([A-Za-z_][\w]*)/, kind: "class" },
  { re: /^fun\s+([A-Za-z_][\w]*)/, kind: "function" },
  { re: /^(?:public\s+|private\s+|internal\s+)?class\s+([A-Za-z_][\w]*)/, kind: "class" },
  { re: /^func\s+([A-Za-z_][\w]*)/, kind: "function" },
  { re: /^struct\s+([A-Za-z_][\w]*)/, kind: "struct" },
  { re: /^void\s+([A-Za-z_][\w]*)\s*\(/, kind: "function" },
  { re: /^Widget\s+([A-Za-z_][\w]*)\s*\(/, kind: "function" },
];

function extractRegexBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const starts: Array<{ line: number; kind: string; name: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 || /^\s/.test(line)) continue;
    for (const { re, kind } of REGEX_BLOCK_PATTERNS) {
      const m = re.exec(line);
      if (m) {
        starts.push({ line: i, kind, name: m[1] });
        break;
      }
    }
  }

  if (starts.length === 0) return [];

  const bare: Array<Omit<Block, "hash">> = [];
  for (let idx = 0; idx < starts.length; idx++) {
    const start = starts[idx];
    const endExclusive = idx + 1 < starts.length ? starts[idx + 1].line : lines.length;
    const text = lines.slice(start.line, endExclusive).join("\n").replace(/\n+$/, "");
    bare.push({
      kind: start.kind,
      name: start.name,
      startLine: start.line + 1,
      endLine: endExclusive,
      text,
    });
  }

  return assignHashes(bare, "");
}

function assignHashes(bare: Array<Omit<Block, "hash">>, filePath: string): Block[] {
  const seen = new Map<string, number>();
  const out: Block[] = [];
  for (const b of bare) {
    let hash = hashText(b.text);
    if (seen.has(hash)) {
      const n = (seen.get(hash) ?? 0) + 1;
      seen.set(hash, n);
      hash = hashText(b.text, `${filePath}#${n}#`);
      if (out.some((o) => o.hash === hash)) {
        hash = hash.slice(0, 6) + n.toString(16).padStart(2, "0");
      }
    } else {
      seen.set(hash, 0);
    }
    out.push({ ...b, hash });
  }
  return out;
}

export function applyBlockReplacement(content: string, block: Block, replacement: string): string {
  const lines = content.split("\n");
  const before = lines.slice(0, block.startLine - 1);
  const after = lines.slice(block.endLine);
  const middle = replacement.split("\n");
  return [...before, ...middle, ...after].join("\n");
}

export function formatBlockIndex(blocks: Block[]): string {
  if (blocks.length === 0) return "";
  const lines = ["--- Block hashes (use with hash_patch_file) ---"];
  for (const b of blocks) {
    const range = b.startLine === b.endLine ? `line ${b.startLine}` : `lines ${b.startLine}-${b.endLine}`;
    const label = b.name ? `${b.kind} ${b.name}` : b.kind;
    lines.push(`[${b.hash}] ${label.padEnd(30)} (${range})`);
  }
  return lines.join("\n");
}
