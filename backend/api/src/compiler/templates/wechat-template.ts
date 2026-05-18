export function generateWeChatTemplate() {
  return [
    {
      path: "/project/app.js",
      content: `App({
  onLaunch() {
    console.log('Mini Program launched');
  },
  onShow() {},
  onHide() {},
  globalData: {}
});`,
    },
    {
      path: "/project/app.json",
      content: JSON.stringify(
        {
          pages: ["pages/index/index"],
          window: {
            navigationBarTitleText: "Mini Program",
            navigationBarBackgroundColor: "#07c160",
            navigationBarTextStyle: "white",
            backgroundColor: "#f5f5f5",
          },
        },
        null,
        2,
      ),
    },
    {
      path: "/project/app.wxss",
      content: `/* Global Styles */
page {
  background-color: #f5f5f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
}`,
    },
    {
      path: "/project/pages/index/index.wxml",
      content: `<view class="container">
  <view class="header">
    <view class="logo-placeholder">
      <text class="logo-icon">💬</text>
    </view>
    <text class="title">Hello, Mini Program!</text>
    <text class="subtitle">Start building your WeChat Mini Program</text>
  </view>

  <view class="card">
    <text class="card-title">Welcome</text>
    <text class="card-text">Edit the files in the pages/index/ folder to get started.</text>
    <button class="btn" bindtap="handleGetStarted">Get Started</button>
  </view>
</view>`,
    },
    {
      path: "/project/pages/index/index.wxss",
      content: `.container {
  padding: 40rpx;
  min-height: 100vh;
}

.header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60rpx 0;
}

.logo-placeholder {
  width: 120rpx;
  height: 120rpx;
  border-radius: 30rpx;
  background-color: #07c160;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 30rpx;
}

.logo-icon {
  font-size: 60rpx;
}

.title {
  font-size: 48rpx;
  font-weight: bold;
  color: #07c160;
  margin-bottom: 16rpx;
}

.subtitle {
  font-size: 28rpx;
  color: #888888;
  text-align: center;
}

.card {
  background-color: #ffffff;
  border-radius: 16rpx;
  padding: 40rpx;
  margin-top: 40rpx;
  box-shadow: 0 2rpx 16rpx rgba(0, 0, 0, 0.06);
}

.card-title {
  font-size: 36rpx;
  font-weight: bold;
  color: #333333;
  display: block;
  margin-bottom: 16rpx;
}

.card-text {
  font-size: 28rpx;
  color: #666666;
  line-height: 1.6;
  display: block;
  margin-bottom: 40rpx;
}

.btn {
  background-color: #07c160;
  color: #ffffff;
  border-radius: 8rpx;
  font-size: 32rpx;
  border: none;
}`,
    },
    {
      path: "/project/pages/index/index.js",
      content: `Page({
  data: {
    message: 'Hello, Mini Program!'
  },

  onLoad(options) {
    console.log('Page loaded', options);
  },

  onShow() {},

  onReady() {},

  handleGetStarted() {
    wx.showToast({
      title: 'Let\\'s build!',
      icon: 'success',
      duration: 2000
    });
  }
});`,
    },
    {
      path: "/project/pages/index/index.json",
      content: JSON.stringify(
        {
          navigationBarTitleText: "Home",
          usingComponents: {},
        },
        null,
        2,
      ),
    },
  ];
}
