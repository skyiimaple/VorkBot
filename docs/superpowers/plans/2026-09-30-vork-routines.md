# Vork 定时任务（Routines）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有单用户 Vork 中增加可靠的单次/Cron 定时任务、固定专属对话、重启补偿、单实例跳过、运行历史和 Electron 管理界面。

**Architecture:** PostgreSQL 保存 Routine 定义、下一执行时间与运行历史，是唯一调度真相源；现有 Worker 每 5 秒原子扫描并抢占到期项，再用稳定 jobId 发布现有 TaskJob。Routine 不建立第二套执行引擎，关联 Task 完整复用已有 Agent、Computer、审批、暂停恢复、重试和 uncertain 状态机。

**Tech Stack:** TypeScript 5.9、Zod 3、PostgreSQL 17、Drizzle/Postgres.js、BullMQ 6、Fastify 5、Electron 44、React 19、TanStack Router/Query、Vitest 3、Playwright、`cron-parser` 5.10.1。

**Spec:** `docs/superpowers/specs/2026-09-30-vork-routines-design-zh-CN.md`

## Global Constraints

- 直接在当前 `main` 工作区实施并保留已有未提交改动；按用户要求不执行 `git commit`、`git push` 或创建 PR。
- 每个 Routine 永久绑定一个专属 conversation；编辑、暂停、恢复和软删除不得替换或删除该 conversation。
- PostgreSQL 是长期调度唯一可信来源；Redis/BullMQ 不保存 Routine 定义。
- Scheduler 扫描间隔固定 5 秒，每批最多 50 个，发布 jobId 固定为 BullMQ 兼容的 `routine-run-{runId}`。
- 同一 Routine 严格单实例；活动 Task 状态为 `queued|running|waiting_approval|paused|uncertain`。
- 停机错过多个周期最多补一次；`missedCount` 记录额外错过次数；暂停期间不累计。
- Cron 仅接受标准五段表达式；每项保存 IANA 时区，默认 `Asia/Shanghai`。
- 使用 `cron-parser@^5.10.1`，每次计算重新 parse 并传入 `tz/currentDate`，不得依赖会改变时区上下文的 iterator reset。
- Routine prompt、模型输出、Secret、Cookie 和完整工具输出不得复制到调度事件或公开错误字段。
- 实时电脑画面继续默认隐藏；Routine 管理页不常驻展示工具日志。
- 所有功能测试先行；每个任务完成后只运行定向测试，Task 8 统一执行一次全量复核。

## 文件结构与职责

- `packages/contracts/src/routine.ts`：Routine、RoutineRun、CRUD、分页及稳定错误响应 Schema。
- `packages/database/src/routine-schedule.ts`：单次/Cron、IANA 时区、missedCount 与溢出保护的纯计算。
- `packages/database/src/routine-repository.ts`：Routine CRUD、专属对话、原子到期抢占、重叠跳过和 run/task 创建。
- `packages/database/migrations/0004_routines.sql`：`routines`、`routine_runs`、索引、约束及 Task 状态同步触发器。
- `apps/api/src/routes/routines.ts`：Routine HTTP 管理面。
- `apps/api/src/services/routine-publication.ts`：手动运行与 Scheduler 共用的稳定发布和失败收敛。
- `apps/worker/src/routine-scheduler.ts`：启动扫描、5 秒周期扫描、停止和发布。
- `apps/desktop/src/renderer/src/features/routines/*`：列表、表单、历史和交互状态。
- `tests/e2e/routines.spec.ts`：真实 Electron 自动触发与固定对话验收。

---

### Task 1: Routine 共享契约与调度时间计算

