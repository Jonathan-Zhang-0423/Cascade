# Cascade 本地工作纪要

> 本文档仅用于本地记录本轮对话内完成的工作，不作为发布说明，也不需要上传。

## 背景

本轮工作主要围绕 Cascade 的 agent 能力、session 稳定性、前端恢复体验、工具体系、模型分工和上线部署准备展开。目标不是一次性重写系统，而是在现有 `manager -> build/editor -> review -> memory` 工作流上逐步补强稳定性、可观测性和可维护性。

## Agent 与模型分工

- 研究并落地了角色优先的 agent 架构方向：`manager / explorer / editor / fixer / verifier / research / communicator / memory` 分工更清晰。
- 引入或接入了统一运行契约思路：`AgentRunSpec`、`ContextPacket`、`RuntimePolicy`、`ToolPolicy` 等概念，用来收口上下文、模型策略和工具权限。
- 针对 GLM-5.2 做了适配研究和策略调整：
  - 首轮、复杂编辑、工具错误恢复时允许更强 thinking。
  - 机械写入、连续成功、简单验证时降低 thinking，避免推理 token 拖慢或截断。
  - 前 20 轮允许探索，20 轮后若仍只有读/搜行为，再注入更明确的编辑催促。
- 研究了模型路由策略：
  - 默认 `role_first`，按角色选择更合适的模型。
  - 保留 `user_first` 兼容模式，用户选择仍作为偏好和 fallback。
- 讨论并实现了 explorer 前置摘要，减少 editor 重复全局 grep/read_file 的倾向。

## Agent Toolkit

- 检查并补强了 agent 可用工具组，目标是覆盖大多数应用开发场景。
- 统一封装工具定义，按角色分配工具权限。
- 工具能力覆盖包括：
  - 文件读取：`read_file`、`read_many_files`、`read_file_range`、`file_info`
  - 搜索：`grep`、AST/LSP 查询
  - 文件修改：`write_file`、`edit_file`、`patch_file`、`hash_patch_file`、`move_file`、`delete_file`
  - 外部信息：`mcp_search`、`fetch_url`、research 工具
  - 验证：`shell_run`、`run_tests`
  - 控制与记忆：step 完成、build 完成、`update_project_memory`
- 强化了工具 metadata：
  - `allowedRoles`
  - `mutatesFiles`
  - `safeToParallelize`
  - `category`
  - `resultCompaction`
- 约束 mutating 工具串行或 per-file lock，read-only 工具允许保守并行。

## Todo / Plan / Ledger

- 研究并推进后端权威 `TodoLedger`，避免前端仅靠事件流推断 plan 状态。
- 目标状态：
  - 每个 step 有稳定的 `stepId/status/title/requiredFiles/touchedFiles/summary/error`。
  - `all_complete` 只能在 ledger 全部完成后发出。
  - build 未完成前不展示最终耗时、token、cost、checkpoint。
- 修过 agent 不调用 step 完成工具导致 build 失败的问题，增加后端兜底和 ledger consistency 检查。
- 针对“新 build 破坏上一个 plan 状态”的问题，检查并修复了历史 plan card 与 live 状态污染的边界。

## Session 存储与恢复

- 深入检查了 session 生命周期和存储链路，重点问题包括：
  - 切项目/切会话导致运行中 session 被 abort。
  - 硬刷新后 action log 堆叠、step 结构丢失。
  - 最终 plan/buildResult 过度依赖前端上传。
  - 多 chat session / 多 agent run 身份边界不够硬。
- 推进统一 session identity：
  - `userId`
  - `projectId`
  - `chatSessionId`
  - `agentSessionId`
  - `runType`
  - `runGroupId`
  - `stepId`
  - `toolCallId`
- 后端 session 持久化方向：
  - `agent_sessions` 保存当前 snapshot、ledger、final artifact。
  - `agent_session_events` 做 append-only replay。
  - snapshot 与事件分离，避免大 JSON 覆盖导致丢事件。
- 强化了硬刷新恢复：
  - 前端 localStorage 只作为启动缓存。
  - 后端 snapshot / ledger / action log 为权威。
  - 事件恢复必须校验 project/chat/session 身份，避免串台。
- 检查并修过 DB 短暂断连导致 final files、build result、memory distill、session flush 失败的问题，增加 transient DB retry/降级。

## Project Memory

- 研究了 agent 容易忘记旧功能、覆写旧代码的问题。
- 设计了三层记忆：
  - `Round Summary`：每轮 build 完成立即生成，下一轮 manager/editor 立刻可见。
  - `Project Memory`：长期记忆，记录已实现行为、文件归属、约定、踩坑、风险和 TODO。
  - `Session Scratchpad`：当前 build 内临时发现，避免污染长期记忆。
