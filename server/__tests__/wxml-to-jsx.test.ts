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

describe("rewriteExpr — identifier prefixing", () => {
  it("prefixes bare identifiers with __data__.", () => {
    const jsx = compile(`<view>{{ count }}</view>`);
    expect(jsx).toContain("__data__.count");
  });

  it("does NOT prefix member-access identifiers", () => {
    const jsx = compile(`<view>{{ user.name }}</view>`);
    // Should emit __data__.user.name, NOT __data__.user.__data__.name
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
    // Arrow param `x` is local — must not be prefixed.
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
    // `formatPrice` is an imported wxs helper — leave unprefixed so the
    // wxs module binding resolves it, not __data__.
    const jsx = compile(`<text>{{ formatPrice(price) }}</text>`);
    expect(jsx).toContain("formatPrice(__data__.price)");
    expect(jsx).not.toContain("__data__.formatPrice");
  });

  it("does not prefix object-literal keys", () => {
    // Use a class binding so the expression flows through rewriteExpr.
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
    // `1.5` must not trigger "preceded by dot" on whatever comes next
    // (no identifier comes after here — just sanity-check it compiles).
    expect(jsx).toContain("__data__.price * 1.5");
  });

  it("leaves item / index (wx:for defaults) unprefixed inside a loop", () => {
    const jsx = compile(`<view wx:for="{{list}}" wx:key="id">{{ item.name }} — {{ index }}</view>`);
    expect(jsx).toContain("__data__.list");
    expect(jsx).toContain("item.name");
    // index — after the first template string split, it appears as a reference.
    // Must not be prefixed.
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
