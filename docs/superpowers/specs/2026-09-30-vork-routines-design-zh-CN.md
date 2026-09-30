# Vork 定时任务（Routines）设计

日期：2026-09-30

## 1. 目标

为单用户本地版 Vork 增加可靠的定时任务能力。用户选择一个 Bot、填写任务提示词并配置单次或周期计划；到期后系统复用现有 Task、Agent、Computer、审批、暂停恢复和 uncertain 处理链路执行任务，并将每次结果写入该 Routine 固定的专属对话。

本切片只增加调度和管理能力，不新增第二套执行引擎。

## 2. 已确认的产品决策

- 每个 Routine 创建并固定绑定一个专属对话；所有运行结果追加到该对话。
- 支持单次执行、常用每天/每周周期和高级 Cron 表达式。
- 每个 Routine 保存 IANA 时区，默认 `Asia/Shanghai`，用户可修改。
- Vork 停机期间错过多个周期时，恢复后最多补执行一次，并记录错过次数。
- 同一 Routine 严格单实例。上一次关联 Task 尚未终结时，新周期直接记录 `skipped_overlap`，不排队也不并发。
- “立即运行”同样遵守单实例规则；存在活动 Task 时返回冲突。
- 删除采用软删除并保留专属对话、历史运行、Task 和事件。
- 暂停期间不累计补执行；重新启用时从当前时间计算下一次计划。

## 3. 范围

### 3.1 本次包含

- Routine 共享契约、数据库表、调度计算与原子抢占。
- Routine CRUD、启用/暂停、软删除、立即运行和执行历史 API。
- Worker 内轻量调度扫描器与启动恢复。
- Electron 管理页、创建/编辑表单、执行历史和打开专属对话。
- 调度任务复用现有队列、任务状态机和 Agent Runtime。
- 单元、数据库集成、API、Worker、Desktop 与 Electron E2E 验收。

### 3.2 本次不包含

- 系统通知、邮件、短信或 Webhook 推送。
- 多用户共享 Routine、权限委派或团队日历。
- Bot-to-Bot 委派。
- 生产监控平台、腾讯云部署和高可用调度集群。
- 自然语言自动推导复杂日历规则；第一版由结构化表单和 Cron 配置。
- 自动生成或自动启用 Skills。

## 4. 架构选择

PostgreSQL 是 Routine 定义、下一执行时间、抢占状态和运行历史的唯一可信来源。Worker 每 5 秒扫描到期记录，并通过数据库事务与行锁抢占。BullMQ 只传递已经创建的 Vork Task，不保存长期调度定义。

不使用 BullMQ Job Scheduler 作为真相源，避免编辑计划时维护数据库和 Redis 两份状态；不增加独立 Scheduler 容器，保持当前单服务器本地架构简单。

```text
Electron Routine 管理页
        -> API CRUD
        -> PostgreSQL routines

Worker scheduler 每 5 秒
        -> 原子抢占到期 Routine
        -> 检查专属对话活动 Task
             -> 有：routine_run = skipped_overlap
             -> 无：创建 message + task + routine_run
        -> BullMQ 发布现有 TaskJob
        -> 现有 Worker / Agent / Computer 执行
        -> Task 终态同步 routine_run
        -> 结果显示在固定专属对话
```

## 5. 共享契约

新增 `packages/contracts/src/routine.ts`，并从公共入口导出。

### 5.1 Routine

```ts
type RoutineTrigger =
  | { type: "once"; runAt: string }
  | { type: "cron"; expression: string };

type Routine = {
  id: string;
  userId: string;
  botId: string;
  conversationId: string;
  name: string;
  prompt: string;
  trigger: RoutineTrigger;
  timezone: string;
  status: "active" | "paused" | "completed" | "error" | "deleted";
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: RoutineRunStatus | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
```

“每天/每周”是 UI 预设，保存时统一转换为 Cron 表达式。`once` 成功抢占后进入 `completed`，不再产生 `nextRunAt`。

### 5.2 RoutineRun

```ts
type RoutineRunStatus =
  | "claimed"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "waiting_approval"
  | "paused"
  | "uncertain"
  | "skipped_overlap"
  | "publication_failed";

type RoutineRun = {
  id: string;
  routineId: string;
  userId: string;
  scheduledFor: string;
  claimedAt: string;
  taskId: string | null;
  status: RoutineRunStatus;
  missedCount: number;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};
```

所有字符串长度、日期格式和枚举由严格 Zod Schema 校验。Prompt 不进入普通调度事件 payload，避免日志复制用户正文。

## 6. 数据模型

新增迁移 `0004_routines.sql`。

### 6.1 routines

主要字段：

- `id/user_id/bot_id/conversation_id`
- `name/prompt`
- `trigger_type/cron_expression/run_at/timezone`
- `status/next_run_at/last_run_at/last_run_status`
- `version`
- `deleted_at/created_at/updated_at`

