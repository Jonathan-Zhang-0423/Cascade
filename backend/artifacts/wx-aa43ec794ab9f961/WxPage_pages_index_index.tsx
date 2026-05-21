
import React, { useState, useEffect, useRef } from "react";
import { View, Text, Image, Button, Input, Textarea, ScrollView, Swiper, SwiperItem, Navigator, Form, Label, Checkbox, CheckboxGroup, Radio, RadioGroup, Switch, Slider, Picker, Icon, Progress, Block, Canvas, RichText, Video, WebView, MovableView, MovableArea, CoverView, CoverImage, LivePlayerStub, AdStub } from "./wx-runtime";
import { wx } from "./wx-polyfill";


let __capturedPage__ = null;
function Page(cfg) { __capturedPage__ = cfg; }
function Component(cfg) { __capturedPage__ = cfg; }

// 游戏配置 - 模块级常量，确保始终可访问
const GAME_CONFIG = {
  gravity: 0.5,
  jumpStrength: -8,
  birdWidth: 40,
  birdHeight: 30,
  pipeWidth: 60,
  pipeGap: 140,
  pipeSpeed: 2,
  pipeSpawnInterval: 150,
  groundHeight: 60
};

Page({
  data: {
    gameState: 'start', // start, playing, over
    score: 0,
    bestScore: 0,
    isNewRecord: false
  },

  // 游戏状态
  canvas: null,
  ctx: null,
  canvasWidth: 0,
  canvasHeight: 0,
  bird: null,
  pipes: [],
  frameCount: 0,
  animationId: null,
  hasPassedPipe: false,

  onLoad(options) {
    console.log('Page loaded', options);
    this.loadBestScore();
  },

  onShow() {
    this.initCanvas();
  },

  onReady() {
    this.initCanvas();
  },

  onHide() {
    this.stopGame();
  },

  onUnload() {
    this.stopGame();
  },

  // 初始化画布
  initCanvas() {
    const query = wx.createSelectorQuery();
    query.select('#gameCanvas').fields({ node: true, size: true }).exec((res) => {
      if (res[0]) {
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        
        // 获取设备信息
        const info = wx.getSystemInfoSync();
        const dpr = info.pixelRatio;
        
        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        ctx.scale(dpr, dpr);
        
        this.canvas = canvas;
        this.ctx = ctx;
        this.canvasWidth = res[0].width;
        this.canvasHeight = res[0].height;
        
        // 绘制开始界面背景
        this.drawBackground();
      }
    });
  },

  // 加载最高分
  loadBestScore() {
    try {
      const bestScore = wx.getStorageSync('flappyBestScore') || 0;
      this.setData({ bestScore });
    } catch (e) {
      console.error('加载最高分失败', e);
    }
  },

  // 保存最高分
  saveBestScore(score) {
    try {
      wx.setStorageSync('flappyBestScore', score);
    } catch (e) {
      console.error('保存最高分失败', e);
    }
  },

  // 开始游戏
  startGame() {
    this.setData({ 
      gameState: 'playing', 
      score: 0,
      isNewRecord: false
    });
    
    // 初始化小鸟位置
    this.bird = {
      x: this.canvasWidth * 0.25,
      y: this.canvasHeight / 2,
      velocity: 0,
      width: GAME_CONFIG.birdWidth,
      height: GAME_CONFIG.birdHeight,
      rotation: 0
    };
    
    // 初始化管道
    this.pipes = [];
    this.frameCount = 0;
    this.hasPassedPipe = false;
    
    // 开始游戏循环
    this.gameLoop();
  },

  // 重新开始游戏
  restartGame() {
    this.startGame();
  },

  // 停止游戏
  stopGame() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  },

  // 游戏主循环
  gameLoop() {
    if (this.data.gameState !== 'playing') return;
    
    this.update();
    this.draw();
    
    this.animationId = requestAnimationFrame(() => this.gameLoop());
  },

  // 更新游戏状态
  update() {
    this.frameCount++;
    
    // 更新小鸟位置
    this.bird.velocity += GAME_CONFIG.gravity;
    this.bird.y += this.bird.velocity;
    
    // 更新小鸟旋转角度
    this.bird.rotation = Math.min(Math.max(this.bird.velocity * 3, -30), 90);
    
    // 生成新管道
    if (this.frameCount % GAME_CONFIG.pipeSpawnInterval === 0) {
      this.spawnPipe();
    }
    
    // 更新管道位置
    for (let i = this.pipes.length - 1; i >= 0; i--) {
      const pipe = this.pipes[i];
      pipe.x -= GAME_CONFIG.pipeSpeed;
      
      // 检测得分
      if (!pipe.passed && pipe.x + GAME_CONFIG.pipeWidth < this.bird.x) {
        pipe.passed = true;
        this.setData({ score: this.data.score + 1 });
      }
      
      // 移除超出屏幕的管道
      if (pipe.x + GAME_CONFIG.pipeWidth < 0) {
        this.pipes.splice(i, 1);
      }
    }
    
    // 检测碰撞
    if (this.checkCollision()) {
      this.gameOver();
    }
  },

  // 生成管道
  spawnPipe() {
    const minPipeHeight = 50;
    const maxPipeHeight = this.canvasHeight - GAME_CONFIG.groundHeight - GAME_CONFIG.pipeGap - minPipeHeight;
    const topPipeHeight = Math.floor(Math.random() * (maxPipeHeight - minPipeHeight) + minPipeHeight);
    
    this.pipes.push({
      x: this.canvasWidth,
      topHeight: topPipeHeight,
      bottomY: topPipeHeight + GAME_CONFIG.pipeGap,
      width: GAME_CONFIG.pipeWidth,
      passed: false
    });
  },

  // 检测碰撞
  checkCollision() {
    const bird = this.bird;
    const groundY = this.canvasHeight - GAME_CONFIG.groundHeight;
    
    // 检测是否碰到地面或天花板
    if (bird.y + bird.height > groundY || bird.y < 0) {
      return true;
    }
    
    // 检测是否碰到管道
    for (const pipe of this.pipes) {
      // 横向碰撞检测
      if (bird.x + bird.width > pipe.x && bird.x < pipe.x + pipe.width) {
        // 纵向碰撞检测 - 上管道或下管道
        if (bird.y < pipe.topHeight || bird.y + bird.height > pipe.bottomY) {
          return true;
        }
      }
    }
    
    return false;
  },

  // 游戏结束
  gameOver() {
    this.stopGame();
    
    // 检查是否创造新纪录
    const isNewRecord = this.data.score > this.data.bestScore;
    let newBestScore = this.data.bestScore;
    
    if (isNewRecord) {
      newBestScore = this.data.score;
      this.saveBestScore(newBestScore);
    }
    
    this.setData({ 
      gameState: 'over',
      bestScore: newBestScore,
      isNewRecord: isNewRecord
    });
  },

  // 绘制游戏画面
  draw() {
    const ctx = this.ctx;
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    
    // 清空画布
    ctx.clearRect(0, 0, width, height);
    
    // 绘制背景
    this.drawBackground();
    
    // 绘制管道
    this.drawPipes();
    
    // 绘制小鸟
    this.drawBird();
    
    // 绘制地面
    this.drawGround();
  },

  // 绘制背景
  drawBackground() {
    const ctx = this.ctx;
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    
    // 天空渐变
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#4FC3F7');
    gradient.addColorStop(0.6, '#81D4FA');
    gradient.addColorStop(1, '#B3E5FC');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // 绘制云朵
    this.drawCloud(60, 80, 40);
    this.drawCloud(width * 0.5, 120, 50);
    this.drawCloud(width * 0.8, 60, 35);
  },

  // 绘制云朵
  drawCloud(x, y, size) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
    ctx.arc(x + size * 0.4, y, size * 0.6, 0, Math.PI * 2);
    ctx.arc(x + size * 0.8, y, size * 0.4, 0, Math.PI * 2);
    ctx.arc(x + size * 0.2, y - size * 0.2, size * 0.4, 0, Math.PI * 2);
    ctx.arc(x + size * 0.6, y - size * 0.15, size * 0.45, 0, Math.PI * 2);
    ctx.fill();
  },

  // 绘制小鸟
  drawBird() {
    const ctx = this.ctx;
    const bird = this.bird;
    
    ctx.save();
    ctx.translate(bird.x + bird.width / 2, bird.y + bird.height / 2);
    ctx.rotate(bird.rotation * Math.PI / 180);
    
    // 身体
    ctx.fillStyle = '#FFEB3B';
    ctx.beginPath();
    ctx.ellipse(0, 0, bird.width / 2, bird.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 边框
    ctx.strokeStyle = '#F57F17';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // 眼睛
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(10, -6, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#333333';
    ctx.beginPath();
    ctx.arc(12, -6, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // 嘴巴
    ctx.fillStyle = '#FF5722';
    ctx.beginPath();
    ctx.moveTo(16, 2);
    ctx.lineTo(26, 6);
    ctx.lineTo(16, 10);
    ctx.closePath();
    ctx.fill();
    
    // 翅膀
    ctx.fillStyle = '#FFC107';
    ctx.beginPath();
    ctx.ellipse(-8, 4, 12, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#F57F17';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    ctx.restore();
  },

  // 绘制管道
  drawPipes() {
    const ctx = this.ctx;
    
    for (const pipe of this.pipes) {
      // 上管道
      this.drawSinglePipe(pipe.x, 0, pipe.width, pipe.topHeight, true);
      // 下管道
      this.drawSinglePipe(pipe.x, pipe.bottomY, pipe.width, this.canvasHeight - pipe.bottomY, false);
    }
  },

  // 绘制单个管道
  drawSinglePipe(x, y, width, height, isTop) {
    const ctx = this.ctx;
    
    // 管道主体
    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, '#66BB6A');
    gradient.addColorStop(0.5, '#81C784');
    gradient.addColorStop(1, '#4CAF50');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
    
    // 管道边框
    ctx.strokeStyle = '#2E7D32';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, width, height);
    
    // 管道口
    const capHeight = 24;
    const capExtraWidth = 6;
    const capY = isTop ? y + height - capHeight : y;
    
    const capGradient = ctx.createLinearGradient(x - capExtraWidth, capY, x + width + capExtraWidth, capY);
    capGradient.addColorStop(0, '#66BB6A');
    capGradient.addColorStop(0.5, '#81C784');
    capGradient.addColorStop(1, '#4CAF50');
    ctx.fillStyle = capGradient;
    ctx.fillRect(x - capExtraWidth, capY, width + capExtraWidth * 2, capHeight);
    
    ctx.strokeStyle = '#2E7D32';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - capExtraWidth, capY, width + capExtraWidth * 2, capHeight);
    
    // 纹理线条
    ctx.strokeStyle = 'rgba(46, 125, 50, 0.3)';
    ctx.lineWidth = 2;
    const lineSpacing = 15;
    for (let i = lineSpacing; i < width; i += lineSpacing) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i, y + height);
      ctx.stroke();
    }
  },

  // 绘制地面
  drawGround() {
    const ctx = this.ctx;
    const groundY = this.canvasHeight - GAME_CONFIG.groundHeight;
    const width = this.canvasWidth;
    
    // 地面主体
    const gradient = ctx.createLinearGradient(0, groundY, 0, this.canvasHeight);
    gradient.addColorStop(0, '#D7CCC8');
    gradient.addColorStop(1, '#A1887F');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, groundY, width, GAME_CONFIG.groundHeight);
    
    // 草地顶部
    ctx.fillStyle = '#8BC34A';
    ctx.fillRect(0, groundY, width, 12);
    
    // 草地高光
    ctx.fillStyle = '#9CCC65';
    ctx.fillRect(0, groundY, width, 4);
    
    // 地面纹理
    ctx.strokeStyle = 'rgba(93, 64, 55, 0.15)';
    ctx.lineWidth = 2;
    const stripWidth = 30;
    const offset = (this.frameCount * GAME_CONFIG.pipeSpeed) % stripWidth;
    for (let i = -stripWidth; i < width + stripWidth; i += stripWidth) {
      ctx.beginPath();
      ctx.moveTo(i - offset, groundY + 12);
      ctx.lineTo(i - offset - 15, this.canvasHeight);
      ctx.stroke();
    }
  },

  // 处理触摸事件
  handleTouchStart(e) {
    if (this.data.gameState === 'start') {
      // 开始界面点击屏幕直接开始游戏
      this.startGame();
    } else if (this.data.gameState === 'playing') {
      // 游戏进行中 - 小鸟跳跃
      if (!this.bird) {
        // bird 不存在则先初始化
        this.startGame();
        return;
      }
      this.bird.velocity = GAME_CONFIG.jumpStrength;
      
      // 播放音效（可选）
      // this.playJumpSound();
    } else if (this.data.gameState === 'over') {
      // 游戏结束 - 点击屏幕重新开始
      this.restartGame();
    }
  }
});


