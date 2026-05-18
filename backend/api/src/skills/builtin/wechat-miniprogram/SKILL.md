# WeChat Mini Program Skill

## Project Structure
```
/project/
  app.js              # App lifecycle (onLaunch, onShow, onHide), global data
  app.json            # Global config: pages list, window style, tabBar
  app.wxss            # Global styles (applied to all pages)
  pages/
    index/
      index.wxml      # Page template (XML-based markup)
      index.wxss      # Page-specific styles
      index.js        # Page logic (Page({ data, onLoad, ... }))
      index.json      # Page-level config (navigationBarTitleText, usingComponents)
    detail/
      detail.wxml
      detail.wxss
      detail.js
      detail.json
  components/
    my-comp/
      my-comp.wxml
      my-comp.wxss
      my-comp.js      # Component({ properties, data, methods })
      my-comp.json    # { "component": true }
  utils/
    util.js           # Shared utilities (no framework, plain JS)
  images/             # Static assets
```

## WXML Core Components
```xml
<!-- Layout -->
<view class="container">...</view>          <!-- block container (like div) -->
<text>Hello</text>                          <!-- inline text (MUST wrap text nodes) -->
<image src="/images/logo.png" mode="aspectFit" />
<scroll-view scroll-y="true" style="height:400rpx;">...</scroll-view>
<swiper indicator-dots="true" autoplay="true">
  <swiper-item><image src="..." /></swiper-item>
</swiper>

<!-- Forms -->
<button bindtap="handleTap" type="primary">Click</button>
<input placeholder="Enter text" bindinput="handleInput" value="{{inputVal}}" />
<textarea placeholder="..." bindinput="handleTextarea" />
<switch checked="{{isOn}}" bindchange="handleSwitch" />
<slider min="0" max="100" value="{{val}}" bindchange="handleSlider" />
<picker mode="selector" range="{{arr}}" bindchange="handlePick">
  <view>{{arr[idx]}}</view>
</picker>
<checkbox-group bindchange="handleCheck">
  <checkbox value="a">Option A</checkbox>
</checkbox-group>

<!-- Navigation -->
<navigator url="/pages/detail/detail?id=1">Go to detail</navigator>
```

## WXML Directives
```xml
<!-- Data binding -->
<text>{{message}}</text>
<view style="color: {{color}};">styled</view>

<!-- Conditionals -->
<view wx:if="{{show}}">visible</view>
<view wx:elif="{{other}}">other</view>
<view wx:else>fallback</view>

<!-- List rendering — wx:key is REQUIRED -->
<view wx:for="{{list}}" wx:key="id">
  <text>{{index}}: {{item.name}}</text>
</view>

<!-- Custom for-item/index names -->
<view wx:for="{{users}}" wx:for-item="user" wx:for-index="i" wx:key="id">
  {{i}}: {{user.name}}
</view>

<!-- Template grouping (no DOM element emitted) -->
<block wx:if="{{condition}}">
  <view>...</view>
  <view>...</view>
</block>
```

## Page JS Pattern
```js
Page({
  data: {
    message: 'Hello',
    list: [],
    inputVal: '',
    show: true,
  },

  // Lifecycle
  onLoad(options) {
    // options = query params from navigation
    this.fetchData();
  },
  onShow() {},
  onReady() {},
  onHide() {},
  onUnload() {},

  // Pull-to-refresh (requires enablePullDownRefresh: true in page .json)
  onPullDownRefresh() {
    this.fetchData(() => wx.stopPullDownRefresh());
  },

  // Reach bottom (requires onReachBottomDistance in page .json)
  onReachBottom() {
    this.loadMore();
  },

  // Methods
  fetchData(cb) {
    wx.request({
      url: 'https://api.example.com/data',
      method: 'GET',
      success: (res) => {
        this.setData({ list: res.data });
        cb && cb();
      },
      fail: (err) => {
        wx.showToast({ title: 'Failed', icon: 'error' });
      }
    });
  },

  handleTap(e) {
    // e.currentTarget.dataset contains data-* attributes
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  handleInput(e) {
    this.setData({ inputVal: e.detail.value });
  },
});
```