**Files:**
- Create: `packages/contracts/src/routine.ts`
- Create: `packages/contracts/src/routine.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/database/src/routine-schedule.ts`
- Create: `packages/database/src/routine-schedule.test.ts`
- Modify: `packages/database/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `RoutineTriggerSchema`、`RoutineSchema`、`RoutineRunSchema`、`CreateRoutineInputSchema`、`UpdateRoutineInputSchema`、`ListRoutinesResponseSchema`、`ListRoutineRunsResponseSchema`。
- Produces: `calculateNextRun(trigger, timezone, now)` 和 `advanceDueSchedule(trigger, timezone, scheduledFor, now)`。

- [x] **Step 1: 写契约失败测试**

  在 `routine.test.ts` 精确覆盖以下形状：

  ```ts
  const once = { type: "once", runAt: "2026-10-01T01:00:00.000Z" };
  const cron = { type: "cron", expression: "0 9 * * 1-5" };
  expect(RoutineTriggerSchema.parse(once)).toEqual(once);
  expect(RoutineTriggerSchema.parse(cron)).toEqual(cron);
  expect(RoutineTriggerSchema.safeParse({ type: "cron", expression: "0 0 9 * * *" }).success).toBe(false);
  expect(CreateRoutineInputSchema.safeParse({
    name: "晨报", botId: "bot_1", prompt: "生成今天的晨报", trigger: cron, timezone: "Asia/Shanghai"
  }).success).toBe(true);
  ```

  同时断言未知字段被拒绝、name/prompt 非空、`missedCount` 非负、run 状态只允许规格枚举、分页 limit 为 1–100。

- [x] **Step 2: 运行契约测试并确认失败**

  Run: `pnpm --filter @vork/contracts exec vitest run src/routine.test.ts`

  Expected: FAIL，提示 `routine.ts` 或导出不存在。

- [x] **Step 3: 实现严格 Zod 契约**

  `RoutineTriggerSchema` 使用 discriminated union；Cron 字符串先做 `trim().min(1).max(255)`，五段语义由数据库包的调度计算验证。请求 Schema 不接受 `userId/conversationId/status/nextRunAt` 等服务端字段。更新请求必须包含 `version: positive int`。

- [x] **Step 4: 运行契约测试**

  Run: `pnpm --filter @vork/contracts test`

  Expected: PASS。

- [x] **Step 5: 安装唯一新增依赖并写调度失败测试**

  Run: `pnpm --filter @vork/database add cron-parser@^5.10.1`

  在 `routine-schedule.test.ts` 使用固定 UTC 时钟覆盖：

  ```ts
  expect(calculateNextRun(
    { type: "cron", expression: "0 9 * * *" },
    "Asia/Shanghai",
    new Date("2026-09-30T00:30:00.000Z")
  )).toBe("2026-09-30T01:00:00.000Z");

  expect(advanceDueSchedule(
    { type: "cron", expression: "0 * * * *" },
    "Asia/Shanghai",
    new Date("2026-09-30T01:00:00.000Z"),
    new Date("2026-09-30T04:30:00.000Z")
  )).toEqual({ nextRunAt: "2026-09-30T05:00:00.000Z", missedCount: 3 });
  ```

  另覆盖过去的 once、六段 Cron、无效 IANA 时区、DST 前后和 10,000 次溢出。

- [x] **Step 6: 运行调度测试并确认失败**

  Run: `pnpm --filter @vork/database exec vitest run src/routine-schedule.test.ts`

  Expected: FAIL，调度函数不存在。

- [x] **Step 7: 实现纯调度计算**

  先用 `Intl.DateTimeFormat(undefined, { timeZone })` 验证时区。Cron 必须先以空白切分并断言正好五段，并拒绝 `@`、`H`、`L`、`#`、`?` 扩展，再调用（`cron-parser` 的 strict 模式强制六段，因此这里不得启用）：

  ```ts
  CronExpressionParser.parse(expression, {
    currentDate: now,
    tz: timezone
  }).next().toDate();
  ```

  每次推进重新 parse，最多迭代 10,000 次；抛出稳定的 `RoutineScheduleError`，code 只允许 `ROUTINE_INVALID_CRON|ROUTINE_INVALID_TIMEZONE|ROUTINE_ONCE_IN_PAST|ROUTINE_SCHEDULE_OVERFLOW`。

- [x] **Step 8: 运行 Task 1 全部测试**

  Run: `pnpm --filter @vork/contracts test`

  Run: `VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test pnpm --filter @vork/database exec vitest run src/routine-schedule.test.ts`

  Expected: 全部 PASS。

---

### Task 2: 数据库迁移与 Routine 原子仓储

**Files:**
- Create: `packages/database/migrations/0004_routines.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/src/routine-repository.ts`
- Create: `packages/database/src/routine-repository.test.ts`
- Modify: `packages/database/src/repositories.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/test-support/src/database.ts`

**Interfaces:**
- Consumes: Task 1 契约和调度函数。
- Produces: `createRoutineWithConversation`、`listRoutines`、`getRoutine`、`updateRoutine`、`setRoutineEnabled`、`softDeleteRoutine`、`claimDueRoutineRuns`、`runRoutineNow`、`markRoutinePublicationFailed`、`listRoutineRuns`。

