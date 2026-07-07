import type { Token } from "./chat-types";

/**
 * Lightweight syntax tokenizer for the chat code-block renderer. Pure,
 * dependency-free, and behavior-locked by syntax-highlight.test.ts.
 * Extracted from chat-utils.tsx for cohesion (single responsibility:
 * turning a source line + language into highlight tokens).
 */

export function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function findTagEnd(code: string, start: number): number {
  let j = start;
  while (j < code.length) {
    if (code[j] === '"' || code[j] === "'") {
      const q = code[j];
      j++;
      while (j < code.length && code[j] !== q) j++;
      j++;
      continue;
    }
    if (code[j] === ">") return j;
    j++;
  }
  return -1;
}

export function tokenizeLine(
  code: string,
  lang: "html" | "css" | "js" | "text",
): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let inCssBlock = false;
  for (let ci = 0; ci < i && ci < code.length; ci++) {
    if (code[ci] === "{") inCssBlock = true;
    if (code[ci] === "}") inCssBlock = false;
  }

  while (i < code.length) {
    if (lang === "html" && code.slice(i, i + 4) === "<!--") {
      const end = code.indexOf("-->", i + 4);
      if (end !== -1) {
        tokens.push({ type: "comment", text: code.slice(i, end + 3) });
        i = end + 3;
        continue;
      } else {
        tokens.push({ type: "comment", text: code.slice(i) });
        return tokens;
      }
    }

    if (
      (lang === "js" || lang === "css") &&
      code[i] === "/" &&
      code[i + 1] === "*"
    ) {
      const end = code.indexOf("*/", i + 2);
      if (end !== -1) {
        tokens.push({ type: "comment", text: code.slice(i, end + 2) });
        i = end + 2;
        continue;
      } else {
        tokens.push({ type: "comment", text: code.slice(i) });
        return tokens;
      }
    }

    if (
      (lang === "js" || lang === "css") &&
      code[i] === "/" &&
      code[i + 1] === "/"
    ) {
      tokens.push({ type: "comment", text: code.slice(i) });
      return tokens;
    }

    if (code[i] === '"' || code[i] === "'") {
      const quote = code[i];
      let j = i + 1;
      while (j < code.length && code[j] !== quote) {
        if (code[j] === "\\") j++;
        j++;
      }
      if (lang === "html" && i > 0) {
        let prev = i - 1;
        while (prev >= 0 && code[prev] === " ") prev--;
        if (code[prev] === "=") {
          tokens.push({ type: "string", text: code.slice(i, j + 1) });
          i = j + 1;
          continue;
        }
      }
      tokens.push({ type: "string", text: code.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    if (lang === "js" && code[i] === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== "`") {
        if (code[j] === "\\") j++;
        j++;
      }
      tokens.push({ type: "string", text: code.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    if (lang === "html" && code[i] === "<") {
      if (code.slice(i, i + 9).toLowerCase() === "<!doctype") {
        const end = findTagEnd(code, i + 1);
        if (end !== -1) {
          tokens.push({ type: "tag", text: code.slice(i, end + 1) });
          i = end + 1;
          continue;
        }
      }

      const end = findTagEnd(code, i + 1);
      if (end !== -1) {
        tokens.push({ type: "tag", text: "<" });
        const inner = code.slice(i + 1, end);
        let k = 0;
        let nameStart = 0;
        if (inner[0] === "/") {
          tokens.push({ type: "tag", text: "/" });
          nameStart = 1;
          k = 1;
        }
        let nameEnd = k;
        while (nameEnd < inner.length && /[a-zA-Z0-9_:-]/.test(inner[nameEnd]))
          nameEnd++;
        if (nameEnd > k) {
          tokens.push({ type: "tag", text: inner.slice(k, nameEnd) });
        }
        k = nameEnd;

        while (k < inner.length) {
          if (inner[k] === " " || inner[k] === "\t" || inner[k] === "\n") {
            let ws = k;
            while (
              ws < inner.length &&
              (inner[ws] === " " || inner[ws] === "\t" || inner[ws] === "\n")
            )
              ws++;
            tokens.push({ type: "plain", text: inner.slice(k, ws) });
            k = ws;
            continue;
          }
          if (inner[k] === "/" && k === inner.length - 1) {
            tokens.push({ type: "tag", text: "/" });
            k++;
            continue;
          }
          if (/[a-zA-Z_@:]/.test(inner[k])) {
            let ae = k;
            while (ae < inner.length && /[a-zA-Z0-9_:.-]/.test(inner[ae])) ae++;
            const attrName = inner.slice(k, ae);
            tokens.push({ type: "attr", text: attrName });
            k = ae;
            let ws = k;
            while (ws < inner.length && inner[ws] === " ") ws++;
            if (inner[ws] === "=") {
              tokens.push({ type: "plain", text: inner.slice(k, ws + 1) });
              k = ws + 1;
              while (k < inner.length && inner[k] === " ") {
                tokens.push({ type: "plain", text: " " });
                k++;
              }
              if (k < inner.length && (inner[k] === '"' || inner[k] === "'")) {
                const q = inner[k];
                let qe = k + 1;
                while (qe < inner.length && inner[qe] !== q) qe++;
                tokens.push({ type: "string", text: inner.slice(k, qe + 1) });
                k = qe + 1;
              }
            }
            continue;
          }
          tokens.push({ type: "plain", text: inner[k] });
          k++;
        }
        tokens.push({ type: "tag", text: ">" });
        i = end + 1;
        continue;
      }
    }

    if ((lang === "js" || lang === "css") && /[0-9]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[0-9a-fA-Fx.%emsvwrhin]/.test(code[j])) j++;
      tokens.push({ type: "number", text: code.slice(i, j) });
      i = j;
      continue;
    }

    if (lang === "js" && /[a-zA-Z_$]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      const keywords = new Set([
        "function",
        "const",
        "let",
        "var",
        "if",
        "else",
        "return",
        "class",
        "import",
        "export",
        "async",
        "await",
        "true",
        "false",
        "null",
        "undefined",
        "new",
        "this",
        "super",
        "for",
        "while",
        "do",
        "switch",
        "case",
        "break",
        "continue",
        "default",
        "try",
        "catch",
        "finally",
        "throw",
        "typeof",
        "instanceof",
        "in",
        "of",
        "from",
        "extends",
        "yield",
        "void",
        "delete",
        "debugger",
        "with",
      ]);
      tokens.push({
        type: keywords.has(word) ? "keyword" : "plain",
        text: word,
      });
      i = j;
      continue;
    }

    if (lang === "css" && code[i] === "@") {
      tokens.push({ type: "keyword", text: "@" });
      i++;
      let j = i;
      while (j < code.length && /[a-zA-Z-]/.test(code[j])) j++;
      if (j > i) {
        tokens.push({ type: "keyword", text: code.slice(i, j) });
        i = j;
      }
      continue;
    }

    if (lang === "css" && /[a-zA-Z_-]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_-]/.test(code[j])) j++;
      const word = code.slice(i, j);
      let afterWord = j;
      while (afterWord < code.length && code[afterWord] === " ") afterWord++;
      const lineBeforeWord = code.slice(0, i);
      const hasOpenBrace =
        lineBeforeWord.includes("{") ||
        lineBeforeWord.trimStart().match(/^[a-z-]+\s*:/);
      if (
        code[afterWord] === ":" &&
        code[afterWord + 1] !== ":" &&
        hasOpenBrace
      ) {
        tokens.push({ type: "property", text: word });
      } else {
        tokens.push({ type: "plain", text: word });
      }
      i = j;
      continue;
    }

    if (lang === "css" && code[i] === "#") {
      let j = i + 1;
      while (j < code.length && /[0-9a-fA-F]/.test(code[j])) j++;
      if (j - i > 1 && (j - i === 4 || j - i === 7 || j - i === 9)) {
        tokens.push({ type: "number", text: code.slice(i, j) });
        i = j;
        continue;
      }
    }

    if (lang === "html" && code[i] === "&") {
      let j = i + 1;
      while (j < code.length && j - i < 10 && code[j] !== ";") j++;
      if (code[j] === ";") {
        tokens.push({ type: "plain", text: code.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
    }

    tokens.push({ type: "plain", text: code[i] });
    i++;
  }

  return tokens;
}
