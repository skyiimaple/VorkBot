# Vork 任务安全与恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为统一 Agent 任务增加安全暂停、恢复、取消、持久检查点、有限重试及副作用不确定处理，并在 Electron 对话页提供完整控制入口。

**Architecture:** PostgreSQL 是任务控制状态、追加式检查点和工具调用日志的唯一可信来源；API 负责原子状态转换及稳定 jobId 入队，Worker 只在原子动作边界响应控制并从最新检查点恢复。Electron 通过共享 Zod 契约读取控制状态并发出明确操作，不推断服务端状态，也不默认展示实时电脑画面。

**Tech Stack:** TypeScript 5.9、Zod、PostgreSQL、BullMQ/Redis、Fastify、Electron、React、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-29-vork-task-safety-recovery-design-zh-CN.md`

**实施状态（2026-09-29）：** 已完成。全量测试、类型检查、Electron 构建、4 条 E2E、迁移幂等和服务健康检查均通过；按用户要求保留为 `main` 上未提交修改。下方复选框保留为原始 TDD 执行记录，最终证据见中文交接文档。

## Global Constraints

- 直接在当前 `main` 工作区实施；保留现有未提交修改，禁止覆盖或回滚用户改动。
- 按用户要求不执行 `git commit`、`git push` 或创建 PR；每个任务只运行对应测试，全部完成后统一复核一次。
- 暂停只在模型或工具原子动作边界生效；不得中断正在执行的副作用动作。
- 副作用进入 `executing` 后结果不可确认时必须转 `uncertain`，禁止自动重放。
- 自动重试仅覆盖明确的临时错误，最多 3 次，延迟固定为 1 秒、2 秒、4 秒。
- 检查点 observation 最多 4000 字符，并在持久化前脱敏；事件不得包含 Secret、Cookie、完整命令输出或凭据。
- 统一 Agent 循环获得完整恢复能力；旧固定 demo 只维持现有取消和终态安全。
- 数据库迁移必须兼容已有本地数据；Renderer 不得直接访问数据库、Computer 地址或 token。
- 实时电脑画面继续默认隐藏，控制 UI 保持紧凑。

## 文件结构与职责

- `packages/contracts/src/task.ts`：任务状态、控制状态、检查点及控制请求的共享 Schema。
- `packages/contracts/src/agent.ts`：可持久化动作、工具调用、风险及 observation 契约。
- `packages/database/migrations/0003_task_recovery.sql`：兼容现有数据的任务恢复表结构。
- `packages/database/src/task-recovery-repository.ts`：检查点、工具调用和原子控制转换；避免继续膨胀通用 repository 文件。
- `apps/api/src/routes/task-controls.ts`：暂停、恢复、控制状态、不确定结果处理和 active-task HTTP 接口。
- `apps/api/src/services/task-publication.ts`：稳定 jobId 发布与发布失败收敛。
- `apps/worker/src/task-control.ts`：控制轮询、安全边界、取消 AbortSignal。
- `apps/worker/src/checkpoint.ts`：运行上下文序列化、恢复、截断与脱敏。
- `apps/worker/src/transient-retry.ts`：临时错误分类及 1/2/4 秒退避。
- `apps/worker/src/task-recovery.ts`：启动扫描和幂等重新入队。
- `apps/worker/src/tool-executor.ts`：工具调用 prepared/executing/result 生命周期。
- `apps/desktop/src/renderer/src/features/chat/TaskControlCard.tsx`：暂停、审批及 uncertain 的紧凑控制 UI。
- `apps/desktop/src/renderer/src/features/chat/useConversation.ts`：加载、订阅及操作控制状态。
- `tests/e2e/task-recovery.spec.ts`：两个用户可见恢复流程的真实应用验收。

---

### Task 1: 共享任务恢复契约

**Files:**
- Modify: `packages/contracts/src/task.ts`
- Modify: `packages/contracts/src/agent.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/task.test.ts`
- Test: `packages/contracts/src/agent.test.ts`

**Interfaces:**
- Consumes: 现有 `TaskSchema`、Agent action schema 与 ISO datetime 校验惯例。
- Produces: `TaskStatusSchema`、`CheckpointStateSchema`、`ToolCallSchema`、`TaskControlStateSchema`、`PauseTaskInputSchema`、`ResumeTaskInputSchema`、`UncertainResolutionInputSchema`，供数据库、API、Worker 和 Electron 共用。

- [ ] **Step 1: 先写失败的契约测试**

  在 `task.test.ts` 增加用例，断言 `paused`、`uncertain` 合法，任务必须包含 `pauseRequestedAt`、`retryCount`、`nextRetryAt`；控制状态允许审批或 uncertain 工具调用但不泄露正文。在 `agent.test.ts` 断言风险只允许 `safe | side_effect`，工具调用状态只允许 `prepared | executing | succeeded | failed | uncertain`，observation 上限为 4000 字符。

- [ ] **Step 2: 运行测试并确认先失败**

  Run: `pnpm --filter @vork/contracts test -- task.test.ts agent.test.ts`

  Expected: FAIL，提示新状态或新 Schema 尚未导出。

- [ ] **Step 3: 实现精确共享类型**

  `CheckpointStateSchema` 固定字段为：

  ```ts
  {
    nextTurn: z.number().int().nonnegative(),
    lastObservation: z.string().max(4000),
    reply: z.string(),
    modelTurns: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    lastCompletedToolCallId: z.string().uuid().nullable()
  }
  ```

  `UncertainResolutionInputSchema` 使用 `resolution: z.enum(["confirmed_success", "retry", "cancel"])`。`TaskControlStateSchema` 返回 `{ task, pendingApproval?, uncertainToolCall? }`；摘要只包含动作类型、风险原因、影响对象和公开 ID。

- [ ] **Step 4: 运行契约测试**

  Run: `pnpm --filter @vork/contracts test`

  Expected: PASS，现有契约消费者仍能编译。

---

### Task 2: 数据库迁移与原子恢复仓储

**Files:**
- Create: `packages/database/migrations/0003_task_recovery.sql`
- Create: `packages/database/src/task-recovery-repository.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/repositories.ts`
- Modify: `packages/database/src/index.ts`
- Test: `packages/database/src/task-recovery-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CheckpointState`、`ToolCall` 和状态类型；现有数据库事务、事件追加与用户隔离方式。
- Produces: `TaskRecoveryRepository`，至少提供 `requestPause(taskId,userId)`、`resumeTask(...)`、`saveCheckpoint(...)`、`getLatestCheckpoint(...)`、`prepareToolCall(...)`、`markToolExecuting(...)`、`finishToolCallAndCheckpoint(...)`、`markToolUncertain(...)`、`getControlState(...)`、`listRecoverableTasks()`。

- [ ] **Step 1: 写仓储失败测试**

  覆盖：运行任务请求暂停只设置时间；排队任务直接暂停；检查点 version 单调增加；工具成功、observation、检查点与 `tool.finished` 同事务提交；其他用户不可见；`side_effect + executing` 可被恢复扫描识别。

- [ ] **Step 2: 运行数据库测试确认失败**

  Run: `pnpm --filter @vork/database test -- task-recovery-repository.test.ts`

  Expected: FAIL，迁移、表及 repository 尚不存在。

- [ ] **Step 3: 添加兼容迁移**

  `0003_task_recovery.sql` 使用幂等 DDL：扩展 task status 约束，新增三个 task 字段；创建 `task_checkpoints` 和 `tool_calls`；建立 `(task_id, version)`、`(task_id, turn, attempt)` 唯一约束，以及恢复扫描需要的 task status/next_retry_at 与 tool status/risk 索引。旧行回填 `retry_count = 0`，不得删除已有记录。

- [ ] **Step 4: 实现原子仓储操作**

  所有状态转换以 `SELECT ... FOR UPDATE` 锁定任务并验证 userId 与合法来源状态；在同一事务写任务、事件、工具结果及检查点。提供稳定错误类别：not found、conflict、invalid checkpoint；禁止上层拼 SQL 或自行组合半事务操作。

- [ ] **Step 5: 执行迁移和数据库测试**

  Run: `pnpm --filter @vork/database migrate && pnpm --filter @vork/database test`

  Expected: PASS；再次运行 migrate 不报错，旧数据库数据仍可读取。

---

### Task 3: API 控制面与稳定任务发布

**Files:**
- Create: `apps/api/src/routes/task-controls.ts`
- Create: `apps/api/src/services/task-publication.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/task-events.ts`
- Modify: `apps/api/src/routes/tasks.ts`
- Test: `apps/api/src/routes/task-controls.test.ts`
- Test: `apps/api/src/services/task-publication.test.ts`

**Interfaces:**
- Consumes: Task 2 的原子仓储；现有 `TaskQueue.publish()` 与认证上下文。
- Produces: 六个设计中约定的 HTTP 接口；`publishRecoverableTask(taskId): Promise<void>` 使用 `task:${taskId}:resume` 稳定 jobId。

- [ ] **Step 1: 写路由和发布失败测试**

  覆盖 queued/running pause、paused resume、非法状态 409、跨用户 404、active-task 空值、控制摘要脱敏，以及发布失败后任务以 `TASK_PUBLICATION_FAILED` 收敛。覆盖 uncertain 三种 resolution：确认成功、明确重试、取消。

- [ ] **Step 2: 运行 API 定向测试确认失败**

  Run: `pnpm --filter @vork/api test -- task-controls.test.ts task-publication.test.ts`

  Expected: FAIL，新路由未注册。

- [ ] **Step 3: 实现稳定发布服务**

  所有恢复入队都经 `publishRecoverableTask`；重复发布同一 taskId 不生成第二个有效 Job。数据库状态先提交，入队失败后用独立事务写稳定失败码及公开事件，HTTP 返回 500。

- [ ] **Step 4: 实现控制路由**

  添加：

  ```text
  POST /v1/tasks/:id/pause
  POST /v1/tasks/:id/resume
  GET  /v1/tasks/:id/control-state
  POST /v1/tasks/:id/uncertain-resolution
  GET  /v1/conversations/:id/active-task
  ```

  复用现有 cancel 和 approvals 路由，但把审批恢复统一切到稳定发布服务。所有输入用 Task 1 的 Zod Schema 解析。

- [ ] **Step 5: 运行 API 全量测试**

  Run: `pnpm --filter @vork/api test`

  Expected: PASS，现有消息、审批和取消接口行为不回退。

---

### Task 4: Worker 检查点、工具调用日志与安全控制边界

**Files:**
- Create: `apps/worker/src/checkpoint.ts`
- Create: `apps/worker/src/task-control.ts`
- Modify: `apps/worker/src/action-model.ts`
- Modify: `apps/worker/src/openai-compatible-model.ts`
- Modify: `apps/worker/src/fake-action-model.ts`
- Modify: `apps/worker/src/agent-loop.ts`
- Modify: `apps/worker/src/tool-executor.ts`
- Modify: `apps/worker/src/run-task.ts`
- Test: `apps/worker/src/checkpoint.test.ts`
- Test: `apps/worker/src/task-control.test.ts`
- Test: `apps/worker/src/agent-loop.test.ts`
- Test: `apps/worker/src/tool-executor.test.ts`
- Test: `apps/worker/src/fake-action-model.test.ts`

**Interfaces:**
- Consumes: `TaskRecoveryRepository`、现有 ComputerClient、policy 和 lease 生命周期。
- Produces: `loadAgentCheckpoint(taskId)`、`saveAgentCheckpoint(taskId,state)`、`honorTaskControl(taskId,boundary)`、支持 `signal?: AbortSignal` 的 `ActionModel.nextAction(ctx)`，以及持久化工具生命周期。

- [ ] **Step 1: 写失败测试覆盖不重复副作用**

  用注入式 fake repository/model/computer 覆盖：已成功的 `file.write` 或 `terminal.start` 恢复后不再调用；模型结束和工具完成边界响应 pause；取消会中止模型请求；副作用调用在响应丢失时变 `uncertain`；安全调用可交给后续重试层。

- [ ] **Step 2: 运行 Worker 定向测试确认失败**

  Run: `pnpm --filter @vork/worker test -- checkpoint.test.ts task-control.test.ts agent-loop.test.ts tool-executor.test.ts fake-action-model.test.ts`

  Expected: FAIL，当前运行上下文仍只在内存中，ActionModel 也不接收外部 signal。

- [ ] **Step 3: 实现检查点编码和脱敏**

  `saveAgentCheckpoint` 在 Schema 校验前将 observation 截断为 4000 字符，并遮盖 bearer token、常见 API key、Cookie/Set-Cookie 值与 Computer 标记的 sensitive 字段；校验失败写 `CHECKPOINT_INVALID`，不得继续运行。

- [ ] **Step 4: 实现控制监视器与模型取消**

  模型调用期间每 500ms 查询任务控制状态；cancel 触发 AbortController，pause 只记录并等模型返回。`honorTaskControl` 只在模型返回、策略判断前、工具结果持久化后和回复分块之间调用；paused/cancelled 都释放 Agent slot 和 Terminal lease。

- [ ] **Step 5: 重构工具执行顺序**

  所有工具严格执行 `prepared -> executing -> Computer -> succeeded/failed/uncertain`。成功路径必须调用 Task 2 的原子 `finishToolCallAndCheckpoint`；副作用进入 executing 后遇到连接中断必须调用 `markToolUncertain` 并停止 Agent 循环。

- [ ] **Step 6: 让 Agent 循环从检查点继续**

  初始化 `turn/reply/lastObservation/modelTurns/toolCalls/lastCompletedToolCallId` 时先读取最新检查点；每次模型动作、工具成功、审批解决及暂停落地后追加版本。FakeActionModel 仅依据 `ctx.turn` 和 observation 选择动作，删除进程内游标。

- [ ] **Step 7: 运行 Worker 定向和全量测试**

  Run: `pnpm --filter @vork/worker test`

  Expected: PASS；同一个已成功副作用在恢复测试中 Computer 调用次数严格为 1。

---

### Task 5: 有限重试与 Worker 启动恢复

**Files:**
- Create: `apps/worker/src/transient-retry.ts`
- Create: `apps/worker/src/task-recovery.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/worker/src/openai-compatible-model.ts`
- Test: `apps/worker/src/transient-retry.test.ts`
- Test: `apps/worker/src/task-recovery.test.ts`
- Test: `apps/worker/src/openai-compatible-model.test.ts`

**Interfaces:**
- Consumes: Task 2 的恢复扫描、Task 3 的稳定 jobId 规则、Task 4 的工具风险和 AbortSignal。
- Produces: `classifyTransientFailure(error, phase, risk)`、`runWithTransientRetry(operation, options)`、`recoverTasksOnStartup(queue, repository)`。

- [ ] **Step 1: 用 fake timers 写失败测试**

  精确断言延迟 `[1000, 2000, 4000]`、最多三次重试；模型 429/5xx 和安全工具连接失败可重试；4xx、策略拒绝、预算超限和 executing 副作用不可重试。恢复扫描重复执行两次仍只发布一个稳定 jobId。

- [ ] **Step 2: 运行恢复测试确认失败**

  Run: `pnpm --filter @vork/worker test -- transient-retry.test.ts task-recovery.test.ts openai-compatible-model.test.ts`

  Expected: FAIL，新分类器和扫描器不存在。

- [ ] **Step 3: 实现有限重试**

  每次等待前原子增加 `retryCount`、设置 `nextRetryAt`、写 `task.retry_scheduled`；成功后清空 `nextRetryAt` 但保留累计计数；三次耗尽后使用 `TRANSIENT_RETRY_EXHAUSTED`。等待使用可注入 scheduler，使单元测试不真实 sleep。

- [ ] **Step 4: 实现启动恢复扫描**

  `queued` 和安全可恢复的旧 `running` 以稳定 jobId 入队；`side_effect + executing` 原子转 `uncertain`；`paused/waiting_approval/uncertain` 保持不动。Worker 开始消费前先完成一次扫描，扫描失败应明确报错而不是静默跳过。

- [ ] **Step 5: 运行 Worker 全量测试**

  Run: `pnpm --filter @vork/worker test`

  Expected: PASS，槽位忙现有 5 秒/60 次策略保持不变。

---

### Task 6: Electron IPC 控制 API

**Files:**
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/main/api.ts`
- Modify: `apps/desktop/src/renderer/src/types/vork-api.d.ts`
- Modify: `apps/desktop/src/renderer/src/test/fake-vork-api.ts`
- Test: `apps/desktop/src/main/api.test.ts`
- Test: `apps/desktop/src/preload/api.test.ts`

