import { describe, it, expect } from "vitest";
import { wxmlToJsx } from "../wechat/wxml-to-jsx";

// These tests exercise the rewriteExpr identifier-prefixing logic indirectly
// via wxmlToJsx. Each snippet is a minimal WXML template whose `{{ ... }}`
// expression contains a construct that previously tripped the rewriter.

function compile(wxml: string): string {
  const { jsx, errors } = wxmlToJsx(wxml, "pages/test/test");
  expect(errors).toEqual([]);
  return jsx;
}

function compileWithWarnings(wxml: string): { jsx: string; warnings: string[] } {
  const { jsx, errors, warnings } = wxmlToJsx(wxml, "pages/test/test");
  expect(errors).toEqual([]);
  return { jsx, warnings };
}

describe("rewriteExpr — identifier prefixing", () => {
  it("prefixes bare identifiers with __data__.", () => {
    const jsx = compile(`<view>{{ count }}</view>`);
    expect(jsx).toContain("__data__.count");
  });

  it("does NOT prefix member-access identifiers", () => {
    const jsx = compile(`<view>{{ user.name }}</view>`);
    expect(jsx).toContain("__data__.user.name");
    expect(jsx).not.toContain("__data__.user.__data__");
  });

  it("handles optional chaining (?.)", () => {
    const jsx = compile(`<view>{{ user?.name }}</view>`);
    expect(jsx).toContain("__data__.user?.name");
    expect(jsx).not.toContain("__data__.user?.__data__.name");
  });

  it("does not prefix built-in globals like Symbol / Map / Promise / Error", () => {
    const jsx = compile(`<view class="{{ Array.isArray(items) ? 'is-list' : '' }}">{{ items }}</view>`);
    expect(jsx).toContain("Array.isArray");
    expect(jsx).not.toContain("__data__.Array");
  });

  it("does not prefix Math / Date / JSON", () => {
    const jsx = compile(`<text>{{ Math.floor(price * 100) / 100 }}</text>`);
    expect(jsx).toContain("Math.floor");
    expect(jsx).not.toContain("__data__.Math");
    expect(jsx).toContain("__data__.price");
  });

  it("skips arrow-function parameters in .filter / .map chains", () => {
    const jsx = compile(`<text>{{ list.filter(x => x.active).length }}</text>`);
    expect(jsx).toContain("__data__.list.filter(x => x.active).length");
    expect(jsx).not.toContain("__data__.x");
  });

  it("handles multiple arrow params across a chain", () => {
    const jsx = compile(`<text>{{ items.map(i => i.price).reduce((a, b) => a + b, 0) }}</text>`);
    expect(jsx).toContain("__data__.items.map(i => i.price)");
    expect(jsx).toContain(".reduce((a, b) => a + b, 0)");
    expect(jsx).not.toContain("__data__.i.price");
    expect(jsx).not.toContain("__data__.a + __data__.b");
  });

  it("does not prefix function-call identifiers (wxs imports)", () => {
    const jsx = compile(`<text>{{ formatPrice(price) }}</text>`);
    expect(jsx).toContain("formatPrice(__data__.price)");
    expect(jsx).not.toContain("__data__.formatPrice");
  });

  it("does not prefix object-literal keys", () => {
    const jsx = compile(`<view class="{{ {active: isActive, disabled: isDisabled} }}">x</view>`);
    expect(jsx).toContain("active:");
    expect(jsx).toContain("disabled:");
    expect(jsx).not.toContain("__data__.active");
    expect(jsx).not.toContain("__data__.disabled");
    expect(jsx).toContain("__data__.isActive");
    expect(jsx).toContain("__data__.isDisabled");
  });

  it("handles string literals and leaves their contents alone", () => {
    const jsx = compile(`<text>{{ 'Hello, ' + name }}</text>`);
    expect(jsx).toContain("'Hello, '");
    expect(jsx).toContain("__data__.name");
  });

  it("handles numeric literals with decimal points without treating them as member access", () => {
    const jsx = compile(`<text>{{ price * 1.5 }}</text>`);
    expect(jsx).toContain("__data__.price * 1.5");
  });

  it("leaves item / index (wx:for defaults) unprefixed inside a loop", () => {
    const jsx = compile(`<view wx:for="{{list}}" wx:key="id">{{ item.name }} — {{ index }}</view>`);
    expect(jsx).toContain("__data__.list");
    expect(jsx).toContain("item.name");
    expect(jsx).not.toContain("__data__.item");
    expect(jsx).not.toContain("__data__.index");
  });

  it("does not prefix identifiers after ?. optional chaining beyond one level", () => {
    const jsx = compile(`<text>{{ user?.profile?.name }}</text>`);
    expect(jsx).toContain("__data__.user?.profile?.name");
    expect(jsx).not.toContain("__data__.profile");
    expect(jsx).not.toContain("__data__.name");
  });
});