- [x] **Step 1: 写仓储失败测试**

  覆盖：

  ```ts
  const created = await repos.createRoutineWithConversation({
    userId: "user_local",
    botId: bot.id,
    name: "晨报",
    prompt: "生成晨报",
    trigger: { type: "cron", expression: "0 9 * * *" },
    timezone: "Asia/Shanghai",
    now: "2026-09-30T00:00:00.000Z"
  });
  expect(created.routine.conversationId).toBe(created.conversation.id);
  expect(created.routine.nextRunAt).toBe("2026-09-30T01:00:00.000Z");
  ```

  继续覆盖版本冲突、跨用户不可见、暂停清空 nextRunAt、恢复从 now 计算、软删除保留 conversation、到期抢占、重复抢占幂等、活动 task 产生 `skipped_overlap`、错过只建一次且 missedCount 正确、立即运行冲突。

- [x] **Step 2: 运行仓储测试并确认失败**

  Run: `VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test pnpm --filter @vork/database exec vitest run src/routine-repository.test.ts`

  Expected: FAIL，迁移或 repository 不存在。

- [x] **Step 3: 添加兼容迁移**

  `0004_routines.sql` 创建两表、外键、check/unique/index。必须包含：

  ```sql
  CREATE UNIQUE INDEX routine_runs_schedule_unique
    ON routine_runs (routine_id, scheduled_for);

  CREATE INDEX routines_due_idx
    ON routines (next_run_at, id)
    WHERE status = 'active' AND deleted_at IS NULL;
  ```

  增加 `AFTER UPDATE OF status ON tasks` 触发器，将有关联 `task_id` 的 run 同步为 task 当前公开状态；触发器不得修改 Routine 的下一个计划。

- [x] **Step 4: 实现独立 Routine repository**

  `claimDueRoutineRuns(now, limit)` 必须使用 `FOR UPDATE SKIP LOCKED`。对每个锁定 Routine 在同一事务中：

  1. 计算 missedCount 和未来 nextRunAt。
  2. 插入唯一 RoutineRun。
  3. 查询专属 conversation 是否有活动 Task。
  4. 有活动项则把 run 写成 `skipped_overlap`。
  5. 无活动项则创建 user message、queued task、`task.queued` 事件，将 task_id 绑定 run。
  6. 更新 Routine 的 lastRunAt/lastRunStatus/version/nextRunAt。

  返回：

  ```ts
  type RoutineDispatch = {
    run: RoutineRun;
    taskJob: TaskJob | null;
  };
  ```

  `runRoutineNow` 复用同一内部事务函数，但 nextRunAt 不变；活动 Task 时仍创建 `skipped_overlap` run，再抛出可映射到 409 的 `RoutineActiveTaskError`。

- [x] **Step 5: 更新 schema、repository 聚合与测试重置**

  将 Routine repository spread 进 `createRepositories()`；test-support 在基础迁移后应用 0004，并按外键顺序清空 `routine_runs`、`routines`。所有 row mapper 最终通过共享 Schema parse。

- [x] **Step 6: 执行迁移和数据库测试**

  Run: `DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork pnpm --filter @vork/database db:migrate`

  Run: `VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test pnpm --filter @vork/database test`

  Expected: 迁移和全部数据库测试 PASS；第二次 migrate 也退出 0。

---

### Task 3: Routine API 与稳定发布服务