约束：

- `once` 必须有 `run_at` 且没有 `cron_expression`。
- `cron` 必须有 `cron_expression` 且没有 `run_at`。
- `conversation_id` 对一个 Routine 唯一且不可在编辑时替换。
- `(status, next_run_at)` 建立到期扫描索引。

### 6.2 routine_runs

主要字段：

- `id/routine_id/user_id/task_id`
- `scheduled_for/claimed_at`
- `status/missed_count/error_code`
- `created_at/updated_at`

使用 `(routine_id, scheduled_for)` 唯一约束保证重复扫描或多 Worker 不会为同一计划点创建多个 run。`task_id` 可空：重叠跳过或发布前失败不一定产生 Task。

### 6.3 原子仓储边界

新增聚焦的 `routine-repository.ts`：

- `createRoutineWithConversation(input)`：同事务创建专属对话和 Routine。
- `updateRoutine(input)`：锁定记录、校验版本并重新计算 `nextRunAt`。
- `setRoutineEnabled(id, enabled, now)`：暂停清空 `nextRunAt`；恢复从 `now` 计算。
- `softDeleteRoutine(id)`：状态设为 deleted，清空 `nextRunAt`。
- `claimDueRoutines(now, limit)`：使用 `FOR UPDATE SKIP LOCKED` 抢占。
- `createRoutineTask(runId)`：检查活动 Task，并原子创建 message、task 与首事件。
- `finishRoutineRunFromTask(taskId, status)`：同步可见终态。

所有操作校验服务端 userId；API 和 Worker 不自行拼接半事务流程。

## 7. 时间与调度语义

使用成熟、支持 IANA 时区的 Cron 解析库，不自行实现 Cron。第一版接受标准五段 Cron（分钟级），拒绝秒字段、`@daily` 等昵称，以及 `H`、`L`、`#`、`?` 等库扩展语法。

### 7.1 nextRunAt

- 保存和编辑时以 Routine 时区计算下一次 UTC 时间并持久化。
- Cron 表达式保持用户配置原文；所有比较使用 UTC。
- 无效 Cron、无效时区和过去的单次时间在 API 写库前拒绝。
- 夏令时跳跃或重复由解析库按所选 IANA 时区处理，并通过固定时钟测试覆盖。

### 7.2 错过执行

扫描发现 `nextRunAt` 早于当前时间时，计算从该计划点到当前时间之间的计划次数：

- 只创建一次 catch-up run，`scheduledFor` 使用原 `nextRunAt`。
- `missedCount` 记录额外错过的计划次数，不包含本次补执行。
- 计算出的新 `nextRunAt` 必须严格晚于当前时间。
- 为避免异常 Cron 导致无界循环，单次计算最多遍历 10,000 个计划点；超过时将 Routine 置为 `error` 并写稳定错误码 `ROUTINE_SCHEDULE_OVERFLOW`。

暂停期间 `nextRunAt = null`，因此不产生 missedCount。重新启用时直接从当前时间计算未来计划。

### 7.3 单实例与活动状态

下列 Task 状态都视为活动：`queued`、`running`、`waiting_approval`、`paused`、`uncertain`。若专属对话存在活动 Task，计划触发创建 `skipped_overlap` run，不创建 message 或 task。

手动“立即运行”使用当前时间作为 `scheduledFor`，以独立幂等键创建 run；存在活动 Task 时返回 HTTP 409，并同时记录一次 `skipped_overlap`，让历史完整反映用户操作。

## 8. Worker 调度器

Worker 启动顺序：

1. 建立数据库与 Redis 连接。
2. 执行现有 Task 恢复扫描。
3. 立即执行一次 Routine 到期扫描。
4. 启动 Task Worker。
5. 启动 5 秒 Routine 扫描定时器和 Worker heartbeat。

调度器每批最多处理 50 个 Routine。一次扫描失败写结构化日志并保留后续扫描；不得导致现有 Task Worker 退出。正常关机先停止扫描器，再关闭 Task Worker、队列和连接。

发布使用 BullMQ 兼容的稳定 job ID `routine-run-{runId}`（BullMQ 不允许自定义 jobId 包含冒号）。数据库已经创建 Task 但 BullMQ 发布失败时，run 进入 `publication_failed`，Task 使用 `TASK_PUBLICATION_FAILED` 收敛；后续恢复扫描可以依据 run/task ID 幂等重新发布或明确失败，不创建第二个 Task。

Task 状态变化通过现有 repository 的终态操作同步 `routine_runs`。审批、暂停和 uncertain 属于 Task 自身控制状态；Routine 运行历史展示关联 Task 当前状态，不复制工具日志。

## 9. API

新增：

