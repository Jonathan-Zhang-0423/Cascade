# Monorepo 目录重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有单体全栈项目重构为 pnpm workspace Monorepo，按 frontend/backend/database/shared 四大域划分目录，最小化多人协作时的 branch 冲突。

**Architecture:** pnpm workspace 管理四个内部包（@cascade/web、@cascade/api、@cascade/database、@cascade/shared），各包有独立 package.json 和 tsconfig，通过 `workspace:*` 引用共享代码。渐进式迁移，每步完成后验证服务可运行。

**Tech Stack:** pnpm workspace, TypeScript project references, Vite (frontend), esbuild (backend), Drizzle ORM (database)

---

## 文件映射总览

| 现有路径 | 迁移目标 |
|---------|---------|
| `shared/schema.ts` | `database/schema/` (拆分) + `shared/src/types/` (纯类型) |
| `server/index.ts` | `backend/api/src/infra/index.ts` |
| `server/routes.ts` | `backend/api/src/api/routes/` (拆分) |
| `server/db.ts` | `backend/api/src/infra/db.ts` |
| `server/storage.ts` | `backend/api/src/infra/storage.ts` |
| `server/agent-loop.ts` | `backend/api/src/agent/loop/agent-loop.ts` |
| `server/build-orchestrator.ts` | `backend/api/src/agent/orchestrator/build-orchestrator.ts` |
| `server/agent-tools.ts` | `backend/api/src/agent/tools/agent-tools.ts` |
| `server/ast-tools.ts` | `backend/api/src/agent/tools/ast-tools.ts` |
| `server/lsp-tools.ts` | `backend/api/src/agent/tools/lsp-tools.ts` |
| `server/shell-tools.ts` | `backend/api/src/agent/tools/shell-tools.ts` |
| `server/test-tools.ts` | `backend/api/src/agent/tools/test-tools.ts` |
| `server/*-prompt.ts` | `backend/api/src/agent/prompts/` |
| `server/*-client.ts` | `backend/api/src/agent/providers/` |
| `server/rn-web-compiler.ts` | `backend/api/src/compiler/rn-web/` |
| `server/flutter-compiler.ts` | `backend/api/src/compiler/flutter/` |
| `server/kotlin-wasm-compiler.ts` | `backend/api/src/compiler/kotlin-wasm/` |
| `server/wechat-web-compiler.ts` | `backend/api/src/compiler/wechat/` |
| `server/wechat/` | `backend/api/src/compiler/wechat/` |
| `server/skills/` | `backend/api/src/skills/builtin/` |
| `server/skill-loader.ts` | `backend/api/src/skills/loader.ts` |
| `server/telemetry.ts` | `backend/api/src/infra/telemetry.ts` |
| `server/preview-server.ts` | `backend/api/src/compiler/preview-server.ts` |
| `server/templates/` | `backend/api/src/compiler/templates/` |
| `server/vite.ts` | `backend/api/src/infra/vite.ts` |
| `server/static.ts` | `backend/api/src/infra/static.ts` |
| `client/src/` | `frontend/web/src/` |
| `client/public/` | `frontend/web/public/` |
| `vite.config.ts` | `frontend/web/vite.config.ts` |
| `drizzle.config.ts` | `database/drizzle.config.ts` |

---

## Task 1: 建立 workspace 骨架

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json` (根级)
- Create: `tsconfig.base.json`

- [ ] **Step 1: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - 'frontend/*'
  - 'backend/*'
  - 'database'
  - 'shared'
```

- [ ] **Step 2: 更新根级 package.json**

将现有 `package.json` 的 `scripts` 替换为顶层调度脚本，依赖保留（迁移完成前暂时保留所有依赖在根级）：

```json
{
  "name": "cascade",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "NODE_ENV=development tsx backend/api/src/infra/index.ts",
    "build": "tsx script/build.ts",
    "start": "NODE_ENV=production node dist/index.cjs",
    "check": "tsc",
    "db:push": "drizzle-kit push --config=database/drizzle.config.ts"
  }
}
```