- 强调每次 build 结束后提醒/要求 agent 调用项目记忆工具，写入 `cascade.md` 或项目记忆存储。
- 检查了 plan 与 build 过程中 project memory 的读写和 prompt 注入，确保 follow-up 修改能保留既有行为。

## 前端体验与恢复

- 检查并修复了 action log 在强制刷新后堆叠、失去 step 结构的问题。
- 加强了 action log normalize，目标是 malformed payload 不让聊天面板崩溃。
- 针对“聊天面板出现错误”检查了 PlanCard / BuildLivePanel 的数据兼容性。
- 调整了 LiveBar：
  - 只出现在 PlanCard 下方可展开的 ActionLog 部分。
  - 哪个 step 正在执行，就在对应 step 的 action log 内展示动效。
  - 去掉外层线条方框，保留动效本体。
  - 提高稳定性，避免执行中随机消失。
- 实现/检查了文件手动浏览和编辑能力。
- 检查了前端工具 action 展示，要求新增工具也有图标、文字和一致的视觉效果。

## 并行与性能

- 研究了并行优化，但采用保守策略：
  - agent 内 read-only 工具可并行。
  - mutating 工具、shell、memory update、control tool 默认串行。
  - build step wave 并行继续灰度，只有 required files 不相交、无共享入口、无隐式依赖时才可并行。
- 增加或规划 telemetry：
  - time-to-first-edit
  - discovery-only rounds
  - thinking mode counts
  - model route decision
  - memory update latency
  - ledger completion consistency
  - tool category counts

## 轮次和卡死问题

- 发现旧逻辑在迭代到 40 轮时会杀死进程。
- 将复杂任务轮次上限方向调整到 200，但也检查到某些路径仍有 `maxIterations=60` 的预算限制，需要继续留意具体 role/runtime policy 是否完全接入。
- 针对 agent 大量 grep/read_file、迟迟不编辑的问题，研究并加入 discovery stall 策略：
  - 前 20 轮不强催。
  - 20 轮后连续只读才提醒进入编辑。
- 检查 shell_run 卡住、PayloadTooLarge、telemetry circular JSON 等运行日志问题。

## 数据库与部署准备

- 检查了当前数据库 schema：
  - `users`
  - `projects`
  - `project_files`
  - `chat_sessions`
  - `chat_messages`
  - `agent_sessions`
  - `agent_session_events`
  - `manager_sessions`
  - `session`
  - `user_skills`
  - `project_skills`
  - `waitlist_subscribers`
  - `invite_codes`
  - `otp_codes`
  - `subscription_grants`
  - `user_feedback`
  - `notifications`
  - `changelog_entries`
  - `published_apps`
  - `app_likes`
  - `app_comments`
  - `project_videos`
  - `admin_users`
  - `admin_audit_log`
- 更新/撰写了部署相关文档：
  - `docs/database-deployment.md`
  - `docs/server-deployment.md`
- 新增/整理了服务器部署脚本：
  - `scripts/deploy/server.mjs`
  - `npm run deploy:server`
  - `npm run deploy:preflight`
- 更新了 `scripts/db/verify.mjs`，让它检查当前完整 schema 和关键索引。
- 补充了 `.env.example` 的生产变量，包括：
  - `SESSION_SECRET`
  - `ADMIN_JWT_SECRET`
  - `ADMIN_TOTP_ENCRYPTION_KEY`
  - agent 并发/telemetry/video 相关变量
- 注意到生产里 `ENABLE_SHELL` 代码读取的是 `"true"`，不是 `"1"`，已在 env 样例中修正说明。

## 已知验证结果

- `node --check scripts/deploy/server.mjs` 通过。
- `node --check scripts/db/verify.mjs` 通过。
- `npm run deploy:server -- --dry-run --skip-install --skip-build --skip-db` 能正确拦截本地缺少生产 `SESSION_SECRET` 的情况。
- `npm run check` 仍有既有 TypeScript 问题，主要包括：
  - `backend/api/src/api/routes/auth.ts` 中 email/sms 窄类型比较。
  - `backend/api/src/worker-entry.ts` 缺 Cloudflare adapter 类型，以及 `infra/index` 无 default export。
  - `frontend/web/src/lib/prism.ts` 的 Prism component 类型声明缺失。
  - `frontend/web/src/lib/themes.ts` 缺 `monaco-editor` 类型。

## 后续建议

- 继续追踪 `maxIterations=60` 的路径，确认所有 editor/build runtime policy 都使用新的预算。
- 给 session replay、ledger snapshot、action log normalize 增加更完整的集成测试。
- 将 project memory 的 Round Summary 注入做成强约束，减少 follow-up 覆写旧功能。
- 上线前先在 staging 数据库跑：
  - `npm run deploy:preflight`
  - `npm run deploy:server -- --dry-run --apply-schema`
  - `npm run deploy:server -- --apply-schema`
- 修掉既有 `npm run check` 类型问题，避免以后部署前无法用 TypeScript 作为质量门。
