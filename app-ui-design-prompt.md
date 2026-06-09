# App UI 设计提示词

> 对照 `replit-preview.html` 的目标设计。
> 每个组件后面标注了 🔴 **代码位置**，直接跳转修改。
> 修改格式：告诉我「把 [组件名] 的 [属性] 改成 [值]」即可。

---

## 一、整体布局

**布局结构**：顶部 Navbar + 下方（左侧边栏 | Chat | Preview）

```
[ Navbar — 通栏                                              ]
[ 左侧边栏(可折叠) | Chat Panel | Preview Panel(可拖拽宽度) ]
```

- 外层间距：`padding: 6px; gap: 6px`
- 🔴 `frontend/web/src/App.tsx`

---

## 二、Navbar（顶部导航栏）

```
[ ▌▌▌▌▌ Cascade AI ] [ | ] [ 项目名 ]        [🔔] [👤]
```

| 组件 | 当前可改的属性 |
|------|--------------|
| 整体 | 高度（44px）、背景色（白）、底部边框 |
| **Logo 竖线组合** | 5根竖线，高度从矮到高再到矮，**全部纯黑色**（禁止改成蓝色或其他颜色） |
| **Logo 文字** | "Cascade AI"，**全部纯黑色**，`font-size: 14px font-weight: 700` |
| 分割线 | `1px 高18px`，颜色 `#E5E7EB` |
| 项目名 | `font-size: 13px font-weight: 500`，颜色黑色 |
| ~~进度条~~ | **已去掉，不再存在** |
| ~~Upgrade 按钮~~ | **已去掉，不再存在** |
| 右侧铃铛图标 | `32x32px`，颜色灰色，hover 有背景 |
| 右侧头像图标 | `32x32px`，颜色灰色，hover 有背景 |

🔴 对应代码：`frontend/web/src/App.tsx` 或主 IDE 布局组件

---

## 三、左侧边栏（可折叠）

```
[ Main version ▏              [←] ]
[ 💪 Fitness Hub                  ]
[   Web app · HTML                ]
──────────────────────────────────
[ ✦ AI Chat              [badge2] ]
[ 📄 Files                        ]
[ </> Editor                      ]
──────────────────────────────────
[ 🛡 Deployments                  ]
[ 🔒 Secrets                      ]
──────────────────────────────────
[ ? Help                          ]
```

| 组件 | 当前可改的属性 |
|------|--------------|
| 边栏整体 | 宽度（220px）、背景色（白）、右边框 |
| "Main version" 标签 | 文字、背景、边框、圆角 |
| 折叠箭头 ← | 图标、位置 |
| 项目图标卡片 | emoji、尺寸、背景色 |
| 项目名 | 字号、粗细 |
| 项目副标题 | 字号、颜色 |
| 菜单项（默认） | 字号、图标颜色、行高 |
| 菜单项（激活） | 背景色（蓝色淡）、文字色（蓝）|
| 徽标 badge | 背景蓝、白字、圆角胶囊 |
| 分割线 | 颜色、边距 |
| 底部 Help 按钮 | 字号、颜色 |

🔴 对应代码：侧边栏组件（待确认路径）

---

## 四、Chat 面板

### 4-A. Chat Header（面板顶部）

```
[ 任务标题文字 ···················· ] [↺] [⊞]
```

| 组件 | 当前可改的属性 |
|------|--------------|
| Header 整体 | 高度、底部边框 |
| 标题文字 | 字号、粗细、颜色、是否截断 |
| 右侧图标按钮 | 图标类型、尺寸、颜色 |

🔴 `frontend/web/src/components/ide/chat-panel.tsx`

---

### 4-B. Agent 状态行（标题下方）

```
[ ◌旋转spinner ]  [ Planning final release deployment ]
```

| 组件 | 当前可改的属性 |
|------|--------------|
| Spinner 样式 | **目前是实心圆点 pulse** → 目标是旋转边框圆圈（`border-top` 变色） |
| 状态文字 | 字号、颜色、是否显示计时 |
| 整体内边距 | 上下左右 padding |

🔴 `frontend/web/src/components/ide/chat/ChatInputArea.tsx` — `STATUS_COLORS` / 状态行区域

---

### 4-C. 消息列表

#### AI 消息（无气泡，文档风格）

```
FitTrack is live! Here's what's built:
• Dashboard — stat cards...
• Workouts — list all sessions...
Would you like me to add a timer?
```

| 组件 | 当前可改的属性 |
|------|--------------|
| AI 消息整体 | 字号、行高、颜色、底部间距 |
| 列表项 `•` 符号 | 颜色、对齐 |
| 加粗文字 | 粗细、颜色 |

🔴 `frontend/web/src/components/ide/chat/plan-components.tsx` — `ManagerMessageBubble`

---

#### Checkpoint 行

```
✓  Checkpoint made · 3 hours ago
```