export function __pageFactory_WxPage_pages_index_index() { return __capturedPage__ ?? {}; }





// Iteration helper: WeChat's wx:for accepts arrays, objects, strings, and numbers.
// Returns Array<[item, indexOrKey]> mapped to plain map() for JSX rendering.
function __wxFor(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") return val.split("");
  if (typeof val === "number") return Array.from({ length: val }, (_, i) => i);
  if (typeof val === "object") {
    // Object iteration: __wxFor returns key/value pairs; the .map below
    // unpacks them so the user's wx:for-item is the value and wx:for-index is the key.
    // (Real WeChat: index = key for object iteration.)
    return Object.keys(val).map((k) => ({ __wx_key__: k, __wx_val__: val[k] }));
  }
  return [];
}

function __parseStyle(s) {
  if (!s) return {};
  const obj = {};
  s.split(";").forEach(part => {
    const idx = part.indexOf(":");
    if (idx < 0) return;
    const key = part.slice(0, idx).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const val = part.slice(idx + 1).trim().replace(/([\d.]+)rpx/g, (_, n) => (parseFloat(n) / 7.5).toFixed(3) + "vw");
    if (key) obj[key] = val;
  });
  return obj;
}

function WxPage_pages_index_index({ __page__, __data__ }) {
  return (
    <div id="__wx_page__" className="wx-page-pages-index-index">
    <View className="game-container">
      <Canvas type="2d" id="gameCanvas" className="game-canvas" bindtouchstart={__page__.handleTouchStart ? __page__.handleTouchStart.bind(__page__) : undefined} />
      <CoverView className="ui-layer">
        {(__data__.gameState === 'playing' || __data__.gameState === 'over') && (
          <CoverView className="score-board">
            <CoverView className="score-text">
              {__data__.score}
            </CoverView>
          </CoverView>
        )}
        {(__data__.gameState === 'start') && (
          <CoverView className="start-screen">
            <CoverView className="game-title">
              Flappy Bird
            </CoverView>
            <CoverView className="game-subtitle">
              微信版
            </CoverView>
            <CoverView className="bird-icon">
              🐦
            </CoverView>
            <CoverView className="start-tip">
              点击屏幕开始游戏
            </CoverView>
            <CoverView className="tap-hint">
              👆 点击使小鸟跳跃
            </CoverView>
            <Button className="start-btn" bindtap={__page__.startGame ? __page__.startGame.bind(__page__) : undefined}>
              开始游戏
            </Button>
          </CoverView>
        )}
        {(__data__.gameState === 'over') && (
          <CoverView className="game-over-screen">
            <CoverView className="over-title">
              游戏结束
            </CoverView>
            <CoverView className="score-card">
              <CoverView className="score-item">
                <CoverView className="score-label">
                  当前得分
                </CoverView>
                <CoverView className="score-value current-score">
                  {__data__.score}
                </CoverView>
              </CoverView>
              <CoverView className="score-divider" />
              <CoverView className="score-item">
                <CoverView className="score-label">
                  最高分
                </CoverView>
                <CoverView className="score-value best-score">
                  {__data__.bestScore}
                </CoverView>
              </CoverView>
            </CoverView>
            {(__data__.isNewRecord) && (
              <CoverView className="new-record">
                🎉 新纪录！
              </CoverView>
            )}
            <Button className="restart-btn" bindtap={__page__.restartGame ? __page__.restartGame.bind(__page__) : undefined}>
              再玩一次
            </Button>
            <CoverView className="back-tip">
              点击屏幕重新开始
            </CoverView>
          </CoverView>
        )}
      </CoverView>
    </View>
    </div>
  );
}


export const __pageConfig_WxPage_pages_index_index = {"navigationBarTitleText":"Home","usingComponents":{}};
export { WxPage_pages_index_index };