```text
GET    /v1/routines
POST   /v1/routines
GET    /v1/routines/:id
PUT    /v1/routines/:id
DELETE /v1/routines/:id
POST   /v1/routines/:id/enable
POST   /v1/routines/:id/pause
POST   /v1/routines/:id/run-now
GET    /v1/routines/:id/runs?cursor=&limit=
```

创建返回 Routine 和专属 conversationId。列表默认不返回 deleted。运行历史按 `createdAt DESC, id DESC` 游标分页。

稳定错误码：

- `ROUTINE_NOT_FOUND`
- `ROUTINE_CONFLICT`
- `ROUTINE_INVALID_CRON`
- `ROUTINE_INVALID_TIMEZONE`
- `ROUTINE_ONCE_IN_PAST`
- `ROUTINE_BOT_UNAVAILABLE`
- `ROUTINE_ACTIVE_TASK`
- `ROUTINE_PUBLICATION_FAILED`

跨用户访问统一返回 404。Renderer 不传 userId，不访问数据库、Redis 或 Computer。

## 10. Electron

在管理导航增加“定时任务”，路由为 `/routines`。

### 10.1 列表

每项显示：名称、Bot 名称、计划摘要、启用状态、下次执行时间和最近结果。操作包含：

- 启用或暂停
- 立即运行
- 编辑
- 删除
- 打开专属对话

操作中按钮禁用，避免重复提交。空状态提供“创建定时任务”。实时电脑画面和工具日志不在该页常驻显示。

### 10.2 创建与编辑

结构化表单包含：

- 名称
- Bot
- 任务提示词
- 触发类型：单次、每天、每周、高级 Cron
- 对应日期时间或常用周期字段
- 时区，默认 `Asia/Shanghai`

表单在客户端提供即时提示，但服务端 Zod 和调度计算仍是最终校验。编辑不改变专属对话。

### 10.3 历史与对话

详情展示最近运行时间、计划时间、missedCount、状态和公开错误码。有关联 Task 时可打开专属对话，使用现有 Conversation 页面查看任务控制卡片和最终回复。对话标题显示 Routine 来源标识，但行为与普通对话一致。

## 11. 错误处理

- Bot 不存在或已不可用：Routine 进入 `error`，清空 `nextRunAt`，记录 `ROUTINE_BOT_UNAVAILABLE`。
- 单次 Routine 被成功抢占后进入 `completed`；即使关联 Task 后续失败，也不自动重跑单次计划。
- Task 失败、取消或发布失败只影响本次 RoutineRun；周期 Routine 仍保留下一个未来计划。
- Routine 编辑使用版本号进行乐观并发控制；版本过期返回 409。
- 软删除只停止未来调度，不取消已创建 Task，也不删除对话和历史。
- API 或 Electron 断线不影响 Scheduler 与已创建 Task。
- Routine prompt、模型输出、Secret、Cookie 和完整工具输出不得复制到 Routine 调度事件或运行错误字段。

## 12. 测试与验收

### 12.1 单元与集成

- Contracts：严格解析触发器、Routine、RoutineRun、分页和请求响应。
- Schedule：单次、每天、每周、Cron、IANA 时区、夏令时、过去时间和溢出保护。
- Database：创建专属对话、更新版本、暂停/恢复、软删除、并发抢占、唯一 run、跨用户隔离。
- API：CRUD、非法 Cron/时区、立即运行冲突、执行历史和跨用户 404。
- Worker：正常触发、只补一次、missedCount、重叠跳过、重复扫描幂等、发布失败、连续启动扫描不重复。
- Desktop：IPC 映射、表单校验、列表操作禁用、历史和打开专属对话。

### 12.2 E2E

使用测试专用短周期或可控时钟创建 Routine：

1. 在 Electron 创建 Routine。
2. 等待自动触发并完成。
3. 确认结果进入固定 conversationId。
4. 立即运行第二次并确认仍进入同一对话。
5. 暂停 Routine，跨过计划时间后确认不触发。
6. 恢复后确认只从当前时间计算下一次。

端到端测试不得依赖互联网或真实模型，使用确定性 FakeModel。

## 13. 完成标准

- 用户能在 Electron 创建、编辑、暂停、恢复、立即运行和软删除 Routine。
- 单次、常用周期、五段 Cron 和可选 IANA 时区工作正常。
- 每个 Routine 始终使用同一个专属对话。
- 重启后最多补执行一次，并准确记录 missedCount。
- 同一 Routine 不产生并发 Task；重叠触发留下可查看的跳过记录。
- 多次扫描、Worker 重启和并发抢占不产生重复 run/task。
- Routine 任务完整继承现有审批、暂停恢复、重试和 uncertain 能力。
- 全量测试、类型检查、Electron 构建、E2E 和健康检查通过。
- 中文 README、设计、实施计划和交接文档同步更新。