| 组件 | 当前可改的属性 |
|------|--------------|
| ✓ 图标 | 颜色、字号 |
| 描述文字 | 字号、颜色 |
| 整体间距 | 上下 margin |

🔴 `frontend/web/src/components/ide/CheckpointPanel.tsx`

---

#### 用户消息气泡

```
                    [ Add progress charts to the dashboard ]
```

| 组件 | 当前可改的属性 |
|------|--------------|
| 气泡背景色 | **目前无边框深色** → 目标有描边浅蓝 |
| 气泡边框 | 颜色、是否显示 |
| 气泡圆角 | 四角分别设置（右下角小） |
| 文字颜色 | 深色/浅色 |
| 最大宽度 | `max-width` 百分比 |

🔴 `frontend/web/src/components/ide/chat/plan-components.tsx` — `ManagerMessageBubble` user 分支

---

#### Credits / 提示卡片（内联嵌入对话流）

```
✦  You're out of credits.
   Upgrade to Core →
```

| 组件 | 当前可改的属性 |
|------|--------------|
| 卡片背景色 | 当前无此组件 |
| 卡片边框 | 颜色 |
| 图标 | 字符/颜色 |
| 正文 / 链接文字 | 字号、颜色 |

🔴 暂无对应组件，需新增

---

### 4-D. Plan Card（任务计划卡片）

```
┌──────────────────────────────────────┐
│ 📄 Task plan created        [View][×]│  ← Header
├──────────────────────────────────────┤
│ Add Progress Charts & Statistics     │  ← 标题
│ Create chart components using...     │  ← 描述
│ [Web app]                            │  ← 类型 pill
│  1  ✓  Install Chart.js              │  ← 步骤列表
│  2  ●  Create ChartComponent.tsx     │
│     └ Building line chart...         │  ← 执行中子文字
│  3  ○  Update Dashboard layout       │
│  4  ○  Add date range filter         │
│  5  ○  Connect to PostgreSQL         │
│  2 / 5 steps done                    │  ← 进度文字
├──────────────────────────────────────┤
│ [🔧 Build in background ▾]  [Build here] │  ← 操作按钮
├──────────────────────────────────────┤
│ [✏ Revise] [✕ Cancel]    [⊞ Power ▾]│  ← 底部工具栏
└──────────────────────────────────────┘
```

| 组件 | 当前可改的属性 |
|------|--------------|
| 卡片容器 | 背景色、边框、圆角、**阴影（目标：去掉阴影）** |
| Header 图标 | **目前是旋转 Loader** → 目标是静态文件图标 |
| Header 标题 | 字号、字体（目标去掉 monospace） |
| View 按钮 | 颜色、hover 效果 |
| 关闭 × 按钮 | 尺寸、颜色 |
| 卡片主标题 | 字号、粗细 |
| 描述文字 | 字号、颜色 |
| 类型 pill | 背景色、边框、圆角、文字颜色 |
| 步骤行整体 | 行高、字号 |
| 步骤序号 | 字体、颜色、宽度 |
| 待执行 ○ | 颜色 |
| 执行中 ● | **目前是文字符号** → 目标是实心小圆点 DOM 元素，带 pulse |
| 已完成 ✓ | 颜色 |
| 执行中行文字 | 是否加粗、颜色 |
| 已完成行文字 | 颜色（变灰） |
| 子文字（narration） | 字号、颜色 |
| 进度文字 | 字号、颜色 |
| Build in background 按钮 | 边框颜色、圆角、文字颜色、分隔线颜色 |
| Build here 按钮 | 背景色、字号、圆角、hover 颜色 |
| 底部 Revise/Cancel/Power 按钮 | 字号、字体（目标去掉 monospace）、颜色 |

🔴 `frontend/web/src/components/ide/chat/plan-components.tsx` — `TaskPlanCard` / `StepItem`

---

### 4-E. 输入框（Composer）

```
┌──────────────────────────────────────┐
│ Make, test, iterate...               │
│                                      │
│ [+] [⠿] [Economy▾] [Plan] [🎤]  [↑] │
└──────────────────────────────────────┘
```

| 组件 | 当前可改的属性 |
|------|--------------|
| 输入框外层容器 | 背景色、**边框（目标：`1px solid #E5E7EB`，圆角 12px）**、**左侧彩色强调线（目标：去掉）** |
| Textarea 背景 | **目前是深色** → 目标白色 |
| Textarea 字号 | 大小 |
| Textarea 最小高度 | 目前 38px → 目标 72px |
| Placeholder 文字 | 内容（目标 `"Make, test, iterate..."`）、颜色 |
| + 附件按钮 | 目前无 → 目标新增 |
| ⠿ 拖拽图标 | 目前无 → 目标新增 |
| Model 选择器 | **目前是下拉 Select** → 目标是描边 pill（`Economy ▾`） |
| plan/review 开关 | **目前是两个独立复选框** → 目标合并为单个 `Plan` pill |
| 麦克风按钮 | 目前无 → 目标新增 |
| 发送按钮 | 尺寸（目标 32px）、背景色（目标 `#0066FF`） |
| 停止按钮 | 颜色、尺寸（保持红色圆形） |