**Files:**
- Create: `apps/api/src/services/routine-publication.ts`
- Create: `apps/api/src/services/routine-publication.test.ts`
- Create: `apps/api/src/routes/routines.ts`
- Create: `apps/api/src/routes/routines.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: Task 2 repository 和现有 `TaskQueue.publish(job, { jobId })`。
- Produces: 规格中的九个 HTTP 路由及 `publishRoutineDispatch(dispatch)`。

- [x] **Step 1: 写发布服务失败测试**

  断言有 `taskJob` 时调用：

  ```ts
  await queue.publish(dispatch.taskJob, { jobId: `routine-run-${dispatch.run.id}` });
  ```

  无 taskJob 的 skipped run 不发布；队列失败调用 `markRoutinePublicationFailed(run.id, "ROUTINE_PUBLICATION_FAILED")`，且不创建第二个 Task。

- [x] **Step 2: 写 API 失败测试**

  覆盖 CRUD、版本冲突、软删除、启用/暂停、立即运行、活动任务 409、历史游标分页、无效 Cron/时区/过去 once、跨用户 404。创建响应必须同时返回 routine 与 conversationId。

- [x] **Step 3: 运行 API 定向测试确认失败**

  Run: `VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test pnpm --filter @vork/api exec vitest run src/services/routine-publication.test.ts src/routes/routines.test.ts`

  Expected: FAIL，新服务和路由不存在。

- [x] **Step 4: 实现稳定发布服务**

  服务只接收 repository 产生的 dispatch，不自行创建 message/task。发布失败必须写稳定状态并返回可被路由映射的 typed error。

- [x] **Step 5: 实现并注册 Routine 路由**

  路由使用 request context 的 `userId`，所有 body/query/response 使用 Task 1 Schema。错误映射：not found→404，version/active task→409，schedule validation→400，publication→500。删除返回更新后的 `deleted` Routine，不删除对话。

- [x] **Step 6: 运行 API 全量测试**

  Run: `VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test pnpm --filter @vork/api test`

  Expected: PASS。

---

### Task 4: Worker Scheduler、重启补偿与优雅停止

**Files:**
- Create: `apps/worker/src/routine-scheduler.ts`
- Create: `apps/worker/src/routine-scheduler.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/queue.ts`

**Interfaces:**
- Consumes: `claimDueRoutineRuns(now, 50)`、`markRoutinePublicationFailed` 和 TaskQueue。
- Produces: `scanDueRoutines(deps, now)`、`startRoutineScheduler(deps, options)`，后者返回 `stop(): Promise<void>`。

- [x] **Step 1: 用 fake clock 写 Scheduler 失败测试**

  覆盖：启动立即扫描、默认 5 秒再次扫描、每批 limit 50、稳定 jobId、skipped 不发布、单次扫描异常不停止后续 tick、stop 后不再扫描、连续启动恢复不重复发布。

  示例：

  ```ts
  const stop = startRoutineScheduler(deps, { intervalMs: 5_000, now: () => clock.now() });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(repos.claimDueRoutineRuns).toHaveBeenCalledTimes(3); // immediate + 2 ticks
  await stop();
  ```

- [x] **Step 2: 运行 Worker 定向测试确认失败**

  Run: `pnpm --filter @vork/worker exec vitest run src/routine-scheduler.test.ts`

  Expected: FAIL，新模块不存在。

- [x] **Step 3: 实现一次扫描和周期控制器**

  `scanDueRoutines` 顺序发布 repository 返回的 dispatch；单个发布失败先收敛该 run，再继续处理本批其他项。周期控制器禁止 tick 重入：上次扫描未结束时本次 tick 直接跳过，不并发扫描。

- [x] **Step 4: 接入 Worker 启停生命周期**

  在现有 Task 恢复扫描后、Task Worker ready 前执行 Routine 首次扫描；Worker ready 后启动周期器。shutdown 顺序为：停止 Routine scheduler → heartbeat → task worker → queue/Redis/repository。

- [x] **Step 5: 运行 Worker 全量测试**

  Run: `VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test pnpm --filter @vork/worker test`

  Expected: PASS；现有恢复、Agent 和 Computer 测试不回退。

---

### Task 5: RoutineRun 与 Task 生命周期一致性

**Files:**
- Modify: `packages/database/migrations/0004_routines.sql`
- Modify: `packages/database/src/routine-repository.test.ts`
- Modify: `packages/database/src/task-recovery-repository.test.ts`
- Modify: `packages/database/src/repositories.integration.test.ts`

**Interfaces:**
- Consumes: 现有 Task 状态转换。
- Produces: 任意 Task 状态变化后可即时读取一致的 RoutineRun status。

- [x] **Step 1: 写跨状态失败测试**

  为 Routine 创建关联 Task，依次通过现有 repository 操作验证：

  ```text
  queued -> running -> waiting_approval -> paused -> queued -> uncertain
  completed | failed | cancelled
  ```

  每一步重新读取 run，状态必须与关联 Task 一致。普通非 Routine Task 不受影响。

- [x] **Step 2: 运行数据库定向测试确认失败或暴露缺口**

  Run: `VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test pnpm --filter @vork/database exec vitest run src/routine-repository.test.ts src/task-recovery-repository.test.ts src/repositories.integration.test.ts`

  Expected: 在所有状态同步完成前至少一个断言 FAIL。

- [x] **Step 3: 完成数据库触发器映射**

  触发器只更新 `routine_runs.status/updated_at`；task `waiting_approval|paused|uncertain|completed|failed|cancelled|running|queued` 直接同名映射。不得把 RoutineRun 反向写回 Task，避免循环依赖。

- [x] **Step 4: 运行数据库全量测试**

  Run: `VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test pnpm --filter @vork/database test`

  Expected: PASS。

---

### Task 6: Electron IPC Routine API

**Files:**
- Modify: `apps/desktop/src/preload/api.ts`
- Modify: `apps/desktop/src/main/api.ts`
- Modify: `apps/desktop/src/main/api.test.ts`
- Modify: `apps/desktop/src/preload/api.test.ts`
- Modify: `apps/desktop/src/renderer/src/test/fake-vork-api.ts`

**Interfaces:**
- Consumes: Task 1 共享 Schema 和 Task 3 HTTP API。
- Produces: Renderer 可调用的 `listRoutines/createRoutine/updateRoutine/deleteRoutine/enableRoutine/pauseRoutine/runRoutineNow/listRoutineRuns` request operations。

- [x] **Step 1: 写 IPC 映射失败测试**

  精确断言 method/path/body：例如 `runRoutineNow` 映射 `POST /v1/routines/:id/run-now`，`listRoutineRuns` 编码 cursor/limit。非法 trigger、timezone 空值和缺少 version 必须在 HTTP 前被 Schema 拒绝。

- [x] **Step 2: 运行 Desktop API 测试确认失败**

  Run: `pnpm --filter @vork/desktop exec vitest run src/main/api.test.ts src/preload/api.test.ts`

  Expected: FAIL，新 operation 不存在。

- [x] **Step 3: 实现白名单 IPC**

  扩展 discriminated request/response union 和 main HTTP switch；不得暴露通用 fetch、数据库、Redis、Computer URL 或 token。fake API 实现相同签名并持有内存 Routine/Run 数据。

- [x] **Step 4: 运行 Desktop API 测试**

  Run: `pnpm --filter @vork/desktop exec vitest run src/main/api.test.ts src/preload/api.test.ts`

  Expected: PASS。

---

### Task 7: Electron Routine 管理页

**Files:**
- Create: `apps/desktop/src/renderer/src/features/routines/RoutinesPage.tsx`
- Create: `apps/desktop/src/renderer/src/features/routines/RoutinesPage.test.tsx`
- Create: `apps/desktop/src/renderer/src/features/routines/RoutineForm.tsx`
- Create: `apps/desktop/src/renderer/src/features/routines/RoutineForm.test.tsx`
- Create: `apps/desktop/src/renderer/src/features/routines/RoutineRuns.tsx`
- Modify: `apps/desktop/src/renderer/src/routes/ManagePages.tsx`
- Modify: `apps/desktop/src/renderer/src/router.tsx`
- Modify: `apps/desktop/src/renderer/src/layouts/AppShell.tsx`

**Interfaces:**
- Consumes: Task 6 IPC operations。
- Produces: `/routines` 管理页、结构化创建/编辑、运行历史和打开固定 conversation。

- [x] **Step 1: 写表单失败测试**

  覆盖单次、每天、每周、高级 Cron 四种 UI；每天/每周必须转换为五段 Cron。默认时区为 `Asia/Shanghai`。提交中禁用按钮；服务端 validation error 保留表单输入并显示中文错误。

- [x] **Step 2: 写列表交互失败测试**

  覆盖加载空状态、创建后出现列表、暂停/启用、立即运行、活动任务冲突、软删除、运行历史、点击“打开对话”导航到 `/c/$conversationId`。列表断言电脑画面容器不存在。

- [x] **Step 3: 运行 Routine UI 测试确认失败**

  Run: `pnpm --filter @vork/desktop exec vitest run src/renderer/src/features/routines/RoutineForm.test.tsx src/renderer/src/features/routines/RoutinesPage.test.tsx`

  Expected: FAIL，页面和组件不存在。

- [x] **Step 4: 实现管理导航和页面框架**

  在 `manageNav` 增加 `{ title: "定时任务", path: "/routines", icon: CalendarClock }`，扩展 `ManagePage` path union 和 Router。页面首次加载并行读取 Bots 与 Routines。

- [x] **Step 5: 实现结构化表单**

  - 单次：本地日期时间转换为 ISO。
  - 每天：生成 `${minute} ${hour} * * *`。
  - 每周：生成 `${minute} ${hour} * * ${weekday}`。
  - 高级：直接提交五段表达式。

  时区使用 `Intl.supportedValuesOf("timeZone")`（不可用时至少提供当前时区和 `Asia/Shanghai`），保存实际 IANA 字符串。

- [x] **Step 6: 实现列表、历史与操作状态**

  每个 mutation 以 routineId 独立跟踪 pending，防止双击但不锁死其他项。删除使用确认对话框并明确“保留专属对话和历史”。历史只显示公开状态、时间、missedCount 和 errorCode。

- [x] **Step 7: 运行 Desktop 全量测试**

  Run: `pnpm --filter @vork/desktop test`

  Expected: PASS，现有聊天、凭据、Computer 默认折叠和任务控制不回退。

---

### Task 8: E2E、中文文档与一次性总复核

**Files:**
- Create: `tests/e2e/routines.spec.ts`
- Modify: `tests/e2e/fixtures.ts`
- Modify: `README.zh-CN.md`
- Create: `docs/handovers/2026-09-30-vork-routines-status-zh-CN.md`
- Modify: `docs/superpowers/plans/2026-09-30-vork-routines.md`

**Interfaces:**
- Consumes: Tasks 1–7 完整路径。
- Produces: 真实 Electron 验收、中文操作说明和后续交接记录。

- [x] **Step 1: 增加仅测试环境可用的可控调度时钟**

  E2E fixture 启动 Worker 时允许 `VORK_ROUTINE_SCAN_INTERVAL_MS=250`，但生产默认值仍强制 5000；该变量只改变扫描频率，不绕过数据库抢占。E2E 创建 `*/1 * * * *` 不应等待真实一分钟，优先通过测试专用一次性时间设置为当前时间后数秒完成验收。

- [x] **Step 2: 写 E2E 失败测试**

  场景：

  1. 从管理页创建一次性 Routine。
  2. 等待自动执行完成。
  3. 打开专属对话并看到确定性 FakeModel 回复。
  4. 从 Routine 页面立即运行，再次打开仍是同一 conversationId。
  5. 创建周期 Routine，暂停后跨过到期时间，确认 run 数不增加。

  Run: `pnpm --filter @vork/e2e exec playwright test routines.spec.ts --workers=1`

  Expected: FAIL，完整 UI/调度路径尚未连通。

- [x] **Step 3: 完成真实流程并运行 E2E**

  重建仅受影响的 API/Worker 镜像并执行迁移；不得更新无关依赖或清理用户数据卷。

  Run: `docker compose up -d --build api worker`

  Run: `pnpm --filter @vork/e2e exec playwright test routines.spec.ts --workers=1`

  Expected: PASS。

- [x] **Step 4: 更新中文文档**

  README 说明创建入口、固定专属对话、单实例跳过、missedCount、暂停/恢复和时区语义。交接文档记录已完成能力、明确未包含通知/生产部署/多用户/多 Agent、验证命令、迁移和所有未提交文件。

- [x] **Step 5: 执行一次全量验证**

  Run:

  ```bash
  DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork pnpm --filter @vork/database db:migrate
  VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test pnpm test
  pnpm typecheck
  pnpm --filter @vork/desktop build
  pnpm --filter @vork/e2e exec playwright test --workers=1
  pnpm healthcheck
  git diff --check
  ```

  Expected: 全部退出码 0。

- [x] **Step 6: 做最终数据与幂等复核**

  - 连续重启 Worker 两次，不新增重复 `(routine_id, scheduled_for)`。
  - 同一 Routine 不存在两个活动 Task。
  - 暂停 Routine 的 `next_run_at` 全部为 NULL。
  - deleted Routine 不再产生新 run，但 conversation/messages 仍存在。
  - Routine 调度表和公开错误字段不含 token、Cookie、prompt 或模型输出。
  - 实时电脑画面仍默认折叠。

- [x] **Step 7: 更新计划完成状态，不提交 Git**

  在本计划和中文交接文档记录准确测试数量、跳过项与已知限制。运行 `git status --short` 列出工作区；不得执行 commit、push、PR 或 destructive cleanup。

## 完成定义

- Electron 可完整管理 Routine，并从运行记录打开固定专属对话。
- 单次、每天、每周、五段 Cron 和可选 IANA 时区均可用。
- Worker 重启最多补一次；重复扫描和并发 Worker 不产生重复 run/task。
- 活动任务重叠时记录 `skipped_overlap`，不并发、不排队。
- Routine Task 继承现有审批、暂停恢复、重试和 uncertain 能力。
- 全量测试、类型检查、Electron 构建、E2E、迁移和健康检查通过。
- 中文 README、设计、计划和交接文档同步，所有改动保持未提交。