**Interfaces:**
- Consumes: Task 1 共享 Schema 和 Task 3 HTTP 路由。
- Produces: Renderer 可调用的 `getActiveTask(conversationId)`、`getTaskControlState(taskId)`、`pauseTask(taskId)`、`resumeTask(taskId)`、`cancelTask(taskId)`、`resolveApproval(taskId,input)`、`resolveUncertain(taskId,resolution)`。

- [ ] **Step 1: 写失败 IPC 映射测试**

  断言每个方法使用正确 method/path/body，响应均经共享 Schema 验证；fake API 暴露相同签名。非法 uncertain resolution 必须在发 HTTP 前失败。

- [ ] **Step 2: 运行 Desktop API 测试确认失败**

  Run: `pnpm --filter @vork/desktop test -- api.test.ts`

  Expected: FAIL，新的桥接方法不存在。

- [ ] **Step 3: 实现 preload 与 main 映射**

  只暴露结构化对象，不暴露通用 fetch、数据库、Computer URL 或 token。保留现有 cancel/approval 调用兼容性，Renderer 所有返回值都经过 `TaskControlStateSchema` 或相应 response Schema。

- [ ] **Step 4: 运行 Desktop 定向测试**

  Run: `pnpm --filter @vork/desktop test -- api.test.ts`

  Expected: PASS。

