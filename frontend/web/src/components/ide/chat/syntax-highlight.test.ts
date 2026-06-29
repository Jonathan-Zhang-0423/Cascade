import { describe, it, expect } from "vitest";
import { tokenizeLine, escapeHtml, findTagEnd } from "./syntax-highlight";

/**
 * Characterization tests for the code syntax-highlight cluster used by the chat
 * message renderer. These lock current tokenizer behavior so the logic can be
 * safely modularized out of chat-utils without visual regressions.
 *
 * The tokenizer reconstructs the full source by concatenating token.text, so
 * the strongest invariant is "tokens losslessly cover the input".
 */
describe("escapeHtml", () => {
  it("escapes the three HTML-significant characters", () => {
    expect(escapeHtml(`<div class="x">a & b</div>`)).toBe(
      `&lt;div class="x"&gt;a &amp; b&lt;/div&gt;`,
    );
  });
  it("leaves plain text untouched", () => {
    expect(escapeHtml("just text 123")).toBe("just text 123");
  });
});

describe("findTagEnd", () => {
  it("finds the closing > of a simple tag", () => {
    const s = "<div>";
    expect(findTagEnd(s, 1)).toBe(4);
  });
  it("skips > inside quoted attribute values", () => {
    const s = `<a title="a>b">`;
    // The > inside the quotes must not be treated as the tag end.
    expect(findTagEnd(s, 1)).toBe(s.length - 1);
  });
  it("returns -1 when there is no closing >", () => {
    expect(findTagEnd("<div", 1)).toBe(-1);
  });
});

describe("tokenizeLine", () => {
  const reconstruct = (code: string, lang: "html" | "css" | "js" | "text") =>
    tokenizeLine(code, lang).map((t) => t.text).join("");

  it("is lossless: concatenated token text equals the input (html)", () => {
    const code = `<div class="box">Hello</div>`;
    expect(reconstruct(code, "html")).toBe(code);
  });

  it("is lossless for css", () => {
    const code = `.box { color: red; padding: 4px; }`;
    expect(reconstruct(code, "css")).toBe(code);
  });

  it("is lossless for js", () => {
    const code = `const x = "hi"; // note`;
    expect(reconstruct(code, "js")).toBe(code);
  });

  it("tokenizes an html comment as a single comment token", () => {
    const tokens = tokenizeLine(`<!-- hidden -->`, "html");
    expect(tokens.some((t) => t.type === "comment" && t.text === "<!-- hidden -->")).toBe(true);
  });

  it("classifies a js line comment", () => {
    const tokens = tokenizeLine(`x = 1; // trailing`, "js");
    expect(tokens.some((t) => t.type === "comment" && t.text.includes("// trailing"))).toBe(true);
  });

  it("classifies a js string literal", () => {
    const tokens = tokenizeLine(`const s = "hello"`, "js");
    expect(tokens.some((t) => t.type === "string" && t.text === `"hello"`)).toBe(true);
  });

  it("empty input yields no tokens", () => {
    expect(tokenizeLine("", "js")).toEqual([]);
  });

  it("text lang returns the line as-is on reconstruct", () => {
    const code = `anything goes <here> & there`;
    expect(reconstruct(code, "text")).toBe(code);
  });
});