🔴 `frontend/web/src/components/ide/chat/ChatInputArea.tsx` — 整个组件

---

## 五、Preview 面板

### 5-A. 顶栏（Preview + Tab 合并为一行）

```
[ Preview × | Canvas(蓝) × | 🗄 Fitness Tracker ▾ ]  [空白]  [🔍] [+ Tools & files] [Invite] [●Publish] [⊞]
```

| 组件 | 目标设计 |
|------|----------|
| 整体 | 高度 38px，白色背景，底部 1px 分割线，**Preview × 和 Tab 在同一行** |
| "Preview" 文字 | `font-size: 13px font-weight: 500`，黑色 |
| Preview × 按钮 | `18×18px`，灰色，hover 有背景，紧跟文字右侧 |
| 竖向分隔线 | `1px 高16px #E5E7EB`，Preview × 和 Canvas tab 之间 |
| **Canvas Tab（激活）** | 蓝色文字，底部 `2px solid #0066FF`，无填充背景 |
| Canvas × 按钮 | `14×14px`，紧跟 tab 文字 |
| **Fitness Tracker Tab（非激活）** | 左侧服务器图标，灰色文字，右侧 ▾，hover 变深 |
| 中间空白 | `flex: 1` 撑满 |
| 🔍 搜索图标 | `26×26px`，灰色，无边框 |
| + Tools & files | 描边小按钮，灰色文字，`height: 26px border-radius: 6px` |
| Invite 按钮 | 白底描边，`height: 24px border-radius: 6px font-size: 11px` |
| ● Publish 按钮 | 蓝底白字，左侧小白圆点，`height: 24px border-radius: 6px font-weight: 500` |
| ⊞ 展开图标 | `26×26px`，灰色，无边框 |

🔴 `frontend/web/src/components/ide/preview-panel.tsx` — Tab bar 区域

---

### 5-B. 预览工具栏（地址栏行）

```
[ 🗄 Fitness Tracker ▾ ]  [←][→][↺]  [ 🔗 .replit.dev/ ················· ]  [PC][📱]  [⚙]  [↗]
```

| 组件 | 目标设计 |
|------|----------|
| 工具栏整体 | 浅灰背景 `#F9FAFB`，底部 1px 分割线，高度 38px |
| **App 名称下拉** | 左侧服务器图标 + 文字 + ▾，白底描边，`height: 26px border-radius: 6px` |
| **← → ↺ 导航按钮** | `26×26px`，无边框，灰色，hover 有背景 |
| **🔗 URL 地址栏** | `flex: 1`，浅灰填充，描边，`height: 26px border-radius: 6px`，左侧链接图标 |
| **PC/Mobile 切换** | 白底描边 pill，子按钮 `25×21px`，激活态浅灰填充 |
| **⚙ 设置** | `27×26px`，白底描边，`border-radius: 6px` |
| **↗ 外链** | 同设置按钮样式 |

> **当前代码 vs 目标**：现有工具栏是「框架badge + iOS/Android切换 + 设备下拉 + 旋转/亮暗/QR/刷新/控制台」，需整体替换。

🔴 `frontend/web/src/components/ide/preview-panel.tsx` — preview-toolbar 区域

---

### 5-C. 预览内容区

```
┌──────────────────────┐
│  [浅灰 #F0F0F0 背景] │
│  ┌────────────────┐  │
│  │  App 矩形框    │  │
│  │  无手机外壳    │  │
│  └────────────────┘  │
└──────────────────────┘
```

| 组件 | 当前可改的属性 |
|------|--------------|
| 预览区背景色 | `#F0F0F0` 浅灰 |
| **应用展示框** | **目前是完整手机外壳** → 目标是纯矩形框，`border-radius: 12px`，`box-shadow: 0 0 0 1px rgba(0,0,0,0.1)`，无状态栏/物理按键 |
| 应用框尺寸 | 宽 `340px` × 高 `580px` |
| **Preview 面板可拖拽** | Chat 和 Preview 之间有拖拽手柄，向左拖扩大 Preview，向右缩小 |

🔴 `frontend/web/src/components/ide/preview-panel.tsx` + `frontend/web/src/components/ide/device-simulator.tsx`

---

## 快速修改指令示例

```
把 [输入框] 的 [左侧彩色强调线] 去掉
把 [输入框] 的 [背景色] 改成白色，边框改成 1px solid #E5E7EB，圆角 12px
把 [发送按钮] 的 [尺寸] 改成 32px，[背景色] 改成 #0066FF
把 [Plan Card] 的 [阴影] 去掉
把 [Agent Spinner] 从实心点改成旋转边框圆圈
把 [预览内容区] 的 [应用展示] 从手机外壳改成纯矩形框
```