- [ ] **Step 3: 创建 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "target": "es2020",
    "strict": true,
    "lib": ["esnext", "dom", "dom.iterable"],
    "jsx": "preserve",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "moduleResolution": "bundler",
    "noEmit": true
  }
}
```

- [ ] **Step 4: 安装 pnpm（如未安装）并验证 workspace**

```bash
npm install -g pnpm
pnpm --version
```

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml tsconfig.base.json package.json
git commit -m "chore: add pnpm workspace skeleton and base tsconfig"
```

---

## Task 2: 建立 shared 包

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/types/index.ts`
- Create: `shared/src/constants/index.ts`

- [ ] **Step 1: 创建 shared/package.json**

```json
{
  "name": "@cascade/shared",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types/index.ts",
    "./constants": "./src/constants/index.ts"
  }
}
```

- [ ] **Step 2: 创建 shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: 创建 shared/src/types/index.ts**

从现有 `shared/schema.ts` 中提取纯类型定义（不含 Drizzle 表定义）：

```typescript
// 跨端共享的业务类型，不含 ORM 依赖

export interface ManagerPlanStep {
  step_number: number;
  title: string;
  description: string;
  required_files: string[];
  acceptance_criteria: string[];
}

export interface ManagerPlan {
  summary: string;
  what_and_why: string;
  done_looks_like: string;
  out_of_scope: string;
  steps: ManagerPlanStep[];
}

export interface BuildStep {
  id: string;
  title: string;
  description: string;
  required_files: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export type Framework =
  | 'web'
  | 'rn-expo'
  | 'flutter'
  | 'swiftui'
  | 'kotlin'
  | 'wechat';

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
```

- [ ] **Step 4: 创建 shared/src/constants/index.ts**

```typescript
export const FRAMEWORKS = [
  'web',
  'rn-expo',
  'flutter',
  'swiftui',
  'kotlin',
  'wechat',
] as const;

export const EXPERIENCE_LEVELS = [
  'beginner',
  'intermediate',
  'advanced',
] as const;
```

- [ ] **Step 5: 创建 shared/src/index.ts**

```typescript
export * from './types/index.js';
export * from './constants/index.js';
```

- [ ] **Step 6: Commit**

```bash
git add shared/
git commit -m "feat(shared): add @cascade/shared package with cross-platform types"
```

---

## Task 3: 建立 database 包

**Files:**
- Create: `database/package.json`
- Create: `database/drizzle.config.ts`
- Create: `database/schema/users.ts`
- Create: `database/schema/projects.ts`
- Create: `database/schema/files.ts`
- Create: `database/schema/skills.ts`
- Create: `database/schema/index.ts`

- [ ] **Step 1: 创建 database/package.json**

```json
{
  "name": "@cascade/database",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./schema/index.ts"
  }
}
```

- [ ] **Step 2: 读取现有 shared/schema.ts 全文**

```bash
cat shared/schema.ts
```

- [ ] **Step 3: 创建 database/schema/users.ts**

从 `shared/schema.ts` 中提取 users 表相关内容：

```typescript
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  experienceLevel: text("experience_level").notNull().default("intermediate"),
  hasSetExperienceLevel: boolean("has_set_experience_level").notNull().default(false),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
```

- [ ] **Step 4: 创建 database/schema/projects.ts**

从 `shared/schema.ts` 中提取 projects 表相关内容（保留原有字段）。

- [ ] **Step 5: 创建 database/schema/files.ts**

从 `shared/schema.ts` 中提取 projectFiles 表相关内容。

- [ ] **Step 6: 创建 database/schema/skills.ts**

从 `shared/schema.ts` 中提取 userSkills、projectSkills 表相关内容。

- [ ] **Step 7: 创建 database/schema/index.ts**

```typescript
export * from './users.js';
export * from './projects.js';
export * from './files.js';
export * from './skills.js';
```

- [ ] **Step 8: 创建 database/drizzle.config.ts**

```typescript
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL not set");
}