---

### Task 7: Electron 对话任务控制 UI

**Files:**
- Create: `apps/desktop/src/renderer/src/features/chat/TaskControlCard.tsx`
- Create: `apps/desktop/src/renderer/src/features/chat/TaskControlCard.test.tsx`
- Modify: `apps/desktop/src/renderer/src/features/chat/useConversation.ts`
- Modify: `apps/desktop/src/renderer/src/features/chat/useConversation.test.tsx`
- Modify: `apps/desktop/src/renderer/src/features/chat/ConversationView.tsx`
- Modify: `apps/desktop/src/renderer/src/features/chat/ConversationView.test.tsx`
- Modify: `apps/desktop/src/renderer/src/styles.css`

**Interfaces:**
- Consumes: Task 6 的 `window.vork` 控制方法和 Task 1 的 `TaskControlState`。
- Produces: `TaskControlCard` 及 `useConversation` 的 `controlState/isControlPending/pause/resume/cancel/resolveApproval/resolveUncertain`。

- [ ] **Step 1: 写交互失败测试**

  覆盖：打开对话立即加载 active-task；running 显示暂停/取消；pauseRequestedAt 显示“正在暂停”；paused 显示恢复/取消；waiting_approval 显示批准/拒绝；uncertain 显示“已完成，继续”“未完成，重试”“取消任务”；操作中按钮禁用并避免双击。

