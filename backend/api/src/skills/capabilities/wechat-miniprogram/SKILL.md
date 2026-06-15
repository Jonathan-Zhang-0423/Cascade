# WeChat Mini Program — Preview Compiler Reality Skill

Robustness rules for building 微信小程序 that actually RUN in THIS app's preview.
The app doesn't run a real WeChat runtime — it transpiles WXML→JSX, WXSS→CSS, and
shims `wx.*` in the browser (`backend/api/src/compiler/wechat/`). Most "the mini
program is broken" cases are code that a real device would tolerate but this
compiler can't. This complements the full WeChat tech-stack skill — here we only
cover what survives the preview and the specific footguns.

## Hard rules that keep the preview working

1. **One `.wxml` + `.js` + `.json` (+ optional `.wxss`) per page**, registered in
   `app.json` `pages`. The first entry is the launch page. A page missing from
   `app.json` won't route.
2. **`Page({...})` / `Component({...})` / `App({...})` are globals** — call them at
   the top level of the page/component `.js`. Don't `export default` or wrap them.
3. **Data binding only reads from `this.data`.** Anything a `.wxml` references via
   `{{...}}` must exist in the page's `data`, or be set later via `this.setData`.
   Reading an undefined path renders empty, not an error — initialize every field.
4. **State changes go through `this.setData({ ... })` — never assign `this.data.x`
   directly.** Direct mutation does not re-render. This is the #1 "nothing updates"
   bug.
5. **rpx units work** (scaled to viewport). Avoid `@import` in WXSS and `<wxs>` /
   `<import>` / `<include>` in WXML — the preview does NOT support them and will
   warn/skip. Inline the logic/styles instead.

## WXML — what the compiler translates

Use only these (all verified in the WXML→JSX translator):

- Conditionals: `wx:if` / `wx:elif` / `wx:else`, and `<block wx:if>` (no wrapper DOM).
- Lists: `wx:for="{{arr}}"` with `wx:for-item`, `wx:for-index`, and **always a
  stable `wx:key`** (a field name or `*this`, never the array index for dynamic
  lists — reorders lose state).
- Events: `bindtap`/`catchtap`, `bindinput`/`bindchange`/`bindconfirm`/`bindfocus`/
  `bindblur`, `bindscroll`/`bindscrolltolower`, touch + `bindlongpress`. `catch*`
  stops propagation.
- Components: `view`, `text`, `image`, `input`, `textarea`, `button`, `scroll-view`,
  `swiper`/`swiper-item`, `navigator`. Stick to these core ones.
- Event data: pass via `data-*` attributes and read `e.currentTarget.dataset.*` in
  the handler. `{{}}` expressions support property access and simple operators,
  not arbitrary JS — precompute complex values in `.js` and bind the result.

## `wx.*` — shimmed surface

A large `wx.*` surface is polyfilled in the browser (navigation, storage, request,
UI feedback, system info, media pickers, clipboard, etc.). Rely on these:

- Navigation: `wx.navigateTo` / `redirectTo` / `navigateBack` / `switchTab` /
  `reLaunch` — `url` must point at a page registered in `app.json` (use `switchTab`
  only for tabBar pages).
- Storage: `wx.setStorage`/`getStorage` (+ `*Sync`) — backed by `localStorage`.
- Network: `wx.request({ url, method, data, header, success, fail })` — real fetch
  under the hood; needs a CORS-permitting endpoint in preview.
- UI: `wx.showToast` / `showModal` / `showLoading`+`hideLoading` / `showActionSheet`.

Two caveats:
- These are **callback-style** (`success`/`fail`/`complete`), not promises. Wrap in a
  Promise yourself if you want `await`.
- Device-only APIs (payment, real login `code2session`, camera, BLE) are stubbed —
  they resolve/te-noop in preview. Don't gate core UI behind them; guard with
  `wx.canIUse` and provide a working fallback so the preview isn't a dead screen.

## Page lifecycle & structure (preview-safe)

```js
// pages/index/index.js
Page({
  data: { items: [], loading: true, error: "" },   // every bound field initialized
  onLoad() { this.load(); },                         // fetch once
  onShow() {},                                       // re-entry refresh if needed
  async load() {
    this.setData({ loading: true, error: "" });
    wx.request({
      url: "https://api.example.com/items",
      success: (res) => this.setData({ items: res.data, loading: false }),
      fail: () => this.setData({ error: "加载失败", loading: false }),
    });
  },
  onTapItem(e) {
    const id = e.currentTarget.dataset.id;            // data-id from WXML
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },
});
```

```xml
<!-- pages/index/index.wxml -->
<view wx:if="{{loading}}" class="state">加载中...</view>
<view wx:elif="{{error}}" class="state">{{error}}</view>
<view wx:elif="{{items.length === 0}}" class="state">暂无数据</view>
<scroll-view wx:else scroll-y class="list">
  <view wx:for="{{items}}" wx:key="id" class="row" data-id="{{item.id}}" bindtap="onTapItem">
    <text>{{item.name}}</text>
  </view>
</scroll-view>
```

- Always render the four states (loading / error / empty / list) — a blank page in
  preview reads as "broken".
- `app.json` must list every page; tabBar pages also need a `tabBar` entry.
- Custom components: declare `"usingComponents"` in the page `.json` and `Component({})`
  in the component `.js`; props via `properties`, events via `this.triggerEvent`.

## Self-check
- [ ] Every page is registered in `app.json` `pages`; launch page is first.
- [ ] `Page`/`Component`/`App` called as top-level globals (no export/wrapper).
- [ ] Every `{{field}}` in WXML is initialized in `data`; updates use `this.setData`, never direct mutation.
- [ ] Only supported WXML directives/components/events used; no `wxs`/`import`/`include`/WXSS `@import`.
- [ ] `wx:for` has a stable `wx:key`; event params passed via `data-*` + `dataset`.
- [ ] `wx.*` calls use callback style (success/fail); navigation `url`s point at registered pages.
- [ ] Device-only APIs (pay/login/camera) guarded with a preview fallback, not blocking core UI.
- [ ] Loading / empty / error / content states all rendered.