export default defineConfig({
  out: "./migrations",
  schema: "./schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
```

- [ ] **Step 9: Commit**

```bash
git add database/
git commit -m "feat(database): add @cascade/database package with split schema files"
```

---

## Task 4: 建立 backend/api 目录结构

**Files:**
- Create: `backend/api/package.json`
- Create: `backend/api/tsconfig.json`
- Create: `backend/api/src/` (目录结构)

- [ ] **Step 1: 创建 backend/api/package.json**

```json
{
  "name": "@cascade/api",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "NODE_ENV=development tsx src/infra/index.ts",
    "build": "node ../../script/build.ts"
  },
  "dependencies": {
    "@cascade/shared": "workspace:*",
    "@cascade/database": "workspace:*"
  }
}
```

- [ ] **Step 2: 创建 backend/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../../shared/src/*"],
      "@cascade/shared": ["../../shared/src/index.ts"],
      "@cascade/database": ["../../database/schema/index.ts"]
    },
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: 创建子目录结构**

```bash
mkdir -p backend/api/src/api/routes
mkdir -p backend/api/src/api/middleware
mkdir -p backend/api/src/agent/loop
mkdir -p backend/api/src/agent/orchestrator
mkdir -p backend/api/src/agent/tools
mkdir -p backend/api/src/agent/prompts
mkdir -p backend/api/src/agent/providers
mkdir -p backend/api/src/compiler/rn-web
mkdir -p backend/api/src/compiler/flutter
mkdir -p backend/api/src/compiler/kotlin-wasm
mkdir -p backend/api/src/compiler/wechat
mkdir -p backend/api/src/skills/builtin
mkdir -p backend/api/src/infra
```

- [ ] **Step 4: Commit**

```bash
git add backend/
git commit -m "chore(backend): scaffold @cascade/api package structure"
```

---

## Task 5: 迁移 server/ 文件到 backend/api/src/

这是最大的一步，按子域分批移动。

- [ ] **Step 1: 迁移 infra 层文件**

```bash
cp server/index.ts backend/api/src/infra/index.ts
cp server/db.ts backend/api/src/infra/db.ts
cp server/storage.ts backend/api/src/infra/storage.ts
cp server/telemetry.ts backend/api/src/infra/telemetry.ts
cp server/vite.ts backend/api/src/infra/vite.ts
cp server/static.ts backend/api/src/infra/static.ts
cp server/parts.ts backend/api/src/infra/parts.ts
cp server/context-compressor.ts backend/api/src/infra/context-compressor.ts
```

- [ ] **Step 2: 迁移 API 路由层**

```bash
cp server/routes.ts backend/api/src/api/routes/index.ts
cp server/ab-test-scenarios.ts backend/api/src/api/ab-test-scenarios.ts
```

- [ ] **Step 3: 迁移 agent 层**

```bash
cp server/agent-loop.ts backend/api/src/agent/loop/agent-loop.ts
cp server/build-orchestrator.ts backend/api/src/agent/orchestrator/build-orchestrator.ts
cp server/explore-agent.ts backend/api/src/agent/orchestrator/explore-agent.ts
cp server/step-dependency-analyzer.ts backend/api/src/agent/orchestrator/step-dependency-analyzer.ts
cp server/agent-tools.ts backend/api/src/agent/tools/agent-tools.ts
cp server/ast-tools.ts backend/api/src/agent/tools/ast-tools.ts
cp server/lsp-tools.ts backend/api/src/agent/tools/lsp-tools.ts
cp server/lsp-manager.ts backend/api/src/agent/tools/lsp-manager.ts
cp server/shell-tools.ts backend/api/src/agent/tools/shell-tools.ts
cp server/shell-manager.ts backend/api/src/agent/tools/shell-manager.ts
cp server/test-tools.ts backend/api/src/agent/tools/test-tools.ts
cp server/block-hash.ts backend/api/src/agent/tools/block-hash.ts
cp server/compile-checks.ts backend/api/src/agent/tools/compile-checks.ts
cp server/manager-prompt.ts backend/api/src/agent/prompts/manager-prompt.ts
cp server/editor-prompt.ts backend/api/src/agent/prompts/editor-prompt.ts
cp server/verifier-prompt.ts backend/api/src/agent/prompts/verifier-prompt.ts
cp server/communicator-prompt.ts backend/api/src/agent/prompts/communicator-prompt.ts
cp server/mobile-prompt-supplements.ts backend/api/src/agent/prompts/mobile-prompt-supplements.ts
cp server/doubao-client.ts backend/api/src/agent/providers/doubao-client.ts
cp server/kimi-client.ts backend/api/src/agent/providers/kimi-client.ts
cp server/minimax-client.ts backend/api/src/agent/providers/minimax-client.ts
cp server/glm-client.ts backend/api/src/agent/providers/glm-client.ts
cp server/retry.ts backend/api/src/agent/providers/retry.ts
```

- [ ] **Step 4: 迁移 compiler 层**

```bash
cp server/rn-web-compiler.ts backend/api/src/compiler/rn-web/rn-web-compiler.ts
cp server/rn-vendor-entry.js backend/api/src/compiler/rn-web/rn-vendor-entry.js
cp server/flutter-compiler.ts backend/api/src/compiler/flutter/flutter-compiler.ts
cp server/kotlin-wasm-compiler.ts backend/api/src/compiler/kotlin-wasm/kotlin-wasm-compiler.ts
cp server/swift-wasm-compiler.ts backend/api/src/compiler/kotlin-wasm/swift-wasm-compiler.ts
cp server/wechat-web-compiler.ts backend/api/src/compiler/wechat/wechat-web-compiler.ts
cp -r server/wechat/ backend/api/src/compiler/wechat/runtime/
cp server/compiler-utils.ts backend/api/src/compiler/compiler-utils.ts
cp server/preview-server.ts backend/api/src/compiler/preview-server.ts
cp server/framework-detector.ts backend/api/src/compiler/framework-detector.ts
cp -r server/templates/ backend/api/src/compiler/templates/
cp -r server/compile-templates/ backend/api/src/compiler/compile-templates/
```

- [ ] **Step 5: 迁移 skills 层**

```bash
cp server/skill-loader.ts backend/api/src/skills/loader.ts
cp server/user-skill-loader.ts backend/api/src/skills/user-skill-loader.ts
cp -r server/skills/ backend/api/src/skills/builtin/
```

- [ ] **Step 6: 迁移其他文件**

```bash
cp -r server/__tests__/ backend/api/__tests__/
cp -r server/artifacts/ backend/api/artifacts/
cp -r server/assets/ backend/api/assets/
cp -r server/stubs/ backend/api/stubs/
```

- [ ] **Step 7: Commit（迁移副本，旧文件暂留）**

```bash
git add backend/
git commit -m "chore(backend): copy server files into new directory structure"
```

---

## Task 6: 建立 frontend/web 目录结构并迁移

**Files:**
- Create: `frontend/web/package.json`
- Create: `frontend/web/tsconfig.json`
- Create: `frontend/web/vite.config.ts`
- Move: `client/` → `frontend/web/`

- [ ] **Step 1: 创建 frontend/web/package.json**

```json
{
  "name": "@cascade/web",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@cascade/shared": "workspace:*"
  }
}
```

- [ ] **Step 2: 创建 frontend/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@shared/*": ["../../shared/src/*"],
      "@cascade/shared": ["../../shared/src/index.ts"]
    },
    "types": ["node", "vite/client"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: 创建 frontend/web/vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "../../shared/src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "../../dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
```