## App JS Pattern
```js
App({
  onLaunch(options) {
    // Called once when mini program launches
    const token = wx.getStorageSync('token');
    this.globalData.isLoggedIn = !!token;
  },
  onShow() {},
  onHide() {},
  globalData: {
    userInfo: null,
    isLoggedIn: false,
  }
});
```

## Custom Component Pattern
```js
// components/card/card.js
Component({
  properties: {
    title: { type: String, value: '' },
    count: { type: Number, value: 0 },
  },
  data: {
    localState: false,
  },
  methods: {
    handleTap() {
      this.triggerEvent('tap', { title: this.properties.title });
    },
  },
  lifetimes: {
    attached() {},
    detached() {},
  },
});
```
```json
// components/card/card.json
{ "component": true, "usingComponents": {} }
```
```xml
<!-- Using a component in a page -->
<!-- page .json must declare: { "usingComponents": { "card": "/components/card/card" } } -->
<card title="{{item.title}}" count="{{item.count}}" bindtap="handleCardTap" />
```

## app.json Configuration
```json
{
  "pages": [
    "pages/index/index",
    "pages/detail/detail",
    "pages/profile/profile"
  ],
  "window": {
    "navigationBarTitleText": "My App",
    "navigationBarBackgroundColor": "#07c160",
    "navigationBarTextStyle": "white",
    "backgroundColor": "#f5f5f5",
    "enablePullDownRefresh": false
  },
  "tabBar": {
    "color": "#888888",
    "selectedColor": "#07c160",
    "backgroundColor": "#ffffff",
    "borderStyle": "black",
    "list": [
      { "pagePath": "pages/index/index", "text": "Home", "iconPath": "images/home.png", "selectedIconPath": "images/home-active.png" },
      { "pagePath": "pages/profile/profile", "text": "Profile", "iconPath": "images/profile.png", "selectedIconPath": "images/profile-active.png" }
    ]
  },
  "networkTimeout": { "request": 10000 },
  "debug": false
}
```

## WXSS Rules
```css
/* Use rpx for ALL sizes — 750rpx = full screen width on any device */
.container {
  padding: 30rpx;
  background-color: #f5f5f5;
}

.card {
  background: #ffffff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
}

.title {
  font-size: 32rpx;
  font-weight: bold;
  color: #333333;
  /* display: block needed on text elements for block layout */
}

/* NEVER use px, em, rem, vw, vh in WXSS — always rpx */
```

## wx.* API Reference

### Navigation
```js
wx.navigateTo({ url: '/pages/detail/detail?id=1' })  // push (max 10 layers)
wx.redirectTo({ url: '/pages/home/home' })           // replace current
wx.navigateBack({ delta: 1 })                        // pop
wx.switchTab({ url: '/pages/index/index' })          // switch tab bar tab
wx.reLaunch({ url: '/pages/index/index' })           // clear stack, go to page
```

### UI Feedback
```js
wx.showToast({ title: 'Success!', icon: 'success', duration: 2000 })
wx.showToast({ title: 'Saving...', icon: 'loading', duration: 0 })
wx.hideToast()
wx.showLoading({ title: 'Loading...' })
wx.hideLoading()
wx.showModal({
  title: 'Confirm',
  content: 'Are you sure?',
  success: (res) => { if (res.confirm) { /* confirmed */ } }
})
wx.showActionSheet({
  itemList: ['Option A', 'Option B'],
  success: (res) => { console.log(res.tapIndex) }
})
```

### Storage (synchronous preferred for simple values)
```js
wx.setStorageSync('key', value)
const val = wx.getStorageSync('key')
wx.removeStorageSync('key')
wx.clearStorageSync()
// Async versions also available: wx.setStorage, wx.getStorage, etc.
```

### Network
```js
wx.request({
  url: 'https://api.example.com/endpoint',
  method: 'POST',
  header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  data: { key: 'value' },
  success: (res) => { console.log(res.data, res.statusCode) },
  fail: (err) => { wx.showToast({ title: 'Network error', icon: 'error' }) },
  complete: () => { /* always called */ }
})
```

### System Info
```js
const info = wx.getSystemInfoSync()
// info.windowWidth, info.windowHeight, info.platform ('ios'/'android')
// info.statusBarHeight, info.safeArea
```

