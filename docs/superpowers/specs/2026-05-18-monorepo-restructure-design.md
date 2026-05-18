# Monorepo 目录重构设计文档

**日期：** 2026-05-18  
**状态：** 已批准

---

## Context

CodeStart（现更名 Cascade）当前是一个 Replit 风格的单体全栈项目，所有代码平铺在根目录下的 `client/`、`server/`、`shared/` 三个文件夹中，共用一个 `package.json`。

随着项目向商用方向扩展，多人协作开发时不同功能方向的 branch 会频繁冲突（例如 AI agent 开发和 UI 开发都可能改动 `server/routes.ts`）。需要通过目录边界将各功能域隔离，使每个 branch 的改动集中在自己的目录内，最小化合并冲突。

**目标：** 将项目重构为 pnpm workspace Monorepo，按 frontend / backend / database / shared 四大域划分，每域内部按功能细分子目录。

---

## 目标目录结构

```
Cascade/
├── pnpm-workspace.yaml
├── package.json                    # 根级，只放顶层 scripts
├── tsconfig.base.json              # 共享 TS 基础配置
│
├── frontend/
│   └── web/                        # @cascade/web
│       ├── package.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── pages/
│           ├── components/
│           │   ├── ide/
│           │   │   ├── editor/
│           │   │   ├── chat/
│           │   │   ├── preview/
│           │   │   ├── filetree/
│           │   │   └── console/
│           │   └── ui/
│           ├── stores/
│           ├── hooks/
│           └── lib/
│
├── backend/
│   └── api/                        # @cascade/api
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts            # Express 入口
│           ├── api/
│           │   ├── routes/         # auth, projects, build-session, manager-chat
│           │   └── middleware/
│           ├── agent/
│           │   ├── loop/
│           │   ├── orchestrator/
│           │   ├── tools/
│           │   ├── prompts/
│           │   └── providers/
│           ├── compiler/
│           │   ├── rn-web/
│           │   ├── flutter/
│           │   ├── kotlin-wasm/
│           │   └── wechat/
│           ├── skills/
│           │   ├── builtin/
│           │   └── loader.ts
│           └── infra/
│               ├── session.ts
│               ├── storage.ts
│               └── telemetry.ts
│
├── database/                       # @cascade/database
│   ├── package.json
│   ├── drizzle.config.ts
│   ├── schema/
│   │   ├── users.ts
│   │   ├── projects.ts
│   │   ├── files.ts
│   │   └── skills.ts
│   └── migrations/
│
├── shared/                         # @cascade/shared
│   ├── package.json
│   └── src/
│       ├── types/                  # ManagerPlan, BuildPlan 等跨端接口
│       └── constants/
│
└── docs/
    └── superpowers/
        ├── specs/
        └── plans/
```

---

## Package 依赖关系

```
@cascade/web      → @cascade/shared
@cascade/api      → @cascade/shared, @cascade/database
@cascade/database → (无内部依赖)
@cascade/shared   → (无内部依赖)
```

pnpm workspace 通过 `"workspace:*"` 引用自动建立符号链接，无需手动 `ln -s`。

---

## Branch 冲突控制

| Branch 类型 | 主要改动目录 | 冲突风险 |
|-------------|-------------|---------|
| `feat/ui-*` | `frontend/web/src/components/` | 极低 |
| `feat/agent-*` | `backend/api/src/agent/` | 极低 |
| `feat/compiler-*` | `backend/api/src/compiler/` | 极低 |
| `feat/api-*` | `backend/api/src/api/routes/` | 低 |
| `feat/db-*` | `database/schema/` | 低 |
| `feat/shared-types` | `shared/src/types/` | 需协调，文件少 |

**原则：** `shared/` 只放纯类型定义和常量，不含业务逻辑。任何业务改动都不需要动 `shared/`。

---

## 迁移策略

渐进式迁移，每步完成后验证 `npm run dev` 可运行：

1. 建立 workspace 骨架（配置文件）
2. 迁移 `shared/` → `shared/src/`，拆分 schema 到 `database/`
3. 迁移 `server/` → `backend/api/src/`，按功能子目录归类
4. 迁移 `client/` → `frontend/web/src/`
5. 更新所有路径引用和构建配置
6. 删除旧目录，清理根级配置

---

## 部署方式

- **frontend/web** → 构建静态产物，部署到 CDN / Vercel
- **backend/api** → 独立 Node.js 服务，部署到云服务器或容器
- **database** → 仅包含 schema 和迁移，由 backend 在启动时引用