- [ ] **Step 2: 运行 chat 测试确认失败**

  Run: `pnpm --filter @vork/desktop test -- TaskControlCard.test.tsx useConversation.test.tsx ConversationView.test.tsx`

  Expected: FAIL，当前 hook 不加载 active-task，也没有对应卡片。

- [ ] **Step 3: 扩展 useConversation 状态同步**

  初次加载消息后并行读取 active-task；收到 pause/resume/retry/checkpoint/uncertain/completed/failed/cancelled 事件后刷新 control-state。mutation 成功后以服务端返回为准更新；失败保留当前卡片并展示现有错误提示。

- [ ] **Step 4: 实现紧凑控制与卡片**

  标题栏只呈现与当前状态相关的图标/短文字；审批和 uncertain 使用聊天流内卡片，摘要只展示动作、风险原因和影响对象。不得把 Computer 画面、终端输出或检查点变成常驻区域。

- [ ] **Step 5: 运行 Desktop 全量测试**

  Run: `pnpm --filter @vork/desktop test`

  Expected: PASS，现有创建 Bot、消息、默认隐藏执行画面等 UI 行为保持不变。

---

### Task 8: 真实流程验收、文档与一次性总复核

**Files:**
- Create: `tests/e2e/task-recovery.spec.ts`
- Modify: `apps/worker/src/fake-action-model.ts`
- Modify: `tests/e2e/support/*`（使用该目录现有 fixture 的准确文件，不新建重复启动器）
- Modify: `README.zh-CN.md`
- Create: `docs/handovers/2026-09-29-vork-task-safety-recovery-status-zh-CN.md`
- Modify: `docs/superpowers/plans/2026-09-29-vork-task-safety-recovery.md`