### Media
```js
wx.chooseImage({ count: 1, success: (res) => { const path = res.tempFilePaths[0] } })
wx.previewImage({ current: url, urls: [url1, url2] })
```

### Location
```js
wx.getLocation({ type: 'wgs84', success: (res) => { console.log(res.latitude, res.longitude) } })
```

### Clipboard
```js
wx.setClipboardData({ data: 'text to copy' })
```

## Critical Rules
1. **Every page must be in app.json pages array** — otherwise navigation fails silently.
2. **Only setData() updates the view** — never mutate this.data directly.
3. **All sizes in rpx** — never px, em, rem, vw in WXSS.
4. **wx:key is required** on wx:for — use a unique field name or 'index'.
5. **No HTML elements** — only WXML components (view, text, image, etc.).
6. **text must wrap text nodes** — raw text in a view won't render correctly.
7. **Custom components need registration** in the page's .json usingComponents.
8. **Use wx.request** for HTTP — no fetch, axios, or XMLHttpRequest.
9. **Self-closing tags must close** — WXML is XML: `<image />` not `<image>`.
10. **bindtap handler = method name only** — `bindtap="handleTap"` not `bindtap="handleTap()"`.

## Networking (production patterns)

Never call `wx.request` directly from pages. Build a shared `utils/request.js` that handles auth, retries, timeouts, and cancellation. Import it everywhere.

### Shared request util
```js
// utils/request.js
const BASE_URL = 'https://api.example.com';
const DEFAULT_TIMEOUT = 10000;
let refreshPromise = null; // prevent refresh storms

function doRequest(opts, attempt = 0) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token');
    const task = wx.request({
      url: opts.url.startsWith('http') ? opts.url : BASE_URL + opts.url,
      method: opts.method || 'GET',
      data: opts.data,
      timeout: opts.timeout || DEFAULT_TIMEOUT,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.header,
      },
      success: (res) => {
        if (res.statusCode === 401 && !opts._retried) {
          // single in-flight refresh; all 401s wait on the same promise
          refreshPromise = refreshPromise || refreshToken();
          refreshPromise
            .then(() => { refreshPromise = null; resolve(doRequest({ ...opts, _retried: true })); })
            .catch((e) => { refreshPromise = null; reject(e); });
          return;
        }
        if (res.statusCode >= 500 && attempt < 1) {
          // single retry with backoff for 5xx (not 4xx — those are client bugs)
          setTimeout(() => resolve(doRequest(opts, attempt + 1)), 500 * Math.pow(2, attempt));
          return;
        }
        if (res.statusCode >= 400) { reject(res); return; }
        resolve(res.data);
      },
      fail: (err) => {
        if (err.errMsg?.includes('timeout') && attempt < 1) {
          setTimeout(() => resolve(doRequest(opts, attempt + 1)), 500);
          return;
        }
        wx.showToast({ title: '网络错误', icon: 'none' });
        reject(err);
      },
    });
    opts._onCreated?.(task); // expose task so caller can abort()
  });
}

function refreshToken() {
  return doRequest({ url: '/auth/refresh', method: 'POST', _retried: true })
    .then((r) => wx.setStorageSync('token', r.token));
}

module.exports = { request: doRequest };
```

### Cancellation
`wx.request` returns a `requestTask` — store it on the Page instance and call `.abort()` in `onHide` or `onUnload` to avoid setState-after-unload races:
```js
fetchData() {
  this.request({ url: '/items', _onCreated: (task) => { this._task = task; } });
},
onUnload() { this._task?.abort(); }
```

