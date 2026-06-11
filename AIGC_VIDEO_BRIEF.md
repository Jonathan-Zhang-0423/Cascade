# AIGC 视频生成功能 — 简报

> 面向另一个开发窗口/会话,帮助快速理解"AIGC = 手机预览页视频生成"功能的设计逻辑与代码位置。
> 仓库:CascadeAI (github.com/Jonathan-Zhang-0423/Cascade) · 当前工作分支:`AIGC-Tencent-6-11`

---

## 1. 功能是什么

手机预览面板右下角的浮动按钮(VideoFab)。用户选择时长(10/20/30 秒),系统把当前项目的预览页录制成一段 MP4 预览视频,可下载或发送到用户邮箱。

注意:代码里**没有 "aigc" 这个字符串**。"AIGC 功能"是产品/沟通层面的叫法,对应的就是这套"预览视频生成"。

## 2. 端到端设计逻辑(数据流)

```
[前端 VideoFab 按钮]
    │  POST /api/video/generate { projectId, duration }
    ▼
[后端 generate 路由]  生成 jobId,放入内存 Map videoJobs,异步启动 recordPreview()
    │                 立即返回 { jobId }
    ▼
[recordPreview() 核心流水线]
    1. Playwright 启动无头 Chromium (--no-sandbox --disable-dev-shm-usage)
    2. 打开 http://localhost:${PORT}/preview/${projectId},视口 390×844
    3. 循环截帧:每 100ms 截一张 PNG,共 duration×10 帧,进度写回 job.progress(0→90%)
    4. ffmpeg 把 PNG 序列合成 MP4 (libx264 / yuv420p, framerate 10),进度→100%
    5. job.status = "done",保存 outputPath
    ▼
[前端轮询]  GET /api/video/status/:jobId  → { status, progress }  每 ~2s 一次
    ▼
[完成后]  GET /api/video/download/:jobId   下载 MP4(响应结束后删临时文件)
          或 POST /api/video/send-email/:jobId  用 sendEmail 把 MP4 作附件发到用户邮箱

[清理] 全局定时器每隔一段时间清除 done/error 且超过 10 分钟的旧 job
```

关键设计点:
- **作业状态在内存**(`videoJobs` Map),不落库,服务重启即丢失。
- **并发限流**:`MAX_VIDEO_JOBS = 2`,超出返回 429。
- **超时保护**:整体 `VIDEO_TIMEOUT_MS = 90_000`(90s),ffmpeg 单独 60s 超时。
- **时长白名单**:只接受 10 / 20 / 30 秒,其余返回 400。
- `/preview/:projectId` 是前端 SPA 路由(后端无显式定义),录制时由无头浏览器访问它来截图。

## 3. 涉及的文件与精确位置

### 前端(全部在一个文件内)
`frontend/web/src/components/mobile/MobilePreviewPanel.tsx`
| 行号 | 内容 |
|------|------|
| 66 | `type RecordState`(录制状态机:idle/selecting/recording/done...) |
| 72 | `interface VideoJob` |
| 153 | `function useVideoRecorder()` — 录制 hook,封装 generate/轮询/下载/发邮件 |
| 253 | `function VideoFab()` — 浮动按钮 UI(文案为硬编码中文,不走 i18n) |
| 496 | `<VideoFab />` — 在 MobilePreviewPanel 内平行挂载(与各 previewMode 渲染分支无耦合) |

### 后端(全部在路由总文件内)
`backend/api/src/api/routes/index.ts`
| 行号 | 内容 |
|------|------|
| 364 | `interface VideoJobState` |
| 372 | `const videoJobs = new Map<...>()` — 内存作业表 |
| ~416-421 | 过期 job 清理定时器(10 分钟保留) |
| 4028 | `MAX_VIDEO_JOBS = 2` 并发上限 |
| 4029 | `VIDEO_TIMEOUT_MS = 90_000` 超时 |
| 4034-4036 | 启动时 ffmpeg 可用性探测(缺失打 warn) |
| 4038 | `async function recordPreview()` — 截帧 + ffmpeg 合成核心 |
| 4143 | `POST /api/video/generate` |
| 4169 | `GET  /api/video/status/:jobId` |
| 4175 | `GET  /api/video/download/:jobId` |
| 4194 | `POST /api/video/send-email/:jobId`(依赖 `sendEmail` + session 里的 userId/email) |

### 复用的既有模块(非视频专属)
- `sendEmail`(`backend/api/src/infra/email.ts`)— 发邮件,RESEND_API_KEY 未设时 dev 环境只打日志。
- `storage.getUser` — 取用户 email。
- `spawnProcess` / `spawn` — 调 ffmpeg。

## 4. 运行时依赖(关键!之前"生成失败"的真正原因)

功能代码早已完整实现,但**依赖部署环境装两样东西**,缺了就报错:
1. **Playwright Chromium 无头浏览器** — 缺失时报 `browserType.launch: Executable doesn't exist`。
2. **ffmpeg** — 缺失时帧截完但合成失败。

安装方式:
```bash
npx playwright install chromium     # 装到 ~/.cache/ms-playwright(默认路径,代码未覆盖)
# ffmpeg:系统包 apt-get install -y ffmpeg,或用 playwright 自带的 ffmpeg-1011
```
注意:国内网络到 Playwright 官方 CDN 极慢,镜像 (cdn.npmmirror.com) 对 1223 版本只镜像了 arm64、缺 linux x64;最终是从官方源直连慢速下完的(约 113MB)。

## 5. 当前状态(截至本简报)

- 测试实例跑在端口 **5100**(PM2 进程名 `cascadeai-test`),用独立测试库 `cascade_test_db`,与生产(5000 / `cascade_db`)完全隔离。
- 依赖已装齐并实测:Chromium 启动+截图 OK,ffmpeg OK。
- **端到端实测通过**:一次真实生成 job 进度 0→100,最终 `{"status":"done"}`,无报错。
- 结论:**视频功能现在完全可用**。生产机器此前 `~/.cache/ms-playwright` 也是空的,说明该功能在生产上从未真正跑通过——属于"依赖缺失"而非代码缺陷。

## 6. 如需"剔除该功能"的最小改动(备选,目前未执行)
- 前端:删/注释 `MobilePreviewPanel.tsx:496` 的 `<VideoFab />`(用户即看不到入口)。
- 后端:删 `interface VideoJobState`(364)、`videoJobs` Map(372)及清理逻辑、`recordPreview()` 与 4 个 `/api/video/*` 路由(4038–4240 区段)。
- 附带好处:不再需要 Playwright/ffmpeg 运行时依赖。
- 耦合度极低,剔除不影响 Plan/Build 生码、预览、登录等核心功能。

## 7. 上生产的独立风险提示(与视频功能无关,但需知晓)
本测试代码是 GitHub 最新 main(`d757dd6`),**生产在跑的是更旧的 `278d9de`**。若要把这套新代码上生产,真正的风险在于该 PR 引入的:
- session 存储从内存改为 PostgreSQL 持久化(配置/schema 不同步会导致登录态问题);
- 数据库 schema 漂移(需先比对再 db:push);
- manager/editor/verifier 三个核心 prompt 与 agent tools 的大量改动(需回归测试)。
剔除/修复视频功能本身近乎零风险,但"新代码替换生产"是另一件高风险的事,不能混为一谈。