describe("Rung 2 — WXML parity", () => {
  it("wx:for routes list expression through rewriteExpr", () => {
    const jsx = compile(`<view wx:for="{{items}}" wx:key="id">{{ item.name }}</view>`);
    expect(jsx).toContain("__wxFor(__data__.items)");
  });

  it("wx:for with custom item/index names leaves them unprefixed", () => {
    const jsx = compile(`<view wx:for="{{list}}" wx:for-item="row" wx:for-index="i" wx:key="id">{{ row.title }} {{ i }}</view>`);
    expect(jsx).toContain("__wxFor(__data__.list)");
    expect(jsx).toContain("row.title");
    expect(jsx).not.toContain("__data__.row");
    expect(jsx).not.toContain("__data__.i");
  });

  it("inline <wxs> module is evaluated and its name is unprefixed", () => {
    const wxml = `<wxs module="fmt">module.exports = { price: function(v) { return '¥' + v; } };</wxs><text>{{ fmt.price(price) }}</text>`;
    const jsx = compile(wxml);
    // Module binding should be emitted
    expect(jsx).toContain('const fmt = (function()');
    // fmt should NOT be prefixed with __data__
    expect(jsx).toContain("fmt.price(__data__.price)");
    expect(jsx).not.toContain("__data__.fmt");
  });

  it("external <wxs src=...> emits empty object and a warning", () => {
    const wxml = `<wxs module="utils" src="./utils.wxs"/><text>{{ utils.format(val) }}</text>`;
    const { jsx, warnings } = compileWithWarnings(wxml);
    expect(jsx).toContain("const utils = {}");
    expect(warnings.some(w => w.includes("external import"))).toBe(true);
  });

  it("static <template is='name'> inlines the template", () => {
    const wxml = `<template name="item"><text>{{ name }}</text></template><template is="item" />`;
    const jsx = compile(wxml);
    expect(jsx).toContain("__data__.name");
  });

  it("<import> and <include> emit warnings", () => {
    const { warnings } = compileWithWarnings(`<import src="./comp.wxml"/><view>hi</view>`);
    expect(warnings.some(w => w.includes("<import>"))).toBe(true);
  });
});

describe("Rung 3 — component library", () => {
  it("rich-text tag maps to RichText", () => {
    const jsx = compile(`<rich-text nodes="{{content}}"></rich-text>`);
    expect(jsx).toContain("<RichText");
  });

  it("video tag maps to Video", () => {
    const jsx = compile(`<video src="{{url}}" controls></video>`);
    expect(jsx).toContain("<Video");
    expect(jsx).toContain("__data__.url");
  });

  it("web-view tag maps to WebView", () => {
    const jsx = compile(`<web-view src="{{pageUrl}}"></web-view>`);
    expect(jsx).toContain("<WebView");
    expect(jsx).toContain("__data__.pageUrl");
  });

  it("movable-area and movable-view map correctly", () => {
    const jsx = compile(`<movable-area><movable-view direction="all">drag</movable-view></movable-area>`);
    expect(jsx).toContain("<MovableArea");
    expect(jsx).toContain("<MovableView");
  });

  it("cover-view and cover-image map correctly", () => {
    const jsx = compile(`<cover-view><cover-image src="{{img}}"/></cover-view>`);
    expect(jsx).toContain("<CoverView");
    expect(jsx).toContain("<CoverImage");
  });

  it("live-player maps to LivePlayerStub", () => {
    const jsx = compile(`<live-player src="{{stream}}"></live-player>`);
    expect(jsx).toContain("<LivePlayerStub");
  });

  it("ad maps to AdStub", () => {
    const jsx = compile(`<ad unit-id="xxx"></ad>`);
    expect(jsx).toContain("<AdStub");
  });

  it("unknown tags fall back to View", () => {
    const jsx = compile(`<my-custom-comp foo="bar">text</my-custom-comp>`);
    expect(jsx).toContain("<View");
  });
});