### What to avoid
- Never use `fetch()`, `axios`, or `XMLHttpRequest` — they don't exist in the mini-program runtime.
- Never retry 4xx (client error — retrying won't help and masks real bugs).
- Never log tokens in `console.log` or send them as URL query params.

## State & Lifecycle

### `onLoad` vs `onShow`
- **`onLoad(options)`** — fires **once** per page instance. Use for: reading route params (`options.id`), one-time setup (subscriptions, first-time fetch of rarely-changing data).
- **`onShow`** — fires **every time** the page becomes visible, including after `navigateBack` from a child page or `switchTab`. Use for: refreshing volatile data (cart count, notification badge, list that might have changed on a detail page).
- **`onReady`** — fires once after first render; use for queries that need DOM (`wx.createSelectorQuery()`).
- **`onHide`** — stop polling intervals, pause animations, cancel in-flight requests.
- **`onUnload`** — definitive cleanup; clear timers, remove bus subscriptions, abort requests.

### Global state via `app.globalData`
Use for auth token, current user, feature flags — things that outlive any single page. Access with `getApp()`:
```js
// app.js
App({
  globalData: { user: null, token: '' },
  setUser(user) { this.globalData.user = user; },
});

// any page
const app = getApp();
onLoad() { if (!app.globalData.token) wx.redirectTo({ url: '/pages/login/login' }); }
```
Avoid deep mutation (`app.globalData.user.profile.name = 'x'`) — prefer replace-the-object semantics so other pages observe the change consistently.

### Cross-page pub/sub
For events like "order placed" or "cart updated" that affect multiple pages, use a tiny event bus — don't try to thread callbacks through `wx.navigateTo`:
```js
// utils/bus.js
const handlers = {};
module.exports = {
  on(ev, fn) { (handlers[ev] ||= []).push(fn); },
  off(ev, fn) { handlers[ev] = (handlers[ev] || []).filter((h) => h !== fn); },
  emit(ev, payload) { (handlers[ev] || []).forEach((h) => h(payload)); },
};
```
Subscribe in `onLoad`, unsubscribe in `onUnload` — otherwise the handler leaks with the closed page's `this`.

### Background / foreground
Poll only while visible. Stop in `onHide`, resume in `onShow`. For app-wide resume logic (e.g., refetch after the user leaves WeChat for 10 minutes), use `wx.onAppShow` in `app.js`.

## Performance

### `setData` is the bottleneck
Every `setData` call serializes to JSON and crosses the logic-layer / render-layer bridge. Payload has a soft limit around **1 MB** — over that, the view becomes janky or the call silently drops fields.

- **Send only the fields that changed.** Never re-send the whole `data` object.
- **Use path syntax** for deeply-nested updates so you ship a single key instead of the whole parent object:
  ```js
  // Good — 20 bytes over the bridge
  this.setData({ 'list[3].read': true });
  // Bad — re-serializes the entire list
  const list = [...this.data.list];
  list[3] = { ...list[3], read: true };
  this.setData({ list });
  ```
- **Batch within a tick.** Accumulate into a single `setData` call per event loop:
  ```js
  this._pending = { ...this._pending, ...patch };
  Promise.resolve().then(() => {
    if (!this._pending) return;
    this.setData(this._pending);
    this._pending = null;
  });
  ```
- **Never setData large static data** (500+ item menu, dictionaries). Keep it as `this._menu` (non-reactive) and only push the fields the template actually reads.

### Large lists
Default to pagination — never fetch 1,000 rows at once. Fetch 20–50 per page, append on `onReachBottom`:
```js
onReachBottom() {
  if (this.data.loading || this.data.done) return;
  this.setData({ loading: true });
  this.request({ url: '/items', data: { page: this.data.page + 1 } })
    .then((r) => this.setData({
      'list': this.data.list.concat(r.items),
      'page': this.data.page + 1,
      'done': r.items.length < 20,
      'loading': false,
    }));
}
```
For lists that truly need 1,000+ rows in memory (chat threads, log viewers), use [`recycle-view`](https://developers.weixin.qq.com/miniprogram/dev/extended/component-plus/recycle-view.html) or [`miniprogram-virtual-list`](https://github.com/Lanceric/miniprogram-virtual-list) — the built-in `<scroll-view>` renders every child.

### Images
Always include `lazy-load="true"` on long scrollable image lists, plus explicit dimensions so the layout doesn't reflow as each image loads:
```xml
<image src="{{item.cover}}" mode="aspectFill" lazy-load="true" style="width: 200rpx; height: 200rpx;" />
```
Use `mode="aspectFill"` or `"aspectFit"` — without `mode`, images stretch.

### `wx:key` must be stable
Use a field from the data, not the array index. If you use `index`, the runtime discards DOM on reorder / insert — losing input focus, scroll position, and animation state.
```xml
<!-- Good -->
<view wx:for="{{list}}" wx:key="id">...</view>
<!-- Bad — breaks on any mutation -->
<view wx:for="{{list}}" wx:key="index">...</view>
```

### Precompute in JS, not WXML
WXML expressions re-evaluate on every re-render. Do string formatting, date parsing, and filtering in `setData`, not in `{{ foo.toFixed(2) + '元' }}`:
```js
this.setData({ list: items.map((i) => ({ ...i, priceText: `¥${i.price.toFixed(2)}` })) });
```

## UX, Auth & Accessibility

### Loading, empty, and error states
Every screen that fetches data needs four UI states. Don't render just the happy path.

- **Skeleton** — render placeholder blocks during first load. Mimics the final layout so the user sees structure, not a blank screen:
  ```xml
  <view wx:if="{{loading && list.length === 0}}">
    <view class="skeleton-row" wx:for="{{[1,2,3,4,5]}}" wx:key="*this" />
  </view>
  ```
- **Empty state** — icon + short title + one-line explanation + primary CTA. Show when `!loading && list.length === 0`. Don't collapse to a blank area.
- **Error state** — "加载失败" + retry button that calls the same fetch function. Log the real error separately; don't show stack traces to users.
- **`wx.showLoading`** — blocking spinner for operations the user is actively waiting on (submit form). Not for background refresh.
- **`wx.showToast`** — non-blocking feedback (1500 ms). Use `icon: 'success'`/`'error'`/`'none'`.

### Pull-to-refresh
Enable per-page in the page's `.json`:
```json
{ "enablePullDownRefresh": true, "backgroundTextStyle": "dark" }
```
Wire `onPullDownRefresh`:
```js
onPullDownRefresh() {
  this.setData({ page: 1, done: false });
  this.fetchData(() => wx.stopPullDownRefresh());
}
```
Always call `wx.stopPullDownRefresh()` in every completion branch — otherwise the spinner spins forever.

### Debounced search
```js
handleInput(e) {
  const q = e.detail.value;
  clearTimeout(this._t);
  this._searchTask?.abort(); // cancel in-flight
  this._t = setTimeout(() => this.runSearch(q), 300);
}
```

### Auth: `wx.login` + `code2session`
1. Frontend: `wx.login({ success: ({ code }) => POST /auth/wechat { code } })`.
2. Backend: call `https://api.weixin.qq.com/sns/jscode2session` with `appid` + `secret` + `code`, receive `openid` + `session_key`. Issue your own app session token (JWT) and return it. **Never expose `session_key` to the client.**
3. Frontend stores: `wx.setStorageSync('token', token)`.
4. All subsequent requests attach `Authorization: Bearer <token>` (via `utils/request.js`).
5. On 401, call `/auth/refresh` (or re-run `wx.login`) per the networking section.

### Token storage
`wx.setStorageSync` is **not encrypted** and is readable by the user via devtools export. Only store opaque session tokens that your backend can revoke — never plaintext passwords, card numbers, or PII.

### Accessibility
- **Tap targets: minimum 88rpx × 88rpx** (≈44pt at 2× density). Don't build icon-only rows shorter than 88rpx.
- **Use `<button>` for actions.** `<view bindtap>` doesn't register as a button for hardware keyboards or screen readers.
- **`aria-label`** on icon-only buttons so screen readers announce the action ("购物车").
- **`aria-role="heading"`** on section titles; let screen readers navigate by heading.
- **Color contrast** ≥ 4.5:1 for body text against background (WCAG AA).

### Design tokens in `app.wxss`
Centralize color, spacing, and type to avoid magic numbers across pages:
```css
page {
  --color-primary: #07c160;
  --color-text: #1a1a1a;
  --color-text-secondary: #999;
  --color-bg: #f7f7f7;
  --space-1: 8rpx;
  --space-2: 16rpx;
  --space-3: 24rpx;
  --space-4: 32rpx;
  --radius-md: 16rpx;
  --font-body: 28rpx;
  --font-title: 34rpx;
}
```
Pages reference `padding: var(--space-3); color: var(--color-primary);`. Swap tokens globally to rebrand.