- [ ] **Step 4: 复制 client 内容到 frontend/web**

```bash
mkdir -p frontend/web
cp -r client/src frontend/web/src
cp -r client/public frontend/web/public 2>/dev/null || true
```

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "chore(frontend): copy client files into frontend/web package"
```

---

## Task 7: 更新路径引用

这是最细致的一步——更新新位置文件中的 import 路径。

- [ ] **Step 1: 更新 backend 中对 shared/schema 的引用**

在 `backend/api/src/` 下，将所有 `from "../../shared/schema"` 或 `from "@shared/schema"` 替换为 `from "@cascade/database"`：

```bash
grep -r "shared/schema\|@shared/schema" backend/api/src/ --include="*.ts" -l
```

对每个找到的文件，将引用改为：
```typescript
import { users, projects, projectFiles } from "@cascade/database";
```

- [ ] **Step 2: 更新 backend 中的相对路径引用**

由于文件从 `server/` 移到了 `backend/api/src/` 的子目录，相对路径层级发生变化。运行类型检查找出所有错误：

```bash
cd backend/api && npx tsc --noEmit 2>&1 | head -50
```

逐一修复报错的 import 路径。

- [ ] **Step 3: 更新 frontend 中对 @shared 的引用**

```bash
grep -r "@shared/" frontend/web/src/ --include="*.ts" --include="*.tsx" -l
```

`@shared/` 别名在新 vite.config.ts 中已指向 `../../shared/src`，路径引用格式不变，但需确认 `@shared/schema` 的引用改为从 `@cascade/shared` 导入类型。

- [ ] **Step 4: 更新 backend/api/src/infra/index.ts 的入口引用**

确保 `index.ts` 中对 `routes`、`vite`、`static` 的引用路径正确：

```typescript
// 原: import { registerRoutes } from "./routes";
// 新: import { registerRoutes } from "../api/routes/index.js";
```

- [ ] **Step 5: 运行类型检查验证**

```bash
npm run check
```

修复所有 TS 错误后继续。

- [ ] **Step 6: Commit**

```bash
git add backend/ frontend/ shared/ database/
git commit -m "chore: update import paths for new monorepo structure"
```

---

## Task 8: 更新根级构建配置

**Files:**
- Modify: `script/build.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: 更新 tsconfig.json**