**Interfaces:**
- Consumes: Tasks 1–7 的完整路径。
- Produces: 两条真实 Electron 验收、中文操作说明和可交接状态记录。

- [ ] **Step 1: 添加可控且仅用于本地验收的确定性场景**

  沿用现有方括号 fake-model marker 机制，增加 `[agent-pause]` 和 `[agent-uncertain]`。前者通过可注入模型门闩确保 UI 有时间在原子边界提出暂停；后者只在 fake model 模式构造一次“副作用结果未知”，恢复仍完全走生产 repository/API/UI 路径。真实 LLM 模式不得识别这些 marker。

- [ ] **Step 2: 写两个 E2E 测试并确认先失败**

  场景一：发送 `[agent-pause]`，点击暂停，观察“正在暂停”→“已暂停”，点击恢复并等最终回复。场景二：发送 `[agent-uncertain]`，看到不确定卡片，选择“未完成，重试”并完成；补充确认成功分支的组件/API 测试，确保不会重复执行。

  Run: `pnpm --filter @vork/e2e test -- task-recovery.spec.ts`

  Expected: FAIL，marker 或 UI 尚未完整连通。

- [ ] **Step 3: 完成 E2E fixture 与中文文档**

  README 说明暂停发生在动作边界、uncertain 三个选择的含义、服务重启后的恢复行为和本地 marker。交接文档列出已完成功能、未包含的 Routines/Skills/生产部署、验证命令、未提交文件及已知限制。

