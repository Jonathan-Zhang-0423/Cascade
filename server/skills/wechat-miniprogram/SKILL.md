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