```json
{
  "extends": "./tsconfig.base.json",
  "include": [
    "frontend/web/src/**/*",
    "backend/api/src/**/*",
    "database/schema/**/*",
    "shared/src/**/*"
  ],
  "exclude": ["node_modules", "build", "dist", "**/*.test.ts", "backend/api/artifacts/**"],
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/typescript/tsbuildinfo",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./frontend/web/src/*"],
      "@shared/*": ["./shared/src/*"],
      "@cascade/shared": ["./shared/src/index.ts"],
      "@cascade/database": ["./database/schema/index.ts"]
    },
    "types": ["node", "vite/client"]
  }
}
```

- [ ] **Step 2: 更新 script/build.ts 的入口路径**

将 esbuild 入口从 `server/index.ts` 改为 `backend/api/src/infra/index.ts`：

```typescript
await esbuild({
  entryPoints: ["backend/api/src/infra/index.ts"],
  // ... 其余不变
});
```

- [ ] **Step 3: 验证开发服务器启动**

```bash
npm run dev
```

确认服务在 port 5000 正常启动，前端页面可访问，API 可响应。

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json script/build.ts package.json
git commit -m "chore: update root build config for monorepo structure"
```

---

## Task 9: 删除旧目录，完成迁移

**前提：** Task 8 验证通过，`npm run dev` 正常运行。

- [ ] **Step 1: 删除旧 server/ 目录**

```bash
rm -rf server/
```

- [ ] **Step 2: 删除旧 client/ 目录**

```bash
rm -rf client/
```

- [ ] **Step 3: 删除旧 shared/schema.ts（已拆分到 database/ 和 shared/src/）**

```bash
rm -rf shared/schema.ts
# 保留 shared/ 目录，它现在是 @cascade/shared 包
```

- [ ] **Step 4: 删除根级旧配置文件**

```bash
rm -f vite.config.ts drizzle.config.ts
```

- [ ] **Step 5: 最终验证**

```bash
npm run dev        # 开发服务器正常
npm run check      # 类型检查通过
npm run build      # 生产构建成功
```

- [ ] **Step 6: 最终 Commit**

```bash
git add -A
git commit -m "chore: complete monorepo restructure, remove legacy directories"
```

- [ ] **Step 7: 推送到 GitHub**

```bash
git push origin main
```

---

## 验证清单

迁移完成后确认以下各项：

- [ ] `npm run dev` 启动，浏览器访问 `http://localhost:5000` 正常
- [ ] 登录/注册功能正常（auth 路由）
- [ ] 创建项目、打开 IDE 正常
- [ ] Manager chat（Plan 模式）SSE 流正常
- [ ] Build session（Build 模式）SSE 流正常
- [ ] 预览面板（Web iframe）正常
- [ ] `npm run check` 无 TS 错误
- [ ] `npm run build` 生产构建成功
- [ ] `git log --oneline -10` 显示清晰的迁移提交历史
