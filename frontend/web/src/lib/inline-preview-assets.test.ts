import { describe, it, expect } from "vitest";
import {
  inlineExternalFiles,
  extractScriptAttrs,
  resolveFilePath,
  isExternalUrl,
  type InlineFileNode,
} from "./inline-preview-assets";

const files: InlineFileNode[] = [
  { path: "/project/index.html", content: "" },
  { path: "/project/game.js", content: "import * as THREE from 'three';\nconsole.log(THREE);" },
  { path: "/project/app.js", content: "console.log('classic');" },
  { path: "/project/style.css", content: "body{margin:0}" },
];

describe("inline-preview-assets: script attribute preservation (the import bug fix)", () => {
  it("preserves type=\"module\" when inlining a local module script", () => {
    const html = `<script type="module" src="./game.js"></script>`;
    const out = inlineExternalFiles(html, files);
    // The inlined tag must still be a module, or `import` throws in the iframe.
    expect(out).toMatch(/<script[^>]*\btype="module"[^>]*>/);
    expect(out).toContain("import * as THREE from 'three';");
    // src is dropped (content is inlined), so no leftover src= attribute.
    expect(out).not.toMatch(/<script[^>]*\bsrc=/);
  });

  it("inlines a classic local script as a classic script (no type added)", () => {
    const html = `<script src="./app.js"></script>`;
    const out = inlineExternalFiles(html, files);
    expect(out).toContain("console.log('classic');");
    expect(out).not.toMatch(/type="module"/);
  });

  it("preserves other attributes too (defer, data-*)", () => {
    const html = `<script type="module" defer data-role="game" src="/game.js"></script>`;
    const out = inlineExternalFiles(html, files);
    expect(out).toMatch(/\btype="module"/);
    expect(out).toMatch(/\bdefer/);
    expect(out).toMatch(/\bdata-role="game"/);
  });

  it("leaves external (CDN) scripts untouched — import maps / three CDN must survive", () => {
    const html = `<script type="module" src="https://unpkg.com/three@0.160.0/build/three.module.js"></script>`;
    const out = inlineExternalFiles(html, files);
    expect(out).toBe(html); // unchanged
  });

  it("does not touch inline module scripts (import map + inline module pattern)", () => {
    const html = `<script type="importmap">{"imports":{"three":"https://x/three.js"}}</script>
<script type="module">import * as THREE from 'three';</script>`;
    const out = inlineExternalFiles(html, files);
    expect(out).toBe(html); // no src attrs → nothing to inline
  });

  it("inlines local stylesheets into <style>", () => {
    const html = `<link rel="stylesheet" href="./style.css">`;
    const out = inlineExternalFiles(html, files);
    expect(out).toContain("<style>");
    expect(out).toContain("body{margin:0}");
  });

  it("leaves a local script whose file is missing as-is", () => {
    const html = `<script type="module" src="./missing.js"></script>`;
    const out = inlineExternalFiles(html, files);
    expect(out).toBe(html);
  });
});

describe("inline-preview-assets: helpers", () => {
  it("extractScriptAttrs keeps type=module and drops src", () => {
    expect(extractScriptAttrs(`<script type="module" src="./a.js">`)).toBe(' type="module"');
    expect(extractScriptAttrs(`<script src="./a.js" defer>`)).toBe(" defer");
    expect(extractScriptAttrs(`<script src="./a.js">`)).toBe("");
  });

  it("isExternalUrl detects http(s) and protocol-relative", () => {
    expect(isExternalUrl("https://x.com/a.js")).toBe(true);
    expect(isExternalUrl("//x.com/a.js")).toBe(true);
    expect(isExternalUrl("./a.js")).toBe(false);
    expect(isExternalUrl("/project/a.js")).toBe(false);
  });

  it("resolveFilePath normalizes relative paths against the entry", () => {
    expect(resolveFilePath("./game.js", "/project/index.html")).toBe("/project/game.js");
    expect(resolveFilePath("/game.js", "/project/index.html")).toBe("/project/game.js");
    expect(resolveFilePath("sub/../game.js", "/project/index.html")).toBe("/project/game.js");
    expect(resolveFilePath("/project/game.js", "/project/index.html")).toBe("/project/game.js");
  });
});