- [ ] **Step 4: 运行迁移、全量测试和构建**

  Run:

  ```bash
  pnpm --filter @vork/database migrate
  pnpm test
  pnpm typecheck
  pnpm --filter @vork/desktop build
  pnpm e2e
  pnpm healthcheck
  ```

  Expected: 全部退出码为 0；两个新 E2E 场景通过；API、Worker、Computer、数据库和 Redis health 均 ready。

- [ ] **Step 5: 做一次最终安全复核**

  检查数据库中 successful side-effect 每个 turn/attempt 仅一条；检查事件和 checkpoint 不含测试 token、Cookie 或完整终端输出；重启 Worker 两次不产生重复 Job；Electron 重开后恢复控制卡片；实时电脑画面仍默认隐藏。

- [ ] **Step 6: 更新计划和交接状态，不提交 Git**

  将完成项勾选，在中文交接文档记录准确测试数量和失败项（若有），运行 `git status --short` 仅用于列出改动。不得执行 commit、push 或 PR 操作。

## 完成定义

- 用户可以在 Electron 中暂停、恢复、取消、审批和处理 uncertain 任务。
- Worker 或应用重启后从最新可信检查点恢复，成功副作用不会被重复执行。
- 临时错误只按 1/2/4 秒有限重试；未知副作用绝不自动重放。
- 所有新 HTTP/IPC 输入和输出由共享 Zod Schema 校验。
- 全量测试、类型检查、Electron 构建、E2E 和 healthcheck 均通过。
- 中文 README、设计、计划和交接文档保持同步，所有代码仍为未提交状态。
